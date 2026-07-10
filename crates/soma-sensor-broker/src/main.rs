//! Soma sensor-broker helper.
//!
//! Long-lived JSON-RPC over stdio. Reads request lines from stdin,
//! writes one response line to stdout per request, plus asynchronous
//! notification lines as samples arrive on active Zenoh subscriptions.
//!
//! Current activation state (step 9b of the disabled-first sequence
//! documented in docs/concepts/drafts/sensorium_integration.md):
//!
//!   sensorium.subscribe.start    ACTIVE — opens a real Zenoh
//!                                subscriber, streams samples as
//!                                JSON-RPC notifications, returns
//!                                a uuid subscription_id
//!   sensorium.subscribe.stop     ACTIVE — looks up by subscription_id,
//!                                aborts the subscriber task, removes
//!                                from state
//!   sensorium.subscribe.status   ACTIVE — reports active
//!                                subscriptions (all, or one by id)
//!
//! The Node-side public path is still fail-closed: no HTTP route
//! invokes this helper, and no grant authorizes a Sensorium
//! subscription. Helper-side activation here doesn't move the public
//! path; it makes the *building block* exist so the Node-side activation
//! slice (still pending) can plug it in.
//!
//! Output is serialized through a single mpsc channel so command
//! responses and subscription notifications don't interleave on
//! stdout.

use std::collections::HashMap;
use std::collections::VecDeque;
use std::io::Cursor;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView, ImageFormat};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

const KNOWN_METHODS: &[&str] = &[
    "sensorium.subscribe.start",
    "sensorium.subscribe.stop",
    "sensorium.subscribe.status",
];

// JSON-RPC 2.0 codes
const PARSE_ERROR: i64 = -32700;
const INVALID_REQUEST: i64 = -32600;
const METHOD_NOT_FOUND: i64 = -32601;
const METHOD_IMPLEMENTATION_PENDING: i64 = -32001;
const INVALID_PARAMS: i64 = -32602;
const INTERNAL_ERROR: i64 = -32603;
// Step 9b: subscribe.stop / subscribe.status can address subscriptions
// by id. -32002 is the server-defined code for "you gave me an id but
// no subscription is currently registered under it." Distinct from
// invalid_params (which is for malformed param shapes).
const SUBSCRIPTION_NOT_FOUND: i64 = -32002;
const OUTPUT_QUEUE_CAPACITY: usize = 128;
const OUTPUT_SEND_TIMEOUT: Duration = Duration::from_millis(500);

type Output = mpsc::Sender<String>;

#[derive(Clone, Debug, PartialEq, Eq)]
struct ColorTransformConfig {
    max_width: u32,
    max_height: u32,
    format_required: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct DepthTransformConfig {
    max_width: u32,
    max_height: u32,
    format_required: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum SampleTransformConfig {
    Color(ColorTransformConfig),
    Depth(DepthTransformConfig),
    DepthPresence,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
struct PresenceDepthEvent {
    schema_version: u32,
    event_type: &'static str,
    count_bucket: &'static str,
    additional_person_present: &'static str,
    confidence_bucket: &'static str,
    identity: &'static str,
    seth_present: &'static str,
    copresence_source: &'static str,
    raw_payload_included: bool,
    raw_payload_allowed_to_node: bool,
}

enum TransformResult {
    PayloadBytes(Vec<u8>),
    PresenceEvent(PresenceDepthEvent),
}

#[derive(Debug, Deserialize, Serialize)]
struct ColorFrame {
    schema_version: u32,
    timestamp: f64,
    frame_number: u64,
    width: u32,
    height: u32,
    format: String,
    data: Vec<u8>,
}

#[derive(Debug, Deserialize, Serialize)]
struct DepthFrame {
    schema_version: u32,
    timestamp: f64,
    frame_number: u64,
    width: u32,
    height: u32,
    format: String,
    depth_units: f64,
    data: Vec<u8>,
}

struct Subscription {
    topic: String,
    started_at: f64,
    handle: tokio::task::JoinHandle<()>,
}

#[derive(Default)]
struct State {
    subscribers: HashMap<String, Subscription>,
}

#[tokio::main(flavor = "multi_thread")]
async fn main() -> std::process::ExitCode {
    let state = Arc::new(Mutex::new(State::default()));
    let (output_tx, mut output_rx) = mpsc::channel::<String>(OUTPUT_QUEUE_CAPACITY);

    // Output task — single writer, prevents interleaved lines on stdout.
    let output_task = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(line) = output_rx.recv().await {
            if stdout.write_all(line.as_bytes()).await.is_err() {
                break;
            }
            if stdout.write_all(b"\n").await.is_err() {
                break;
            }
            let _ = stdout.flush().await;
        }
    });

    // Input task — reads stdin, dispatches each line.
    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break,
            Ok(_) => {
                let response = handle_line(&line, Arc::clone(&state), output_tx.clone()).await;
                if !send_output_line(&output_tx, response.to_string()).await {
                    break;
                }
            }
            Err(_) => break,
        }
    }

    // On stdin EOF, abort all subscriber tasks. Each subscriber task
    // holds a clone of output_tx; without aborting them the output
    // task would wait forever for senders to drop and the process
    // would hang. Aborting is correct here because the helper is
    // shutting down — no more samples will be processed regardless.
    {
        let mut s = state.lock().await;
        for (_, sub) in s.subscribers.drain() {
            sub.handle.abort();
        }
    }

    drop(output_tx);
    let _ = output_task.await;
    std::process::ExitCode::SUCCESS
}

async fn handle_line(line: &str, state: Arc<Mutex<State>>, output_tx: Output) -> Value {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return error_response(
            Value::Null,
            PARSE_ERROR,
            "parse_error",
            "empty request line",
        );
    }

    let request: Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(e) => return error_response(Value::Null, PARSE_ERROR, "parse_error", &e.to_string()),
    };

    let id = request.get("id").cloned().unwrap_or(Value::Null);

    if request.get("jsonrpc").and_then(|v| v.as_str()) != Some("2.0") {
        return error_response(
            id,
            INVALID_REQUEST,
            "invalid_request",
            "jsonrpc must be \"2.0\"",
        );
    }

    let method = match request.get("method").and_then(|v| v.as_str()) {
        Some(m) => m,
        None => {
            return error_response(
                id,
                INVALID_REQUEST,
                "invalid_request",
                "method field missing or not a string",
            );
        }
    };

    if !KNOWN_METHODS.contains(&method) {
        return error_response(
            id,
            METHOD_NOT_FOUND,
            "method_not_found",
            &format!("unknown method: {method}"),
        );
    }

    let params = request.get("params").cloned().unwrap_or(Value::Null);

    match method {
        "sensorium.subscribe.start" => handle_subscribe_start(id, params, state, output_tx).await,
        "sensorium.subscribe.stop" => handle_subscribe_stop(id, params, state).await,
        "sensorium.subscribe.status" => handle_subscribe_status(id, params, state).await,
        _ => error_response(
            id,
            METHOD_IMPLEMENTATION_PENDING,
            "method_implementation_pending",
            &format!("{method} recognized; implementation pending later activation slice"),
        ),
    }
}

async fn handle_subscribe_stop(id: Value, params: Value, state: Arc<Mutex<State>>) -> Value {
    let subscription_id = match params.get("subscription_id").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => {
            return error_response(
                id,
                INVALID_PARAMS,
                "invalid_params",
                "subscribe.stop requires params.subscription_id (non-empty string)",
            );
        }
    };

    let removed = {
        let mut s = state.lock().await;
        s.subscribers.remove(&subscription_id)
    };

    match removed {
        Some(sub) => {
            sub.handle.abort();
            // Best-effort: wait briefly for the task to acknowledge
            // the abort. We don't propagate the JoinError because
            // aborted tasks always return a cancel error — we only
            // care that the handle's been signalled.
            let _ = sub.handle.await;
            json!({
                "jsonrpc": "2.0",
                "result": {
                    "subscription_id": subscription_id,
                    "topic": sub.topic,
                    "stopped": true,
                },
                "id": id,
            })
        }
        None => error_response(
            id,
            SUBSCRIPTION_NOT_FOUND,
            "subscription_not_found",
            &format!("no active subscription with id {subscription_id}"),
        ),
    }
}

async fn handle_subscribe_status(id: Value, params: Value, state: Arc<Mutex<State>>) -> Value {
    let s = state.lock().await;

    // If a specific subscription_id was requested, return its status
    // or subscription_not_found.
    if let Some(want) = params.get("subscription_id").and_then(|v| v.as_str()) {
        if !want.is_empty() {
            return match s.subscribers.get(want) {
                Some(sub) => json!({
                    "jsonrpc": "2.0",
                    "result": {
                        "subscription_id": want,
                        "topic": sub.topic,
                        "started_at": sub.started_at,
                        "active": true,
                    },
                    "id": id,
                }),
                None => error_response(
                    id,
                    SUBSCRIPTION_NOT_FOUND,
                    "subscription_not_found",
                    &format!("no active subscription with id {want}"),
                ),
            };
        }
    }

    // Otherwise return the full list. Always an array, even when empty.
    let subscriptions: Vec<Value> = s
        .subscribers
        .iter()
        .map(|(sub_id, sub)| {
            json!({
                "subscription_id": sub_id,
                "topic": sub.topic,
                "started_at": sub.started_at,
                "active": true,
            })
        })
        .collect();

    json!({
        "jsonrpc": "2.0",
        "result": {
            "subscriptions": subscriptions,
            "count": subscriptions.len(),
        },
        "id": id,
    })
}

async fn handle_subscribe_start(
    id: Value,
    params: Value,
    state: Arc<Mutex<State>>,
    output_tx: Output,
) -> Value {
    // Required param: topic.
    let topic = match params.get("topic").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => {
            return error_response(
                id,
                INVALID_PARAMS,
                "invalid_params",
                "subscribe.start requires params.topic (non-empty string)",
            );
        }
    };

    // Optional param: zenoh_config_path. When absent we use
    // zenoh::Config::default() (no auth). The Node side is expected
    // to refuse subscriptions that would route to a producer without
    // a matching credential; this helper trusts the caller for the
    // config path.
    let zenoh_config_path = params
        .get("zenoh_config_path")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let max_fps = match parse_optional_max_fps(&params) {
        Ok(value) => value,
        Err(message) => {
            return error_response(id, INVALID_PARAMS, "invalid_params", &message);
        }
    };
    let sample_transform = match parse_optional_sample_transform(&params, &topic) {
        Ok(value) => value,
        Err(message) => {
            return error_response(id, INVALID_PARAMS, "invalid_params", &message);
        }
    };

    let subscription_id = Uuid::new_v4().to_string();

    // Open Zenoh session.
    let config = match zenoh_config_path.as_deref() {
        Some(path) => match zenoh::Config::from_file(path) {
            Ok(c) => c,
            Err(e) => {
                return error_response(
                    id,
                    INTERNAL_ERROR,
                    "zenoh_config_load_failed",
                    &format!("failed to load Zenoh config from {path}: {e}"),
                );
            }
        },
        None => zenoh::Config::default(),
    };

    let session = match zenoh::open(config).await {
        Ok(s) => s,
        Err(e) => {
            return error_response(
                id,
                INTERNAL_ERROR,
                "zenoh_open_failed",
                &format!("zenoh::open failed: {e}"),
            );
        }
    };

    let subscriber = match session.declare_subscriber(topic.clone()).await {
        Ok(s) => s,
        Err(e) => {
            return error_response(
                id,
                INTERNAL_ERROR,
                "zenoh_declare_subscriber_failed",
                &format!("declare_subscriber({topic}) failed: {e}"),
            );
        }
    };

    // Spawn the subscriber task: forwards each received sample to
    // stdout as a JSON-RPC notification. The session is moved into
    // the task to keep it alive for the subscriber's lifetime.
    let sub_id_for_task = subscription_id.clone();
    let topic_for_task = topic.clone();
    let join = tokio::spawn(async move {
        // Move both subscriber and session into the task so they live
        // together; dropping either ends the subscription.
        let _session_guard = session;
        let min_interval = max_fps.map(|fps| Duration::from_secs_f64(1.0 / f64::from(fps)));
        let mut last_delivered: Option<Instant> = None;
        loop {
            match subscriber.recv_async().await {
                Ok(sample) => {
                    if let Some(interval) = min_interval {
                        if last_delivered.is_some_and(|last| last.elapsed() < interval) {
                            continue;
                        }
                        last_delivered = Some(Instant::now());
                    }
                    let original = sample.payload().to_bytes().to_vec();
                    let transform_result =
                        match transform_sample_payload(&original, sample_transform.as_ref()) {
                            Ok(transform_result) => transform_result,
                            Err(error_class) => {
                                let notification = json!({
                                    "jsonrpc": "2.0",
                                    "method": "sensorium.subscription.error",
                                    "params": {
                                        "subscription_id": sub_id_for_task,
                                        "topic": topic_for_task,
                                        "error_class": error_class,
                                    }
                                });
                                let _ = send_output_line(&output_tx, notification.to_string()).await;
                                break;
                            }
                        };
                    let notification = match transform_result {
                        TransformResult::PayloadBytes(bytes) => json!({
                            "jsonrpc": "2.0",
                            "method": "sensorium.subscription.sample",
                            "params": {
                                "subscription_id": sub_id_for_task,
                                "topic": topic_for_task,
                                "payload_bytes": bytes,
                                "payload_size": bytes.len(),
                            }
                        }),
                        TransformResult::PresenceEvent(event) => json!({
                            "jsonrpc": "2.0",
                            "method": "sensorium.presence.depth.event",
                            "params": {
                                "subscription_id": sub_id_for_task,
                                "topic": topic_for_task,
                                "event": event,
                            }
                        }),
                    };
                    if !send_output_line(&output_tx, notification.to_string()).await {
                        break;
                    }
                }
                Err(_) => {
                    let notification = json!({
                        "jsonrpc": "2.0",
                        "method": "sensorium.subscription.error",
                        "params": {
                            "subscription_id": sub_id_for_task,
                            "topic": topic_for_task,
                            "error_class": "zenoh_recv_failed",
                        }
                    });
                    let _ = send_output_line(&output_tx, notification.to_string()).await;
                    break;
                }
            }
        }
    });

    let started_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);

    {
        let mut s = state.lock().await;
        s.subscribers.insert(
            subscription_id.clone(),
            Subscription {
                topic: topic.clone(),
                started_at,
                handle: join,
            },
        );
    }

    json!({
        "jsonrpc": "2.0",
        "result": {
            "subscription_id": subscription_id,
            "topic": topic,
            "started_at": started_at,
        },
        "id": id,
    })
}

async fn send_output_line(output_tx: &Output, line: String) -> bool {
    matches!(
        tokio::time::timeout(OUTPUT_SEND_TIMEOUT, output_tx.send(line)).await,
        Ok(Ok(()))
    )
}

fn parse_optional_max_fps(params: &Value) -> Result<Option<u32>, String> {
    match params.get("max_fps") {
        None | Some(Value::Null) => Ok(None),
        Some(value) => match value.as_u64() {
            Some(raw) if (1..=30).contains(&raw) => Ok(Some(raw as u32)),
            _ => Err("subscribe.start params.max_fps must be an integer from 1 to 30".to_string()),
        },
    }
}

fn parse_optional_sample_transform(
    params: &Value,
    topic: &str,
) -> Result<Option<SampleTransformConfig>, String> {
    let presence_transform = match params.get("presence_transform") {
        None | Some(Value::Null) => false,
        Some(Value::Bool(value)) => *value,
        Some(_) => {
            return Err(
                "subscribe.start params.presence_transform must be a boolean when provided"
                    .to_string(),
            )
        }
    };
    if presence_transform {
        if !topic.ends_with("/realsense/depth") {
            return Err(
                "subscribe.start params.presence_transform requires a realsense depth topic"
                    .to_string(),
            );
        }
        if params
            .get("downsample_to")
            .is_some_and(|value| !value.is_null())
        {
            return Err(
                "subscribe.start params.downsample_to is not allowed with presence_transform"
                    .to_string(),
            );
        }
        if params
            .get("format_required")
            .is_some_and(|value| !value.is_null())
        {
            return Err(
                "subscribe.start params.format_required is not allowed with presence_transform"
                    .to_string(),
            );
        }
        return Ok(Some(SampleTransformConfig::DepthPresence));
    }

    let downsample = match params.get("downsample_to") {
        None | Some(Value::Null) => None,
        Some(value) => Some(parse_downsample_to(value)?),
    };
    let format_required = match params.get("format_required") {
        None | Some(Value::Null) => None,
        Some(value) => match value.as_str() {
            Some("jpeg") => {
                if !topic.ends_with("/realsense/color") {
                    return Err(
                        "subscribe.start params.format_required must be png for depth transforms"
                            .to_string(),
                    );
                }
                Some("jpeg".to_string())
            }
            Some("png") => {
                if !topic.ends_with("/realsense/depth") {
                    return Err(
                        "subscribe.start params.format_required must be jpeg for color transforms"
                            .to_string(),
                    );
                }
                Some("png".to_string())
            }
            Some(_) => {
                if topic.ends_with("/realsense/depth") {
                    return Err(
                        "subscribe.start params.format_required must be png for depth transforms"
                            .to_string(),
                    );
                }
                return Err(
                    "subscribe.start params.format_required must be jpeg for color transforms"
                        .to_string(),
                );
            }
            None => {
                return Err(
                    "subscribe.start params.format_required must be a non-empty string".to_string(),
                )
            }
        },
    };

    match (downsample, format_required) {
        (None, None) => Ok(None),
        (Some((max_width, max_height)), Some(format_required)) => {
            if topic.ends_with("/realsense/depth") {
                Ok(Some(SampleTransformConfig::Depth(DepthTransformConfig {
                    max_width,
                    max_height,
                    format_required,
                })))
            } else {
                Ok(Some(SampleTransformConfig::Color(ColorTransformConfig {
                    max_width,
                    max_height,
                    format_required,
                })))
            }
        }
        (Some(_), None) => {
            Err("subscribe.start params.format_required is required with downsample_to".to_string())
        }
        (None, Some(_)) => {
            Err("subscribe.start params.downsample_to is required with format_required".to_string())
        }
    }
}

fn parse_downsample_to(value: &Value) -> Result<(u32, u32), String> {
    let entries = value.as_array().ok_or_else(|| {
        "subscribe.start params.downsample_to must be [width, height]".to_string()
    })?;
    if entries.len() != 2 {
        return Err("subscribe.start params.downsample_to must be [width, height]".to_string());
    }
    let width = parse_dimension(&entries[0], "width")?;
    let height = parse_dimension(&entries[1], "height")?;
    Ok((width, height))
}

fn parse_dimension(value: &Value, label: &str) -> Result<u32, String> {
    match value.as_u64() {
        Some(raw) if (1..=1920).contains(&raw) => Ok(raw as u32),
        _ => Err(format!(
            "subscribe.start params.downsample_to {label} must be an integer from 1 to 1920"
        )),
    }
}

fn transform_sample_payload(
    payload: &[u8],
    sample_transform: Option<&SampleTransformConfig>,
) -> Result<TransformResult, &'static str> {
    match sample_transform {
        None => Ok(TransformResult::PayloadBytes(payload.to_vec())),
        Some(SampleTransformConfig::Color(config)) => {
            transform_color_payload(payload, config).map(TransformResult::PayloadBytes)
        }
        Some(SampleTransformConfig::Depth(config)) => {
            transform_depth_payload(payload, config).map(TransformResult::PayloadBytes)
        }
        Some(SampleTransformConfig::DepthPresence) => Ok(TransformResult::PresenceEvent(
            transform_depth_presence_payload(payload),
        )),
    }
}

fn transform_color_payload(
    payload: &[u8],
    config: &ColorTransformConfig,
) -> Result<Vec<u8>, &'static str> {
    let mut frame: ColorFrame =
        rmp_serde::from_slice(payload).map_err(|_| "color_msgpack_decode_failed")?;
    if frame.schema_version != 1 {
        return Err("color_schema_unsupported");
    }
    if frame.format != config.format_required {
        return Err("color_format_mismatch");
    }
    if frame.format != "jpeg" {
        return Err("color_format_unsupported");
    }

    let image = image::load_from_memory(&frame.data).map_err(|_| "color_jpeg_decode_failed")?;
    let (source_width, source_height) = image.dimensions();
    if source_width == 0 || source_height == 0 {
        return Err("color_image_dimensions_invalid");
    }

    let (target_width, target_height) = bounded_dimensions(
        source_width,
        source_height,
        config.max_width,
        config.max_height,
    );
    if target_width == source_width && target_height == source_height {
        frame.width = source_width;
        frame.height = source_height;
    } else {
        let resized = image.resize(target_width, target_height, FilterType::Triangle);
        let mut encoded = Vec::new();
        {
            let mut cursor = Cursor::new(&mut encoded);
            let mut encoder = JpegEncoder::new_with_quality(&mut cursor, 85);
            encoder
                .encode_image(&resized)
                .map_err(|_| "color_jpeg_encode_failed")?;
        }
        frame.width = target_width;
        frame.height = target_height;
        frame.data = encoded;
    }

    if frame.width > config.max_width || frame.height > config.max_height {
        return Err("color_downsample_bounds_exceeded");
    }

    rmp_serde::to_vec_named(&frame).map_err(|_| "color_msgpack_encode_failed")
}

fn transform_depth_payload(
    payload: &[u8],
    config: &DepthTransformConfig,
) -> Result<Vec<u8>, &'static str> {
    let mut frame: DepthFrame =
        rmp_serde::from_slice(payload).map_err(|_| "depth_msgpack_decode_failed")?;
    if frame.schema_version != 1 {
        return Err("depth_schema_unsupported");
    }
    if frame.format != config.format_required {
        return Err("depth_format_mismatch");
    }
    if frame.format != "png" {
        return Err("depth_format_unsupported");
    }
    if !frame.depth_units.is_finite() || frame.depth_units <= 0.0 {
        return Err("depth_units_invalid");
    }

    let image = image::load_from_memory_with_format(&frame.data, ImageFormat::Png)
        .map_err(|_| "depth_png_decode_failed")?;
    let (source_width, source_height) = image.dimensions();
    if source_width == 0 || source_height == 0 {
        return Err("depth_image_dimensions_invalid");
    }

    let (target_width, target_height) = bounded_dimensions(
        source_width,
        source_height,
        config.max_width,
        config.max_height,
    );
    if target_width == source_width && target_height == source_height {
        frame.width = source_width;
        frame.height = source_height;
    } else {
        let resized = image.resize(target_width, target_height, FilterType::Triangle);
        let mut encoded = Vec::new();
        {
            let mut cursor = Cursor::new(&mut encoded);
            resized
                .write_to(&mut cursor, ImageFormat::Png)
                .map_err(|_| "depth_png_encode_failed")?;
        }
        frame.width = target_width;
        frame.height = target_height;
        frame.data = encoded;
    }

    if frame.width > config.max_width || frame.height > config.max_height {
        return Err("depth_downsample_bounds_exceeded");
    }

    rmp_serde::to_vec_named(&frame).map_err(|_| "depth_msgpack_encode_failed")
}

fn transform_depth_presence_payload(payload: &[u8]) -> PresenceDepthEvent {
    match derive_depth_presence_event(payload) {
        Ok(event) => event,
        Err(error_class) => {
            eprintln!("sensorium depth presence transform degraded to unknown: {error_class}");
            unknown_presence_event()
        }
    }
}

fn derive_depth_presence_event(payload: &[u8]) -> Result<PresenceDepthEvent, &'static str> {
    let frame: DepthFrame =
        rmp_serde::from_slice(payload).map_err(|_| "depth_presence_msgpack_decode_failed")?;
    if frame.schema_version != 1 {
        return Err("depth_presence_schema_unsupported");
    }
    if frame.format != "png" {
        return Err("depth_presence_format_unsupported");
    }
    if !frame.depth_units.is_finite() || frame.depth_units <= 0.0 {
        return Err("depth_presence_units_invalid");
    }

    let image = image::load_from_memory_with_format(&frame.data, ImageFormat::Png)
        .map_err(|_| "depth_presence_png_decode_failed")?;
    let (source_width, source_height) = image.dimensions();
    if source_width == 0 || source_height == 0 {
        return Err("depth_presence_image_dimensions_invalid");
    }

    Ok(classify_depth_presence_image(&image, frame.depth_units))
}

fn classify_depth_presence_image(image: &DynamicImage, depth_units: f64) -> PresenceDepthEvent {
    const GRID_WIDTH: usize = 64;
    const GRID_HEIGHT: usize = 36;
    const NEAR_METERS: f64 = 0.4;
    const FAR_METERS: f64 = 4.5;
    const MIN_VALID_COVERAGE: f64 = 0.25;
    const MIN_COMPONENT_AREA: usize = 8;
    const MAX_COMPONENTS_BEFORE_UNKNOWN: usize = 4;
    const MAX_TINY_COMPONENT_CELLS: usize = 24;
    const MAX_IN_BAND_FRACTION: f64 = 0.45;

    let luma = image.to_luma16();
    let (width, height) = luma.dimensions();
    let mut valid_by_cell = vec![0_u32; GRID_WIDTH * GRID_HEIGHT];
    let mut in_band_by_cell = vec![0_u32; GRID_WIDTH * GRID_HEIGHT];
    let mut valid_pixels: u64 = 0;

    for (x, y, pixel) in luma.enumerate_pixels() {
        let raw = pixel.0[0];
        if raw == 0 {
            continue;
        }
        valid_pixels += 1;
        let cell_x = ((x as usize * GRID_WIDTH) / width as usize).min(GRID_WIDTH - 1);
        let cell_y = ((y as usize * GRID_HEIGHT) / height as usize).min(GRID_HEIGHT - 1);
        let cell = cell_y * GRID_WIDTH + cell_x;
        valid_by_cell[cell] += 1;
        let meters = f64::from(raw) * depth_units;
        if (NEAR_METERS..=FAR_METERS).contains(&meters) {
            in_band_by_cell[cell] += 1;
        }
    }

    let total_pixels = u64::from(width) * u64::from(height);
    let valid_coverage = valid_pixels as f64 / total_pixels as f64;
    if valid_coverage < MIN_VALID_COVERAGE {
        return unknown_presence_event();
    }

    let mut mask = vec![false; GRID_WIDTH * GRID_HEIGHT];
    for index in 0..mask.len() {
        let valid = valid_by_cell[index];
        if valid == 0 {
            continue;
        }
        let in_band = in_band_by_cell[index];
        if in_band >= 2 && f64::from(in_band) / f64::from(valid) >= 0.60 {
            mask[index] = true;
        }
    }

    let in_band_cells = mask.iter().filter(|cell| **cell).count();
    if in_band_cells as f64 / mask.len() as f64 > MAX_IN_BAND_FRACTION {
        return unknown_presence_event();
    }

    let components = connected_component_areas(&mask, GRID_WIDTH, GRID_HEIGHT);
    let body_components: Vec<usize> = components
        .iter()
        .copied()
        .filter(|area| *area >= MIN_COMPONENT_AREA)
        .collect();
    let tiny_component_cells: usize = components
        .iter()
        .copied()
        .filter(|area| *area < MIN_COMPONENT_AREA)
        .sum();
    if body_components.len() > MAX_COMPONENTS_BEFORE_UNKNOWN
        || tiny_component_cells > MAX_TINY_COMPONENT_CELLS
    {
        return unknown_presence_event();
    }

    match body_components.len() {
        0 => presence_event("0", "not_detected", "medium"),
        1 => presence_event("1", "not_detected", "medium"),
        2..=MAX_COMPONENTS_BEFORE_UNKNOWN => presence_event("2_plus", "present", "medium"),
        _ => unknown_presence_event(),
    }
}

fn connected_component_areas(mask: &[bool], width: usize, height: usize) -> Vec<usize> {
    let mut seen = vec![false; mask.len()];
    let mut areas = Vec::new();
    for start in 0..mask.len() {
        if !mask[start] || seen[start] {
            continue;
        }
        let mut area = 0;
        let mut queue = VecDeque::from([start]);
        seen[start] = true;
        while let Some(index) = queue.pop_front() {
            area += 1;
            let x = index % width;
            let y = index / width;
            for (nx, ny) in neighbors4(x, y, width, height) {
                let next = ny * width + nx;
                if mask[next] && !seen[next] {
                    seen[next] = true;
                    queue.push_back(next);
                }
            }
        }
        areas.push(area);
    }
    areas
}

fn neighbors4(
    x: usize,
    y: usize,
    width: usize,
    height: usize,
) -> impl Iterator<Item = (usize, usize)> {
    [
        x.checked_sub(1).map(|nx| (nx, y)),
        (x + 1 < width).then_some((x + 1, y)),
        y.checked_sub(1).map(|ny| (x, ny)),
        (y + 1 < height).then_some((x, y + 1)),
    ]
    .into_iter()
    .flatten()
}

fn unknown_presence_event() -> PresenceDepthEvent {
    presence_event("unknown", "unknown", "low")
}

fn presence_event(
    count_bucket: &'static str,
    additional_person_present: &'static str,
    confidence_bucket: &'static str,
) -> PresenceDepthEvent {
    PresenceDepthEvent {
        schema_version: 1,
        event_type: "presence.depth",
        count_bucket,
        additional_person_present,
        confidence_bucket,
        identity: "not_performed",
        seth_present: "unknown",
        copresence_source: "depth",
        raw_payload_included: false,
        raw_payload_allowed_to_node: false,
    }
}

fn bounded_dimensions(
    source_width: u32,
    source_height: u32,
    max_width: u32,
    max_height: u32,
) -> (u32, u32) {
    if source_width <= max_width && source_height <= max_height {
        return (source_width, source_height);
    }
    let width_limited_height =
        ((u64::from(source_height) * u64::from(max_width)) / u64::from(source_width)).max(1);
    if width_limited_height <= u64::from(max_height) {
        return (max_width, width_limited_height as u32);
    }
    let height_limited_width =
        ((u64::from(source_width) * u64::from(max_height)) / u64::from(source_height)).max(1);
    (height_limited_width as u32, max_height)
}

fn error_response(id: Value, code: i64, code_name: &str, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "error": {
            "code": code,
            "code_name": code_name,
            "message": message,
        },
        "id": id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageBuffer, Luma, Rgb};
    use std::fs;
    use std::path::PathBuf;

    fn make_state() -> Arc<Mutex<State>> {
        Arc::new(Mutex::new(State::default()))
    }

    fn make_output() -> (Output, mpsc::Receiver<String>) {
        mpsc::channel::<String>(OUTPUT_QUEUE_CAPACITY)
    }

    fn sandbox_zenoh_config_path() -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("soma-sensor-broker-test-{}.json5", Uuid::new_v4()));
        fs::write(
            &path,
            r#"{
  mode: "peer",
  listen: { endpoints: [] },
  scouting: {
    multicast: { enabled: false },
    gossip: { enabled: false },
  },
}
"#,
        )
        .expect("write sandbox zenoh config");
        path
    }

    fn jpeg_bytes(width: u32, height: u32) -> Vec<u8> {
        let image = ImageBuffer::from_fn(width, height, |x, y| {
            Rgb([(x % 255) as u8, (y % 255) as u8, ((x + y) % 255) as u8])
        });
        let dyn_image = DynamicImage::ImageRgb8(image);
        let mut encoded = Vec::new();
        let mut cursor = Cursor::new(&mut encoded);
        let mut encoder = JpegEncoder::new_with_quality(&mut cursor, 85);
        encoder
            .encode_image(&dyn_image)
            .expect("encode fixture jpeg");
        encoded
    }

    fn color_payload(width: u32, height: u32) -> Vec<u8> {
        rmp_serde::to_vec_named(&ColorFrame {
            schema_version: 1,
            timestamp: 1_779_000_001.25,
            frame_number: 42,
            width,
            height,
            format: "jpeg".to_string(),
            data: jpeg_bytes(width, height),
        })
        .expect("encode color frame")
    }

    fn png_depth_bytes(width: u32, height: u32) -> Vec<u8> {
        let image = ImageBuffer::from_fn(width, height, |x, y| {
            Luma([((x + y) % u32::from(u16::MAX)) as u16])
        });
        let dyn_image = DynamicImage::ImageLuma16(image);
        let mut encoded = Vec::new();
        let mut cursor = Cursor::new(&mut encoded);
        dyn_image
            .write_to(&mut cursor, ImageFormat::Png)
            .expect("encode fixture png");
        encoded
    }

    fn png_depth_bytes_from_fn(
        width: u32,
        height: u32,
        value: impl Fn(u32, u32) -> u16,
    ) -> Vec<u8> {
        let image = ImageBuffer::from_fn(width, height, |x, y| Luma([value(x, y)]));
        let dyn_image = DynamicImage::ImageLuma16(image);
        let mut encoded = Vec::new();
        let mut cursor = Cursor::new(&mut encoded);
        dyn_image
            .write_to(&mut cursor, ImageFormat::Png)
            .expect("encode fixture png");
        encoded
    }

    fn depth_payload(width: u32, height: u32) -> Vec<u8> {
        depth_payload_with_png(width, height, png_depth_bytes(width, height), 0.001)
    }

    fn depth_payload_with_png(width: u32, height: u32, data: Vec<u8>, depth_units: f64) -> Vec<u8> {
        rmp_serde::to_vec_named(&DepthFrame {
            schema_version: 1,
            timestamp: 1_779_000_001.25,
            frame_number: 42,
            width,
            height,
            format: "png".to_string(),
            depth_units,
            data,
        })
        .expect("encode depth frame")
    }

    fn synthetic_depth_payload(value: impl Fn(u32, u32) -> u16) -> Vec<u8> {
        let width = 160;
        let height = 90;
        depth_payload_with_png(
            width,
            height,
            png_depth_bytes_from_fn(width, height, value),
            0.001,
        )
    }

    #[tokio::test]
    async fn empty_line_returns_parse_error() {
        let (tx, _rx) = make_output();
        let resp = handle_line("", make_state(), tx).await;
        assert_eq!(resp["error"]["code"], json!(PARSE_ERROR));
    }

    #[tokio::test]
    async fn unknown_method_returns_method_not_found() {
        let (tx, _rx) = make_output();
        let resp = handle_line(
            r#"{"jsonrpc":"2.0","method":"sensorium.subscribe.invent","id":1}"#,
            make_state(),
            tx,
        )
        .await;
        assert_eq!(resp["error"]["code"], json!(METHOD_NOT_FOUND));
    }

    #[tokio::test]
    async fn stop_without_subscription_id_returns_invalid_params() {
        let (tx, _rx) = make_output();
        let resp = handle_line(
            r#"{"jsonrpc":"2.0","method":"sensorium.subscribe.stop","params":{},"id":1}"#,
            make_state(),
            tx,
        )
        .await;
        assert_eq!(resp["error"]["code"], json!(INVALID_PARAMS));
    }

    #[tokio::test]
    async fn stop_with_unknown_id_returns_subscription_not_found() {
        let (tx, _rx) = make_output();
        let resp = handle_line(
            r#"{"jsonrpc":"2.0","method":"sensorium.subscribe.stop","params":{"subscription_id":"never-seen"},"id":1}"#,
            make_state(),
            tx,
        )
        .await;
        assert_eq!(resp["error"]["code"], json!(SUBSCRIPTION_NOT_FOUND));
        assert_eq!(resp["error"]["code_name"], "subscription_not_found");
    }

    #[tokio::test]
    async fn status_with_unknown_id_returns_subscription_not_found() {
        let (tx, _rx) = make_output();
        let resp = handle_line(
            r#"{"jsonrpc":"2.0","method":"sensorium.subscribe.status","params":{"subscription_id":"never-seen"},"id":1}"#,
            make_state(),
            tx,
        )
        .await;
        assert_eq!(resp["error"]["code"], json!(SUBSCRIPTION_NOT_FOUND));
    }

    #[tokio::test]
    async fn status_without_id_returns_empty_list_when_idle() {
        let (tx, _rx) = make_output();
        let resp = handle_line(
            r#"{"jsonrpc":"2.0","method":"sensorium.subscribe.status","id":1}"#,
            make_state(),
            tx,
        )
        .await;
        assert!(resp.get("result").is_some());
        assert_eq!(resp["result"]["count"], 0);
        assert_eq!(resp["result"]["subscriptions"], json!([]));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn full_lifecycle_start_status_stop_status() {
        let state = make_state();
        let (tx, _rx) = make_output();
        let zenoh_config_path = sandbox_zenoh_config_path();

        // start
        let start_resp = handle_line(
            &format!(
                r#"{{"jsonrpc":"2.0","method":"sensorium.subscribe.start","params":{{"topic":"sensor/test/status","zenoh_config_path":"{}"}},"id":"s"}}"#,
                zenoh_config_path.display()
            ),
            Arc::clone(&state),
            tx.clone(),
        )
        .await;
        let sub_id = start_resp["result"]["subscription_id"]
            .as_str()
            .expect("subscription_id")
            .to_string();

        // status (list mode) — one entry
        let list_resp = handle_line(
            r#"{"jsonrpc":"2.0","method":"sensorium.subscribe.status","id":1}"#,
            Arc::clone(&state),
            tx.clone(),
        )
        .await;
        assert_eq!(list_resp["result"]["count"], 1);
        assert_eq!(
            list_resp["result"]["subscriptions"][0]["subscription_id"],
            sub_id
        );

        // status (by id) — match
        let by_id_resp = handle_line(
            &format!(
                r#"{{"jsonrpc":"2.0","method":"sensorium.subscribe.status","params":{{"subscription_id":"{sub_id}"}},"id":2}}"#
            ),
            Arc::clone(&state),
            tx.clone(),
        )
        .await;
        assert_eq!(by_id_resp["result"]["subscription_id"], sub_id);
        assert_eq!(by_id_resp["result"]["topic"], "sensor/test/status");
        assert_eq!(by_id_resp["result"]["active"], true);

        // stop
        let stop_resp = handle_line(
            &format!(
                r#"{{"jsonrpc":"2.0","method":"sensorium.subscribe.stop","params":{{"subscription_id":"{sub_id}"}},"id":3}}"#
            ),
            Arc::clone(&state),
            tx.clone(),
        )
        .await;
        assert_eq!(stop_resp["result"]["stopped"], true);
        assert_eq!(stop_resp["result"]["subscription_id"], sub_id);

        // status (list mode) — back to empty
        let list_resp2 = handle_line(
            r#"{"jsonrpc":"2.0","method":"sensorium.subscribe.status","id":4}"#,
            Arc::clone(&state),
            tx.clone(),
        )
        .await;
        assert_eq!(list_resp2["result"]["count"], 0);

        // stop again (already gone) — subscription_not_found
        let stop_again = handle_line(
            &format!(
                r#"{{"jsonrpc":"2.0","method":"sensorium.subscribe.stop","params":{{"subscription_id":"{sub_id}"}},"id":5}}"#
            ),
            Arc::clone(&state),
            tx.clone(),
        )
        .await;
        assert_eq!(stop_again["error"]["code"], json!(SUBSCRIPTION_NOT_FOUND));
    }

    #[tokio::test]
    async fn start_without_topic_returns_invalid_params() {
        let (tx, _rx) = make_output();
        let resp = handle_line(
            r#"{"jsonrpc":"2.0","method":"sensorium.subscribe.start","params":{},"id":1}"#,
            make_state(),
            tx,
        )
        .await;
        assert_eq!(resp["error"]["code"], json!(INVALID_PARAMS));
        assert_eq!(resp["error"]["code_name"], "invalid_params");
    }

    #[tokio::test]
    async fn start_rejects_invalid_max_fps_before_opening_subscription() {
        let (tx, _rx) = make_output();
        for bad in [json!(0), json!(31), json!(1.5), json!("1")] {
            let resp = handle_line(
                &json!({
                    "jsonrpc": "2.0",
                    "method": "sensorium.subscribe.start",
                    "params": {
                        "topic": "sensor/test/status",
                        "max_fps": bad,
                    },
                    "id": "bad-max-fps",
                })
                .to_string(),
                make_state(),
                tx.clone(),
            )
            .await;
            assert_eq!(resp["error"]["code"], json!(INVALID_PARAMS));
            assert_eq!(resp["error"]["code_name"], "invalid_params");
            assert!(
                resp["error"]["message"]
                    .as_str()
                    .unwrap_or_default()
                    .contains("max_fps"),
                "expected max_fps error, got {resp}"
            );
        }
    }

    #[tokio::test]
    async fn start_rejects_invalid_color_transform_params_before_opening_subscription() {
        let (tx, _rx) = make_output();
        let cases = [
            json!({"downsample_to":[320,240]}),
            json!({"format_required":"jpeg"}),
            json!({"downsample_to":[0,240],"format_required":"jpeg"}),
            json!({"downsample_to":[320,240],"format_required":"png"}),
        ];
        for params in cases {
            let resp = handle_line(
                &json!({
                    "jsonrpc": "2.0",
                    "method": "sensorium.subscribe.start",
                    "params": {
                        "topic": "sensor/test/realsense/color",
                        "downsample_to": params.get("downsample_to").cloned().unwrap_or(Value::Null),
                        "format_required": params.get("format_required").cloned().unwrap_or(Value::Null),
                    },
                    "id": "bad-transform",
                })
                .to_string(),
                make_state(),
                tx.clone(),
            )
            .await;
            assert_eq!(resp["error"]["code"], json!(INVALID_PARAMS), "{resp}");
            assert_eq!(resp["error"]["code_name"], "invalid_params");
        }
    }

    #[tokio::test]
    async fn start_rejects_invalid_depth_transform_params_before_opening_subscription() {
        let (tx, _rx) = make_output();
        let cases = [
            json!({"downsample_to":[320,240]}),
            json!({"format_required":"png"}),
            json!({"downsample_to":[0,240],"format_required":"png"}),
            json!({"downsample_to":[320,240],"format_required":"jpeg"}),
        ];
        for params in cases {
            let resp = handle_line(
                &json!({
                    "jsonrpc": "2.0",
                    "method": "sensorium.subscribe.start",
                    "params": {
                        "topic": "sensor/test/realsense/depth",
                        "downsample_to": params.get("downsample_to").cloned().unwrap_or(Value::Null),
                        "format_required": params.get("format_required").cloned().unwrap_or(Value::Null),
                    },
                    "id": "bad-depth-transform",
                })
                .to_string(),
                make_state(),
                tx.clone(),
            )
            .await;
            assert_eq!(resp["error"]["code"], json!(INVALID_PARAMS), "{resp}");
            assert_eq!(resp["error"]["code_name"], "invalid_params");
        }
    }

    #[tokio::test]
    async fn start_rejects_presence_transform_on_color_topic_before_opening_subscription() {
        let (tx, _rx) = make_output();
        let resp = handle_line(
            &json!({
                "jsonrpc": "2.0",
                "method": "sensorium.subscribe.start",
                "params": {
                    "topic": "sensor/test/realsense/color",
                    "presence_transform": true,
                },
                "id": "bad-presence-transform",
            })
            .to_string(),
            make_state(),
            tx,
        )
        .await;

        assert_eq!(resp["error"]["code"], json!(INVALID_PARAMS));
        assert_eq!(resp["error"]["code_name"], "invalid_params");
        assert!(resp["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("presence_transform requires a realsense depth topic"));
    }

    #[tokio::test]
    async fn start_rejects_raw_depth_transform_params_with_presence_transform() {
        let (tx, _rx) = make_output();
        let resp = handle_line(
            &json!({
                "jsonrpc": "2.0",
                "method": "sensorium.subscribe.start",
                "params": {
                    "topic": "sensor/test/realsense/depth",
                    "presence_transform": true,
                    "format_required": "png",
                },
                "id": "bad-presence-transform",
            })
            .to_string(),
            make_state(),
            tx,
        )
        .await;

        assert_eq!(resp["error"]["code"], json!(INVALID_PARAMS));
        assert!(resp["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("format_required is not allowed with presence_transform"));
    }

    #[test]
    fn color_transform_downsamples_jpeg_payload_without_passthrough() {
        let payload = color_payload(1280, 720);
        let transformed = transform_color_payload(
            &payload,
            &ColorTransformConfig {
                max_width: 320,
                max_height: 240,
                format_required: "jpeg".to_string(),
            },
        )
        .expect("transform color payload");
        assert_ne!(transformed, payload);

        let frame: ColorFrame = rmp_serde::from_slice(&transformed).expect("decode transformed");
        assert_eq!(frame.schema_version, 1);
        assert_eq!(frame.frame_number, 42);
        assert_eq!(frame.format, "jpeg");
        assert!(frame.width <= 320, "width was {}", frame.width);
        assert!(frame.height <= 240, "height was {}", frame.height);
        assert_eq!((frame.width, frame.height), (320, 180));

        let decoded = image::load_from_memory(&frame.data).expect("decode transformed jpeg");
        assert_eq!(decoded.dimensions(), (320, 180));
    }

    #[test]
    fn color_transform_never_enlarges_small_frames() {
        let payload = color_payload(160, 90);
        let transformed = transform_color_payload(
            &payload,
            &ColorTransformConfig {
                max_width: 320,
                max_height: 240,
                format_required: "jpeg".to_string(),
            },
        )
        .expect("transform color payload");
        let frame: ColorFrame = rmp_serde::from_slice(&transformed).expect("decode transformed");
        assert_eq!((frame.width, frame.height), (160, 90));
    }

    #[test]
    fn color_transform_rejects_malformed_payloads_instead_of_passthrough() {
        assert_eq!(
            transform_color_payload(
                &[0xc1],
                &ColorTransformConfig {
                    max_width: 320,
                    max_height: 240,
                    format_required: "jpeg".to_string(),
                },
            )
            .unwrap_err(),
            "color_msgpack_decode_failed",
        );

        let mut frame: ColorFrame = rmp_serde::from_slice(&color_payload(1280, 720)).unwrap();
        frame.data = vec![1, 2, 3, 4];
        let malformed_jpeg = rmp_serde::to_vec_named(&frame).unwrap();
        assert_eq!(
            transform_color_payload(
                &malformed_jpeg,
                &ColorTransformConfig {
                    max_width: 320,
                    max_height: 240,
                    format_required: "jpeg".to_string(),
                },
            )
            .unwrap_err(),
            "color_jpeg_decode_failed",
        );
    }

    #[test]
    fn depth_transform_downsamples_png_payload_without_passthrough() {
        let payload = depth_payload(1280, 720);
        let transformed = transform_depth_payload(
            &payload,
            &DepthTransformConfig {
                max_width: 320,
                max_height: 240,
                format_required: "png".to_string(),
            },
        )
        .expect("transform depth payload");
        assert_ne!(transformed, payload);

        let frame: DepthFrame = rmp_serde::from_slice(&transformed).expect("decode transformed");
        assert_eq!(frame.schema_version, 1);
        assert_eq!(frame.frame_number, 42);
        assert_eq!(frame.format, "png");
        assert_eq!(frame.depth_units, 0.001);
        assert!(frame.width <= 320, "width was {}", frame.width);
        assert!(frame.height <= 240, "height was {}", frame.height);
        assert_eq!((frame.width, frame.height), (320, 180));

        let decoded =
            image::load_from_memory_with_format(&frame.data, ImageFormat::Png).expect("decode png");
        assert_eq!(decoded.dimensions(), (320, 180));
    }

    #[test]
    fn depth_transform_never_enlarges_small_frames() {
        let payload = depth_payload(160, 90);
        let transformed = transform_depth_payload(
            &payload,
            &DepthTransformConfig {
                max_width: 320,
                max_height: 240,
                format_required: "png".to_string(),
            },
        )
        .expect("transform depth payload");
        let frame: DepthFrame = rmp_serde::from_slice(&transformed).expect("decode transformed");
        assert_eq!((frame.width, frame.height), (160, 90));
    }

    #[test]
    fn depth_transform_rejects_malformed_payloads_instead_of_passthrough() {
        assert_eq!(
            transform_depth_payload(
                &[0xc1],
                &DepthTransformConfig {
                    max_width: 320,
                    max_height: 240,
                    format_required: "png".to_string(),
                },
            )
            .unwrap_err(),
            "depth_msgpack_decode_failed",
        );

        let mut frame: DepthFrame = rmp_serde::from_slice(&depth_payload(1280, 720)).unwrap();
        frame.data = vec![1, 2, 3, 4];
        let malformed_png = rmp_serde::to_vec_named(&frame).unwrap();
        assert_eq!(
            transform_depth_payload(
                &malformed_png,
                &DepthTransformConfig {
                    max_width: 320,
                    max_height: 240,
                    format_required: "png".to_string(),
                },
            )
            .unwrap_err(),
            "depth_png_decode_failed",
        );

        let mut invalid_units: DepthFrame =
            rmp_serde::from_slice(&depth_payload(1280, 720)).unwrap();
        invalid_units.depth_units = 0.0;
        let invalid_units_payload = rmp_serde::to_vec_named(&invalid_units).unwrap();
        assert_eq!(
            transform_depth_payload(
                &invalid_units_payload,
                &DepthTransformConfig {
                    max_width: 320,
                    max_height: 240,
                    format_required: "png".to_string(),
                },
            )
            .unwrap_err(),
            "depth_units_invalid",
        );
    }

    #[test]
    fn presence_transform_emits_event_without_raw_payload_fields() {
        let payload = synthetic_depth_payload(|x, y| {
            if (45..85).contains(&x) && (20..70).contains(&y) {
                2_000
            } else {
                6_000
            }
        });
        let event =
            match transform_sample_payload(&payload, Some(&SampleTransformConfig::DepthPresence))
                .expect("presence transform")
            {
                TransformResult::PresenceEvent(event) => event,
                TransformResult::PayloadBytes(_) => {
                    panic!("presence transform returned payload bytes")
                }
            };
        assert_eq!(event.count_bucket, "1");
        assert_eq!(event.additional_person_present, "not_detected");
        assert_eq!(event.identity, "not_performed");
        assert_eq!(event.seth_present, "unknown");
        assert_eq!(event.raw_payload_included, false);
        assert_eq!(event.raw_payload_allowed_to_node, false);

        let notification = json!({
            "jsonrpc": "2.0",
            "method": "sensorium.presence.depth.event",
            "params": {
                "subscription_id": "sub-presence",
                "topic": "sensor/test/realsense/depth",
                "event": event,
            }
        });
        let serialized = notification.to_string();
        for forbidden in [
            "payload_bytes",
            "payload_size",
            "\"data\"",
            "\"image\"",
            "depth_units",
            "\"width\"",
            "\"height\"",
            "frame_number",
            "timestamp",
        ] {
            assert!(
                !serialized.contains(forbidden),
                "presence notification leaked forbidden field {forbidden}: {serialized}"
            );
        }
    }

    #[test]
    fn presence_transform_keeps_raw_depth_transform_path_separate() {
        let payload = depth_payload(160, 90);
        let transformed = transform_sample_payload(
            &payload,
            Some(&SampleTransformConfig::Depth(DepthTransformConfig {
                max_width: 80,
                max_height: 45,
                format_required: "png".to_string(),
            })),
        )
        .expect("raw depth transform");

        match transformed {
            TransformResult::PayloadBytes(bytes) => {
                assert!(!bytes.is_empty());
                let frame: DepthFrame = rmp_serde::from_slice(&bytes).expect("decode depth frame");
                assert_eq!((frame.width, frame.height), (80, 45));
                assert_eq!(frame.format, "png");
            }
            TransformResult::PresenceEvent(_) => {
                panic!("raw depth transform returned presence event")
            }
        }
    }

    #[test]
    fn presence_transform_counts_empty_one_and_two_body_buckets() {
        let far_background =
            transform_depth_presence_payload(&synthetic_depth_payload(|_, _| 6_000));
        assert_eq!(far_background.count_bucket, "0");
        assert_eq!(far_background.additional_person_present, "not_detected");

        let one = transform_depth_presence_payload(&synthetic_depth_payload(|x, y| {
            if (45..85).contains(&x) && (20..70).contains(&y) {
                2_000
            } else {
                6_000
            }
        }));
        assert_eq!(one.count_bucket, "1");
        assert_eq!(one.additional_person_present, "not_detected");

        let two = transform_depth_presence_payload(&synthetic_depth_payload(|x, y| {
            if ((20..55).contains(&x) && (20..70).contains(&y))
                || ((100..135).contains(&x) && (20..70).contains(&y))
            {
                2_000
            } else {
                6_000
            }
        }));
        assert_eq!(two.count_bucket, "2_plus");
        assert_eq!(two.additional_person_present, "present");
    }

    #[test]
    fn presence_transform_biases_blank_ambiguous_and_malformed_frames_to_unknown() {
        let blank = transform_depth_presence_payload(&synthetic_depth_payload(|_, _| 0));
        assert_eq!(blank.count_bucket, "unknown");
        assert_eq!(blank.additional_person_present, "unknown");
        assert_eq!(blank.confidence_bucket, "low");

        let giant_slab = transform_depth_presence_payload(&synthetic_depth_payload(|x, y| {
            if (10..150).contains(&x) && (10..80).contains(&y) {
                2_000
            } else {
                6_000
            }
        }));
        assert_eq!(giant_slab.count_bucket, "unknown");
        assert_eq!(giant_slab.additional_person_present, "unknown");

        let noisy = transform_depth_presence_payload(&synthetic_depth_payload(|x, y| {
            if x % 11 < 3 && y % 13 < 3 {
                2_000
            } else {
                6_000
            }
        }));
        assert_eq!(noisy.count_bucket, "unknown");
        assert_eq!(noisy.additional_person_present, "unknown");

        let malformed = transform_depth_presence_payload(&[0xc1]);
        assert_eq!(malformed.count_bucket, "unknown");
        assert_eq!(malformed.additional_person_present, "unknown");
        assert_eq!(malformed.raw_payload_included, false);
    }

    // Zenoh requires a multi-thread tokio runtime; current_thread
    // panics during session creation. The production main() already
    // uses multi_thread; this attribute matches.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn start_with_topic_succeeds_and_returns_subscription_id() {
        // This actually opens a Zenoh session — which the default
        // sandbox config allows without binding network listeners or
        // joining multicast discovery. Without any publisher reachable,
        // no samples will arrive, but the session and subscriber should
        // both come up successfully.
        let (tx, _rx) = make_output();
        let zenoh_config_path = sandbox_zenoh_config_path();
        let resp = handle_line(
            &format!(
                r#"{{"jsonrpc":"2.0","method":"sensorium.subscribe.start","params":{{"topic":"sensor/test/status","zenoh_config_path":"{}"}},"id":"start-1"}}"#,
                zenoh_config_path.display()
            ),
            make_state(),
            tx,
        )
        .await;
        assert!(
            resp.get("result").is_some(),
            "expected a result, got: {resp}"
        );
        let result = &resp["result"];
        assert_eq!(result["topic"], "sensor/test/status");
        assert!(
            result["subscription_id"].as_str().is_some(),
            "expected subscription_id to be a string"
        );
        assert_eq!(resp["id"], "start-1");
    }
}

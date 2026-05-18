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
use std::io::Cursor;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::GenericImageView;
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

type Output = mpsc::UnboundedSender<String>;

#[derive(Clone, Debug, PartialEq, Eq)]
struct ColorTransformConfig {
    max_width: u32,
    max_height: u32,
    format_required: String,
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
    let (output_tx, mut output_rx) = mpsc::unbounded_channel::<String>();

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
                if output_tx.send(response.to_string()).is_err() {
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
    let color_transform = match parse_optional_color_transform(&params) {
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
                    let bytes = match transform_sample_payload(&original, color_transform.as_ref())
                    {
                        Ok(bytes) => bytes,
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
                            let _ = output_tx.send(notification.to_string());
                            break;
                        }
                    };
                    let notification = json!({
                        "jsonrpc": "2.0",
                        "method": "sensorium.subscription.sample",
                        "params": {
                            "subscription_id": sub_id_for_task,
                            "topic": topic_for_task,
                            "payload_bytes": bytes,
                            "payload_size": bytes.len(),
                        }
                    });
                    if output_tx.send(notification.to_string()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
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

fn parse_optional_max_fps(params: &Value) -> Result<Option<u32>, String> {
    match params.get("max_fps") {
        None | Some(Value::Null) => Ok(None),
        Some(value) => match value.as_u64() {
            Some(raw) if (1..=30).contains(&raw) => Ok(Some(raw as u32)),
            _ => Err("subscribe.start params.max_fps must be an integer from 1 to 30".to_string()),
        },
    }
}

fn parse_optional_color_transform(params: &Value) -> Result<Option<ColorTransformConfig>, String> {
    let downsample = match params.get("downsample_to") {
        None | Some(Value::Null) => None,
        Some(value) => Some(parse_downsample_to(value)?),
    };
    let format_required = match params.get("format_required") {
        None | Some(Value::Null) => None,
        Some(value) => match value.as_str() {
            Some("jpeg") => Some("jpeg".to_string()),
            Some(_) => {
                return Err(
                    "subscribe.start params.format_required must be jpeg for color transforms"
                        .to_string(),
                )
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
        (Some((max_width, max_height)), Some(format_required)) => Ok(Some(ColorTransformConfig {
            max_width,
            max_height,
            format_required,
        })),
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
    color_transform: Option<&ColorTransformConfig>,
) -> Result<Vec<u8>, &'static str> {
    match color_transform {
        None => Ok(payload.to_vec()),
        Some(config) => transform_color_payload(payload, config),
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
    use image::{DynamicImage, ImageBuffer, Rgb};
    use std::fs;
    use std::path::PathBuf;

    fn make_state() -> Arc<Mutex<State>> {
        Arc::new(Mutex::new(State::default()))
    }

    fn make_output() -> (Output, mpsc::UnboundedReceiver<String>) {
        mpsc::unbounded_channel::<String>()
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

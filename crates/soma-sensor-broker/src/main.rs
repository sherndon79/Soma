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
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

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
        return error_response(Value::Null, PARSE_ERROR, "parse_error", "empty request line");
    }

    let request: Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(e) => return error_response(Value::Null, PARSE_ERROR, "parse_error", &e.to_string()),
    };

    let id = request.get("id").cloned().unwrap_or(Value::Null);

    if request.get("jsonrpc").and_then(|v| v.as_str()) != Some("2.0") {
        return error_response(id, INVALID_REQUEST, "invalid_request", "jsonrpc must be \"2.0\"");
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
        "sensorium.subscribe.start"  => handle_subscribe_start(id, params, state, output_tx).await,
        "sensorium.subscribe.stop"   => handle_subscribe_stop(id, params, state).await,
        "sensorium.subscribe.status" => handle_subscribe_status(id, params, state).await,
        _ => error_response(
            id,
            METHOD_IMPLEMENTATION_PENDING,
            "method_implementation_pending",
            &format!(
                "{method} recognized; implementation pending later activation slice"
            ),
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
        loop {
            match subscriber.recv_async().await {
                Ok(sample) => {
                    let bytes = sample.payload().to_bytes().to_vec();
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

    fn make_state() -> Arc<Mutex<State>> {
        Arc::new(Mutex::new(State::default()))
    }

    fn make_output() -> (Output, mpsc::UnboundedReceiver<String>) {
        mpsc::unbounded_channel::<String>()
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

        // start
        let start_resp = handle_line(
            r#"{"jsonrpc":"2.0","method":"sensorium.subscribe.start","params":{"topic":"sensor/test/status"},"id":"s"}"#,
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
        assert_eq!(list_resp["result"]["subscriptions"][0]["subscription_id"], sub_id);

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

    // Zenoh requires a multi-thread tokio runtime; current_thread
    // panics during session creation. The production main() already
    // uses multi_thread; this attribute matches.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn start_with_topic_succeeds_and_returns_subscription_id() {
        // This actually opens a Zenoh session — which the default
        // config allows (peer-mode loopback). Without any publisher
        // reachable, no samples will arrive, but the session and
        // subscriber should both come up successfully.
        let (tx, _rx) = make_output();
        let resp = handle_line(
            r#"{"jsonrpc":"2.0","method":"sensorium.subscribe.start","params":{"topic":"sensor/test/status"},"id":"start-1"}"#,
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

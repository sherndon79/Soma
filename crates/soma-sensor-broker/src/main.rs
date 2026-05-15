//! Soma sensor-broker helper.
//!
//! Long-lived JSON-RPC over stdio. Reads request lines from stdin,
//! writes one response line to stdout per request, until EOF.
//!
//! This is the helper named in
//! `docs/concepts/drafts/sensorium_integration.md` "Subscription
//! Invocation Contract" — the long-lived process that will own the
//! Zenoh client when activation lands. For now (step 7 of the
//! disabled-first sequence) every method is a stub: recognized methods
//! return an explicit `method_implementation_pending` error so the
//! Node service plane has a stable, well-formed signal that the helper
//! exists and recognizes the protocol but cannot fulfill the request.
//! No Zenoh client, no live subscription state, no frame flow.
//!
//! The fail-closed property is preserved by design, not by absence:
//! even if a future Node endpoint accidentally invokes this helper,
//! every response is a structured error.

use std::io::{BufRead, BufReader, Write};
use std::process::ExitCode;

use serde_json::{json, Value};

const KNOWN_METHODS: &[&str] = &[
    "sensorium.subscribe.start",
    "sensorium.subscribe.stop",
    "sensorium.subscribe.status",
];

// JSON-RPC 2.0 standard error codes.
const PARSE_ERROR: i64 = -32700;
const INVALID_REQUEST: i64 = -32600;
const METHOD_NOT_FOUND: i64 = -32601;

// Server-defined range (-32000 to -32099). We use -32001 specifically
// for "recognized method, implementation pending" so Node can
// distinguish "method we don't know about" from "method we know
// about but haven't wired yet."
const METHOD_IMPLEMENTATION_PENDING: i64 = -32001;

fn main() -> ExitCode {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut stdout = stdout.lock();

    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => return ExitCode::SUCCESS, // EOF
            Ok(_) => {
                let response = handle_line(&line);
                if writeln!(stdout, "{response}").is_err() {
                    return ExitCode::from(2);
                }
                if stdout.flush().is_err() {
                    return ExitCode::from(2);
                }
            }
            Err(_) => return ExitCode::from(2),
        }
    }
}

fn handle_line(line: &str) -> Value {
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
        Err(e) => {
            return error_response(
                Value::Null,
                PARSE_ERROR,
                "parse_error",
                &e.to_string(),
            )
        }
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

    error_response(
        id,
        METHOD_IMPLEMENTATION_PENDING,
        "method_implementation_pending",
        &format!(
            "{method} recognized; implementation pending step 9 of disabled-first sequence"
        ),
    )
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

    fn parse(line: &str) -> Value {
        handle_line(line)
    }

    #[test]
    fn empty_line_returns_parse_error() {
        let resp = parse("");
        assert_eq!(resp["error"]["code"], json!(PARSE_ERROR));
        assert_eq!(resp["error"]["code_name"], "parse_error");
        assert_eq!(resp["id"], Value::Null);
    }

    #[test]
    fn malformed_json_returns_parse_error() {
        let resp = parse("not json {");
        assert_eq!(resp["error"]["code"], json!(PARSE_ERROR));
        assert_eq!(resp["error"]["code_name"], "parse_error");
    }

    #[test]
    fn missing_jsonrpc_version_returns_invalid_request() {
        let resp = parse(r#"{"method":"sensorium.subscribe.start","id":1}"#);
        assert_eq!(resp["error"]["code"], json!(INVALID_REQUEST));
        assert_eq!(resp["error"]["code_name"], "invalid_request");
    }

    #[test]
    fn missing_method_returns_invalid_request() {
        let resp = parse(r#"{"jsonrpc":"2.0","id":1}"#);
        assert_eq!(resp["error"]["code"], json!(INVALID_REQUEST));
        assert_eq!(resp["error"]["code_name"], "invalid_request");
    }

    #[test]
    fn unknown_method_returns_method_not_found() {
        let resp = parse(r#"{"jsonrpc":"2.0","method":"sensorium.subscribe.invent","id":1}"#);
        assert_eq!(resp["error"]["code"], json!(METHOD_NOT_FOUND));
        assert_eq!(resp["error"]["code_name"], "method_not_found");
        assert_eq!(resp["id"], json!(1));
    }

    #[test]
    fn known_methods_return_implementation_pending_with_id_echo() {
        for method in KNOWN_METHODS {
            let request = format!(
                r#"{{"jsonrpc":"2.0","method":"{method}","params":{{}},"id":"req-{method}"}}"#
            );
            let resp = parse(&request);
            assert_eq!(
                resp["error"]["code"],
                json!(METHOD_IMPLEMENTATION_PENDING),
                "method {method} should return implementation_pending"
            );
            assert_eq!(
                resp["error"]["code_name"], "method_implementation_pending",
                "method {method} should carry code_name"
            );
            assert_eq!(
                resp["id"],
                json!(format!("req-{method}")),
                "method {method} should echo the request id"
            );
        }
    }

    #[test]
    fn responses_are_always_well_formed_jsonrpc_2_0() {
        // Property: regardless of input, the response should be valid
        // JSON-RPC 2.0 (jsonrpc field = "2.0", an id field exists,
        // either result or error but not both). For step 7 every
        // response is an error, but the shape requirement holds.
        for input in [
            "",
            "not json",
            r#"{"jsonrpc":"2.0"}"#,
            r#"{"jsonrpc":"1.0","method":"sensorium.subscribe.start","id":1}"#,
            r#"{"jsonrpc":"2.0","method":"sensorium.subscribe.start","id":1}"#,
            r#"{"jsonrpc":"2.0","method":"unknown","id":2}"#,
        ] {
            let resp = parse(input);
            assert_eq!(resp["jsonrpc"], "2.0", "input {input:?} jsonrpc field");
            assert!(resp.get("id").is_some(), "input {input:?} id field present");
            assert!(
                resp.get("error").is_some(),
                "input {input:?} should produce an error response in step 7"
            );
            assert!(
                resp.get("result").is_none(),
                "input {input:?} must not produce a result in step 7"
            );
        }
    }

    #[test]
    fn no_method_returns_a_successful_result_in_step_7() {
        // Step-7 invariant. No method produces a `result` field. If
        // any of the three known methods accidentally returns a
        // success, fail-closed has been violated and this test
        // catches it.
        for method in KNOWN_METHODS {
            let request = format!(r#"{{"jsonrpc":"2.0","method":"{method}","id":1}}"#);
            let resp = parse(&request);
            assert!(
                resp.get("result").is_none(),
                "method {method} returned a successful result; fail-closed broken"
            );
        }
    }
}

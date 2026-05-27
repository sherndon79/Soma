//! Soma Moonlight broker helper scaffold.
//!
//! Long-lived JSON-RPC over stdio. This first slice recognizes the
//! future live remote-graphical broker methods but deliberately returns
//! method_implementation_pending for each of them. It does not link
//! Moonlight libraries, spawn Sunshine/Moonlight commands, open sockets,
//! pair, persist credentials, capture video, dispatch input, record, or
//! clean up provider sessions.

use std::io::{self, BufRead, Write};

use serde_json::{json, Value};

const KNOWN_METHODS: &[&str] = &[
    "remote_graphical.status",
    "remote_graphical.open_session",
    "remote_graphical.describe_active",
    "remote_graphical.cleanup_for_grant",
];

const PARSE_ERROR: i64 = -32700;
const INVALID_REQUEST: i64 = -32600;
const METHOD_NOT_FOUND: i64 = -32601;
const METHOD_IMPLEMENTATION_PENDING: i64 = -32001;

fn main() -> std::process::ExitCode {
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => break,
        };
        let response = handle_line(&line);
        if writeln!(stdout, "{response}").is_err() {
            break;
        }
        let _ = stdout.flush();
    }

    std::process::ExitCode::SUCCESS
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
        Ok(value) => value,
        Err(error) => {
            return error_response(Value::Null, PARSE_ERROR, "parse_error", &error.to_string());
        }
    };

    let id = request.get("id").cloned().unwrap_or(Value::Null);

    if request.get("jsonrpc").and_then(|value| value.as_str()) != Some("2.0") {
        return error_response(
            id,
            INVALID_REQUEST,
            "invalid_request",
            "jsonrpc must be \"2.0\"",
        );
    }

    let method = match request.get("method").and_then(|value| value.as_str()) {
        Some(method) => method,
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
        &format!("{method} recognized; implementation pending later activation slice"),
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

    #[test]
    fn known_methods_return_implementation_pending() {
        for method in KNOWN_METHODS {
            let response = handle_line(&format!(
                r#"{{"jsonrpc":"2.0","method":"{method}","id":"test"}}"#
            ));
            assert_eq!(response["error"]["code"], METHOD_IMPLEMENTATION_PENDING);
            assert_eq!(response["error"]["code_name"], "method_implementation_pending");
            assert_eq!(response["id"], "test");
        }
    }

    #[test]
    fn unknown_method_returns_method_not_found() {
        let response =
            handle_line(r#"{"jsonrpc":"2.0","method":"remote_graphical.invent","id":1}"#);
        assert_eq!(response["error"]["code"], METHOD_NOT_FOUND);
        assert_eq!(response["error"]["code_name"], "method_not_found");
    }

    #[test]
    fn invalid_jsonrpc_returns_invalid_request() {
        let response = handle_line(r#"{"method":"remote_graphical.status","id":1}"#);
        assert_eq!(response["error"]["code"], INVALID_REQUEST);
        assert_eq!(response["error"]["code_name"], "invalid_request");
    }

    #[test]
    fn parse_error_is_bounded() {
        let response = handle_line("{not-json");
        assert_eq!(response["error"]["code"], PARSE_ERROR);
        assert_eq!(response["error"]["code_name"], "parse_error");
        assert_eq!(response["id"], Value::Null);
    }
}

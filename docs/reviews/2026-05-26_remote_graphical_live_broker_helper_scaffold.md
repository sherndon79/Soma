# Remote Graphical Live Broker Helper Scaffold Review

Review after adding the non-activating Moonlight broker helper and Node manager scaffold.

## Scope

- `Cargo.toml`
- `crates/soma-moonlight-broker/Cargo.toml`
- `crates/soma-moonlight-broker/src/main.rs`
- `src/remoteGraphicalLiveBrokerManager.js`
- `test/remoteGraphicalLiveBrokerManager.test.js`
- `package.json`
- `docs/concepts/drafts/remote_graphical_live_broker_adapter_plan.md`
- `ROADMAP.md`

## Summary

Soma now has a stubbed Rust helper binary:

```text
soma-moonlight-broker
```

It recognizes the future live remote-graphical JSON-RPC methods:

```text
remote_graphical.status
remote_graphical.open_session
remote_graphical.describe_active
remote_graphical.cleanup_for_grant
```

Every recognized method returns `method_implementation_pending`. Unknown methods return
`method_not_found`. Invalid JSON-RPC requests and parse errors return bounded JSON-RPC errors.

The Node manager can spawn the helper, send these methods, and map helper errors, but no runtime or
HTTP route instantiates it.

## Boundary

This slice does not link Moonlight libraries, spawn Sunshine/Moonlight commands, open sockets, pair,
persist credentials, open sessions, observe video, capture screenshots, run OCR, dispatch input,
record, clean up provider sessions, append provenance, write grants, or deliver visual payloads to a
model.

## Verification

- `cargo test -p soma-moonlight-broker`
- `node --test test/remoteGraphicalLiveBrokerManager.test.js test/remoteGraphicalLiveBrokerReadiness.test.js test/remoteGraphicalSessionOpenRouteGate.test.js`

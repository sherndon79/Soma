# Remote Graphical Live Broker Status Contract Review

Date: 2026-05-26

## Scope

- `src/remoteGraphicalLiveBrokerStatus.js`
- `test/remoteGraphicalLiveBrokerStatus.test.js`
- `docs/concepts/drafts/remote_graphical_live_broker_adapter_plan.md`
- `ROADMAP.md`

## Summary

This slice adds a pure status result contract for the future live Sunshine/Moonlight helper. The
contract accepts only bounded provider-neutral metadata: schema version, provider id, target host,
status/state, configured/reachable/degraded flags, retryable posture, active session count,
capability names, and a bounded summary.

The contract rejects provider secrets and content-bearing fields such as credentials, tokens,
pairing pins, screenshots, frame bytes, OCR text, clipboard contents, input events, audio payloads,
stdout/stderr, transport logs, stack traces, raw diagnostics, process details, environment
variables, and command lines.

## Boundary

Implemented:

- pure validator/constructor for configured, unconfigured, degraded, and schema-mismatch status
  metadata
- tests for bounded acceptance and fail-closed over-disclosure rejection
- adapter-plan documentation of allowed/forbidden status output fields

Not implemented:

- any Sunshine/Moonlight status probing
- helper method implementation; `soma-moonlight-broker` still returns `method_implementation_pending`
- runtime manager startup or route invocation
- session-open, pairing, video observation, input dispatch, recording, model delivery, durable grant
  writes, or live provenance append

## Verification

- `node --test test/remoteGraphicalLiveBrokerStatus.test.js`
- `npm test`

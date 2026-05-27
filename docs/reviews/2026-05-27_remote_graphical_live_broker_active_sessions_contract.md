# Remote Graphical Live Broker Active Sessions Contract Review

Date: 2026-05-27

## Scope

- `src/remoteGraphicalLiveBrokerActiveSessions.js`
- `test/remoteGraphicalLiveBrokerActiveSessions.test.js`
- `docs/concepts/drafts/remote_graphical_live_broker_adapter_plan.md`
- `ROADMAP.md`

## Summary

This slice adds a pure `describe_active` result contract for future live Sunshine/Moonlight helpers.
The contract accepts an empty active set and bounded opened-but-not-observing session metadata. It
normalizes per-session authority fields so active sessions remain explicit about inactive video,
input, recording, and model delivery authority.

The contract rejects content-bearing and provider-secret fields including screenshots, frame bytes,
recognized text, clipboard contents, input events, window metadata, file paths, audio payloads,
stdout/stderr, transport logs, diagnostics, stack traces, process/environment details, command
lines, credentials, tokens, and pairing pins.

## Boundary

Implemented:

- pure validator/constructor for bounded active-session metadata
- tests for empty, one-session, schema-mismatch, malformed, and over-disclosing shapes
- adapter-plan documentation of allowed/forbidden `describe_active` output fields

Not implemented:

- any Sunshine/Moonlight active-session probing
- helper method implementation; `soma-moonlight-broker` still returns `method_implementation_pending`
- runtime manager startup or route invocation
- session-open, pairing, video observation, input dispatch, recording, model delivery, durable grant
  writes, cleanup invocation, or live provenance append

## Verification

- `node --test test/remoteGraphicalLiveBrokerActiveSessions.test.js`
- `npm test`

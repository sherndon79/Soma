# Remote Graphical Live Broker Cleanup Result Contract Review

Date: 2026-05-27

## Scope

- `src/remoteGraphicalLiveBrokerCleanupResult.js`
- `test/remoteGraphicalLiveBrokerCleanupResult.test.js`
- `docs/concepts/drafts/remote_graphical_live_broker_adapter_plan.md`
- `ROADMAP.md`

## Summary

This slice adds a pure `cleanup_for_grant` result contract for future live Sunshine/Moonlight
helpers. The contract accepts bounded no-op, stopped-session, and failed-cleanup metadata. Stopped
session counts are derived from sanitized Soma-opened session ids, and failed cleanup requires a
stable cause code rather than provider diagnostics.

The contract rejects content-bearing and provider-secret fields including screenshots, frame bytes,
recognized text, clipboard contents, input events, window metadata, file paths, audio payloads,
stdout/stderr, transport logs, diagnostics, stack traces, process/environment details, command
lines, credentials, tokens, and pairing pins.

## Boundary

Implemented:

- pure validator/constructor for bounded cleanup result metadata
- tests for no-op, stopped-session, failed-cleanup, schema-mismatch, malformed, and
  over-disclosing shapes
- adapter-plan documentation of allowed/forbidden `cleanup_for_grant` output fields

Not implemented:

- any Sunshine/Moonlight cleanup action
- helper method implementation; `soma-moonlight-broker` still returns `method_implementation_pending`
- runtime manager startup, grant revocation cleanup, process-shutdown cleanup, or route invocation
- session-open, pairing, video observation, input dispatch, recording, model delivery, durable grant
  writes, or live provenance append

## Verification

- `node --test test/remoteGraphicalLiveBrokerCleanupResult.test.js`
- `npm test`

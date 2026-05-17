# Sensorium Live Smoke Runbook

Date: 2026-05-17

Scope:

- `docs/runbooks/sensorium_live_smoke.md`
- `docs/operators.md`
- `docs/concepts/drafts/sensorium_integration.md`
- `docs/README.md`
- `ROADMAP.md`

## Finding

Soma now has a manual opt-in live smoke workflow for helper-backed Sensorium subscriptions. The
workflow starts with the low-risk status topic and walks through proposal review, approval, runtime
grant creation, subscription start/list/stop, and runtime grant revocation.

## Accepted Boundary

The runbook requires:

- `SOMA_SENSORIUM_ENABLED=1`
- a working `soma-sensor-broker` helper
- an explicit runtime grant
- a bounded `max_seconds` subscription

It does not introduce default Sensorium grants or durable Sensorium grant writes.

## Non-Recording Posture

The workflow explicitly avoids recording, decoding, preprocessing, screenshots, raw samples, and
payload inspection. It verifies metadata-only disclosure and provenance behavior.

## Actionable Follow-Up

After the manual runbook has been exercised against a real Sensorium publisher, decide whether an
automation script is useful. Any script should be disabled by default and require explicit live-smoke
environment gates.

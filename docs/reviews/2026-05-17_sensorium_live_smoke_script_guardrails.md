# Sensorium Live Smoke Script Guardrails Review

**Date:** 2026-05-17
**Scope:** Review after adding the guarded `npm run sensorium:smoke` wrapper around the manual
Sensorium live smoke workflow.

## Findings

No blocking issues found.

## Disposition

The wrapper preserves the intended operator posture:

- refuses unless `SOMA_SENSORIUM_ENABLED=1` and `SOMA_SENSORIUM_LIVE_SMOKE=1` are present
- defaults to the low-risk `sensor/jetsorano/status` topic
- requires the full target tuple when retargeting so partial custom targets fail closed
- prints the exact CLI command sequence before execution
- keeps proposal creation, approval, runtime grant creation, subscription start, subscription stop,
  and grant revocation as separate visible steps
- writes only process-local runtime grants and does not touch `config/grants.json`
- does not record, decode, or preprocess payloads

## Residual Risk

The script has only been exercised through guard/dry-run checks and unit coverage in this slice.
The next review trigger is a real helper-backed smoke run against the current `jetsorano`
publisher. That run should capture whether Zenoh discovery, helper startup, status-topic
subscription, disclosure, stop, and grant revocation all behave as documented.

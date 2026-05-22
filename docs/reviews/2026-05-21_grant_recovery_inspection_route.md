# Grant Recovery Inspection Route

Review after adding a read-only operator surface for grant mutation recovery inspection.

## Scope

- `src/app.js`
- `test/app.test.js`
- `docs/operators.md`
- `docs/architecture/mvp_slice.md`
- `ROADMAP.md`

## Summary

`GET /grants/recovery` now reports the current grant recovery inspection summary when the request
handler has one. This gives operators a stable way to inspect degraded grant authority without
enabling writable grant mutation.

Route behavior:

- no recovery report returns `recovery_inspection_available: false` and `ok: null`
- degraded reports return bounded finding metadata
- mismatch values and grant reason text are omitted from findings
- response declares `durable: false`, `activation_performed: false`, and
  `runtime_writes_enabled: false`

## Boundary

This is an inspection-only route. It does not load durable provenance by itself, write grants,
repair recovery findings, append provenance, enable CLI mutation, authorize capability use, start
Sensorium subscriptions, or deliver visual payloads.

## Residual Risk

The route depends on the caller wiring a recovery report into the request handler. Durable grant
loading still needs an explicit composition step that reads durable grant provenance, runs recovery
inspection, and supplies the report before durable grants can authorize runtime behavior.

Verification: `node --test test/app.test.js` passes.

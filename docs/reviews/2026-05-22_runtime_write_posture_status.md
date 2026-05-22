# Runtime Write Posture Status

Review after adding read-only runtime write posture reporting.

## Scope

- `src/runtimeWritePosture.js`
- `src/app.js`
- `src/server.js`
- `src/cli.js`
- `test/runtimeWritePosture.test.js`
- `test/app.test.js`
- `test/cli.test.js`
- `docs/architecture/mvp_slice.md`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

Soma now exposes runtime write posture in read-only status surfaces. `/health`, `/grants`, and
`/grants/recovery` report `runtime_writes_enabled: false` plus a `runtime_write_posture` object.
The server reads `SOMA_RUNTIME_WRITES_ENABLED` as a requested posture only; because durable grant
mutation activation is not implemented, the effective write flag remains false.

The CLI status payload lifts the same posture from `/health` for operator inspection.

## Boundary

This slice does not add writable grant routes, CLI mutation commands, durable grant-store writes,
runtime write activation, recovery repair, capability activation, subscriptions, provider/helper
invocation, or model delivery. The new environment variable is informational only.

## Residual Risk

Future activation work must not reinterpret the current requested posture as sufficient authority.
The activation slice still needs explicit operator controls, focused review, and commit-route tests.

Verification: `node --test test/runtimeWritePosture.test.js test/app.test.js test/cli.test.js`
passes.

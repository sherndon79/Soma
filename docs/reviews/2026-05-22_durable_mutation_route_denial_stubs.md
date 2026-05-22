# Durable Mutation Route Denial Stubs

Review after adding explicit disabled responses for reserved durable grant mutation routes.

## Scope

- `src/app.js`
- `test/app.test.js`
- `docs/architecture/mvp_slice.md`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

The reserved durable commit routes now fail explicitly:

- `POST /grants`
- `POST /grants/:id/revoke`

Both return `durable_grant_mutation_not_enabled` with runtime write posture, activation-policy
links, and non-write flags: `durable: false`, `grant_written: false`, `provenance_appended: false`,
`activation_performed: false`, `subscription_activated: false`, `model_delivery_performed: false`,
and `repair_performed: false`.

Tests prove the create and revoke stubs do not mutate the in-memory grant store, even when runtime
writes are requested as posture.

## Boundary

This slice does not implement durable grant creation, durable revocation, CLI mutation commands,
runtime write activation, recovery repair, provenance append, capability activation, subscription
stopping, provider/helper invocation, or model delivery.

## Residual Risk

Future durable mutation implementation must replace these stubs only after the activation policy
and route-readiness checklist are satisfied in code and tests. CLI mutation commands remain absent.

Verification: `node --test test/app.test.js` passes.

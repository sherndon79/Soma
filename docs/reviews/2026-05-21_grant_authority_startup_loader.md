# Grant Authority Startup Loader

Review after wiring server startup to compose the grant store with durable grant mutation recovery
inspection.

## Scope

- `src/grantAuthority.js`
- `src/server.js`
- `test/grantAuthority.test.js`
- `src/app.js`
- `docs/operators.md`
- `docs/architecture/mvp_slice.md`
- `docs/concepts/drafts/grant_mutation_durable_write_recovery.md`
- `ROADMAP.md`

## Summary

`loadGrantAuthority` now loads the read-only grant store together with the append-only grant
mutation provenance log and returns both the normalized grant store and a recovery report. Server
startup passes that recovery report into `createApp`, so existing recovery-aware policy gates can
deny degraded durable grants without each route reading provenance itself.

Behavior covered by tests:

- matching grant creation provenance produces a clean recovery report
- missing provenance file degrades active durable grants through the existing recovery inspector
- unreadable provenance is converted into non-authorizing findings rather than silently authorizing
  durable grants

The default provenance log path is `config/grant-mutations.ndjson`; operators can override it with
`SOMA_GRANT_MUTATION_PROVENANCE_PATH`.

## Boundary

This remains read-only startup composition. It does not enable writable grant routes, CLI mutation,
runtime writes, repair, provenance append, Sensorium subscription activation, visual payload
delivery, or durable grant migration.

## Residual Risk

Session/runtime Sensorium grants are still process-local and do not have durable mutation
provenance. That is acceptable for the current session-only flow, but durable session promotion will
need an explicit boundary so temporary runtime grants are not mistaken for durable grant authority.

Verification: `node --test test/grantAuthority.test.js test/app.test.js test/grantAuthorization.test.js` passes.

# Grant Mutation Store Writers Review

Date: 2026-05-20

## Scope

Review after adding mutation-specific durable writer wrappers for grant create, revoke, supersede,
and expire.

Touched:

- `src/grantMutationStoreWriters.js`
- `test/grantMutationStoreWriters.test.js`
- `docs/concepts/drafts/grant_mutation_durable_write_recovery.md`
- `ROADMAP.md`

## Findings

The new wrapper layer composes existing pure pieces without creating a public mutation path:

- grant state transitions still come from `createGrant`, `revokeGrant`, `supersedeGrant`, and
  `expireGrant`
- metadata-only provenance still comes from the grant mutation provenance constructors
- durable ordering and recovery receipts still come from `writeGrantStoreMutation`

The wrappers set stable mutation kinds:

- `grant.created`
- `grant.revoked`
- `grant.superseded`
- `grant.expired`

Tests prove each wrapper passes the affected grant and matching provenance event through the
writer. Validation failures still happen before temp writes, file promotion, or provenance append.
The persisted grant JSON remains normalized and does not retain the transient in-memory `mutation`
field returned by some pure helpers.

## Non-Activation Notes

This is still not a writable grant feature. The wrappers are disconnected from:

- `POST /grants`
- CLI mutation commands
- `runtime_writes_enabled`
- `config/grants.json`
- provider/helper invocation
- capability activation

## Follow-Up

The next safe implementation slice is a real filesystem adapter and lock strategy for the writer,
with tests against temporary directories. It should still avoid app and CLI mutation wiring until
durable provenance retention and operator recovery posture are resolved.

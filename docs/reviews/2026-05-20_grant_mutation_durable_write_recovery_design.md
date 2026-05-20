# Grant Mutation Durable Write Recovery Design

Date: 2026-05-20

## Scope

Review after documenting the durable grant mutation write and recovery posture.

Touched:

- `docs/concepts/drafts/grant_mutation_durable_write_recovery.md`
- `docs/concepts/drafts/grant_lifecycle.md`
- `ROADMAP.md`

## Findings

The design fills the gap between pure grant mutation helpers and future writable grant routes. It
defines the mutation unit as validated input, next grant-store state, metadata-only provenance, and
a future durable receipt.

The recommended first ordering is:

```text
grant write first -> provenance second -> return success only after both complete
```

The design explicitly handles validation failure, temporary write failure, rename failure, grant
write success with provenance failure, response failure after complete durable state, stale schema,
concurrent writes, and corrupted stores.

The partial-success posture is conservative: if the grant file changes but provenance append fails,
the caller receives failure and the grant store is considered degraded until reconciliation. The
policy gateway should fail closed for grants whose required mutation provenance is missing unless a
user explicitly accepts a recovery action.

## Non-Activation Notes

This is documentation only. It does not add:

- writable grant routes
- grant mutation CLI commands
- durable grant writes
- runtime write enablement
- provider/helper invocation
- capability activation

## Follow-Up

The next safe implementation slice is a pure grant-store writer scaffold with injectable file
operations and tests for failure ordering. It should still avoid public routes and CLI mutation
commands.

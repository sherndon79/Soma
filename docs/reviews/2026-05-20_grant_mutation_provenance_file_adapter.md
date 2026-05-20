# Grant Mutation Provenance File Adapter Review

Date: 2026-05-20

## Scope

Review after adding an append-only durable provenance file adapter for grant mutation events.

Touched:

- `src/grantMutationProvenanceFile.js`
- `test/grantMutationProvenanceFile.test.js`
- `docs/concepts/drafts/grant_mutation_durable_write_recovery.md`
- `ROADMAP.md`

## Findings

The adapter persists grant mutation provenance as newline-delimited JSON, one validated event per
line. It validates every event before append and rejects:

- unknown grant mutation event types
- mutation-time activation claims
- payload-like fields such as `payload_bytes`
- authority-expanding fields such as `constraints`
- provider output/result fields
- unexpected top-level metadata

Each append opens the log in append mode, writes one line, and syncs the file handle before
returning. Reads validate every line and fail closed on malformed JSON or invalid event shape.

The adapter can be passed directly to the grant-store writer because it exposes `append(event)`.
Tests prove that if the grant store is committed and the durable provenance adapter then rejects a
malformed event, the writer reports a degraded recovery receipt:

```text
grant_store_committed=true
provenance_appended=false
recovery_required=true
```

## Non-Activation Notes

This does not enable durable grant mutation. The adapter is not wired into app routes, CLI commands,
runtime profiles, provider/helper invocation, or `config/grants.json`. Tests use temporary
directories only.

## Follow-Up

The next safe implementation slice is an internal end-to-end durable mutation harness that composes
the mutation wrappers, grant-store file adapter, provenance file adapter, and recovery inspector in
temporary directories. It should still avoid public app and CLI mutation surfaces.

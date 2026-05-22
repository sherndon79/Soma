# Grant Mutation Durable Write Recovery

Status: design draft, pure writer/recovery scaffolds implemented, no writable grant routes or runtime writes

This draft defines the write and recovery posture required before Soma enables durable grant
mutation. It complements the grant lifecycle draft and the pure grant mutation validator and
provenance constructors. It does not enable `POST /grants`, grant mutation CLI commands,
`runtime_writes_enabled`, or writes to `config/grants.json`.

## Current Boundary

The current grant file remains read-only at runtime. Existing mutation helpers operate on in-memory
objects only. Existing grant mutation provenance constructors produce metadata-only events only.

A pure injectable grant-store writer scaffold now exists under `src/grantStoreWriter.js`.
Mutation-specific wrappers for create, revoke, supersede, and expire now exist under
`src/grantMutationStoreWriters.js`. A concrete filesystem adapter and sibling lock-file strategy
now exist under `src/grantStoreFileAdapters.js`. A pure recovery inspector exists under
`src/grantMutationRecovery.js`. An append-only durable provenance file adapter exists under
`src/grantMutationProvenanceFile.js`. Internal composition tests prove create/revoke store writes,
provenance appends, and recovery inspection in temporary directories. They are not connected to app
routes, CLI mutation, `config/grants.json`, provider invocation, or runtime write enablement.

The server startup path now uses `src/grantAuthority.js` to load the read-only grant store together
with append-only grant mutation provenance and supplies the resulting recovery report to runtime
policy gates. The default provenance path is `config/grant-mutations.ndjson`; operators may override
it with `SOMA_GRANT_MUTATION_PROVENANCE_PATH`. This is still read-only. It does not enable durable
mutation, but it prevents durable grants from being treated as authorizing without matching recovery
inspection.

The durable write path is still blocked until Soma has:

- schema-version checks before write
- concurrent write exclusion
- recovery behavior for partial failure
- route and CLI tests proving failed writes do not create misleading authority
- the route-readiness checklist in
  [Durable Grant Mutation Route Readiness](./durable_grant_mutation_route_readiness.md)

## Write Unit

A durable grant mutation is not just a changed grant record. The logical mutation unit is:

```text
validated mutation input
  -> validated next grant-store state
  -> metadata-only grant mutation provenance event
  -> durable mutation receipt
```

The grant record and provenance event must agree on:

- grant id
- capability
- provider
- scope
- actor
- reason
- timestamp
- replacement grant id, when superseding
- activation state, always `false` during mutation

The write path must never persist a grant mutation that claims capability activation happened.
Capability use remains a separate request path.

## File Strategy

The first durable implementation should use a narrow grant-store module with explicit filesystem
boundaries, not central request-handler writes.

Suggested grant-store write strategy:

1. Acquire an exclusive lock for the grant store.
2. Read the current grant file.
3. Validate JSON parse and schema version.
4. Normalize the store.
5. Re-run mutation validation against the just-read store, catalog, provider registry, and current
   time/id context.
6. Build the next grant-store state in memory.
7. Build the grant mutation provenance event in memory.
8. Write the next grant store to a temporary file in the same directory.
9. `fsync` the temporary file.
10. Atomically rename the temporary file over the grant file.
11. `fsync` the containing directory.
12. Append the durable provenance event or write the durable provenance receipt.
13. Return the created/revoked/superseded/expired grant plus mutation receipt.
14. Release the lock.

If the final durable provenance mechanism is append-only, the append must itself use an atomic or
recoverable strategy. If the provenance log remains process-local, durable grant mutation must stay
disabled.

Decision: grant mutation should use an append-only durable provenance event log as the canonical
audit artifact. Mutation receipts are still returned by the writer and may support recovery, but
receipts are not the primary audit store. This keeps the grant authority record and the provenance
record as the two durable facts that must reconcile before a grant is trusted.

The first durable provenance adapter stores one metadata-only grant mutation event per line as
newline-delimited JSON. It validates events before append, rejects payload-like and unexpected
fields, writes one line in append mode, and syncs the file handle before returning.

## Ordering

There are two possible orderings:

```text
provenance first -> grant write second
grant write first -> provenance second
```

For Soma's first durable grant implementation, prefer:

```text
grant write first -> provenance second -> return success only after both complete
```

Reasoning:

- A grant record is the authority object that the policy gateway will inspect.
- A provenance-only success without a grant write creates an audit record for authority that does
  not exist.
- A grant write without provenance is more dangerous, but can be detected because the grant record
  carries approval/revocation metadata and can be reconciled against missing provenance.
- The API must not return success until both the grant write and provenance write complete.

This means there is a short internal recovery window where the grant file may contain a mutation
whose provenance append failed. That case must be detected and surfaced before future capability
use trusts the grant.

## Recovery Cases

### Validation Fails

Behavior:

- no temporary grant file is promoted
- no provenance event is written
- no capability is activated
- caller receives a validation error

### Temporary Grant Write Fails

Behavior:

- no provenance event is written
- no grant file is replaced
- temporary file is removed if possible
- caller receives a write failure
- runtime remains on the previous grant store

### Rename Fails

Behavior:

- no provenance event is written
- previous grant file remains authoritative
- temporary file is retained only if needed for diagnostics and must not be loaded as authority
- caller receives a write failure

### Grant Write Succeeds, Provenance Append Fails

This is the critical partial-success case.

Behavior:

- API/CLI returns failure, not success
- mutation receipt records `provenance_pending` or equivalent recovery state if a durable receipt
  store exists
- grant store must be considered degraded until reconciliation completes
- policy gateway should fail closed for grants whose required mutation provenance is missing,
  unless the user explicitly accepts a recovery action

Recovery options:

- append the missing provenance event from the grant record if all required metadata is present
- mark the grant `review_required=true` and keep it non-authorizing until the user reviews it
- roll back by superseding/revoking the grant with a new provenance-backed mutation, not by
  deleting history

Direct file rollback should be avoided after the grant write has become visible. Removing a grant
record can erase the evidence needed to explain what happened.

### Provenance Append Succeeds, Response Fails

Behavior:

- durable state is complete
- retry should be idempotent and return the already-completed mutation result where possible
- operator inspection should show the completed grant mutation

### Schema Version Changes

Behavior:

- writer reads schema version under lock
- unsupported versions fail closed before mutation
- stale prepared mutations must be discarded and recomputed after reread
- migration must not silently broaden authority

### Concurrent Mutation

Behavior:

- only one grant-store writer may hold the lock
- callers that cannot acquire the lock should receive a retryable conflict
- no caller may mutate a store read before another successful writer committed
- mutation ids or idempotency keys should be used before route enablement so client retries do not
  create duplicate grants

### Corrupted Grant Store

Behavior:

- grant-dependent capability checks fail closed
- `GET /grants` may return an explicit degraded inspection response if it can do so without
  trusting malformed authority
- mutation routes remain unavailable until the operator repairs or restores the store
- repair must preserve the corrupted artifact for audit where possible

## Mutation Receipts

Before route enablement, Soma should decide whether durable mutations write a small receipt record.

A receipt can help distinguish:

- mutation prepared
- grant file committed
- provenance appended
- response returned
- recovery required

The receipt should not contain capability payloads or provider outputs. It should contain only:

- mutation id
- mutation kind
- grant id
- event type
- timestamps
- status
- error class, if recovery is required

If a receipt store is not implemented, the grant file itself must carry enough mutation metadata to
rebuild or reconcile missing provenance.

## Recovery Inspection

Pure recovery inspection is available before route activation. It compares grant records against
grant mutation provenance events and reports degraded state without authorizing anything.

The inspector should mark a grant unsafe when it finds:

- missing `grant.created` provenance
- missing terminal provenance for revoked, superseded, or expired grants
- mismatched capability, provider, scope, actor, reason, timestamp, or replacement id
- grant or provenance records that claim mutation-time activation
- unknown grant status

Every recovery finding is non-authorizing. Future policy code may use this signal to fail closed,
but the inspector itself must not convert a malformed grant into authority.

Internal temporary-directory tests now prove that the writer, grant-store file adapter, append-only
provenance adapter, mutation wrappers, and recovery inspector compose for create and revoke. They
also prove that a grant-store commit followed by provenance append failure creates a degraded state
that recovery inspection can detect.

## Policy Gateway Requirement

Before durable writes are enabled, the policy gateway must be able to reject suspicious grant
states:

- active grant with missing creation metadata
- active grant whose creation provenance is required but absent
- superseded grant without replacement id
- revoked or expired grant that appears active through malformed status
- grant with unknown status
- grant with capability/provider mismatch against current catalog or provider registry
- grant whose schema version is newer than the runtime understands

When in doubt, authority fails closed.

## Tests Required Before Runtime Writes

Durable grant writes are not ready until tests cover:

- validation failure leaves grant file and provenance unchanged
- successful create writes grant and provenance without activation
- successful revoke writes grant and provenance and prevents future authorization
- supersede links replacement and preserves old grant history
- expire writes system expiration without user revocation semantics
- temp write failure leaves prior file intact
- rename failure leaves prior file authoritative
- provenance append failure returns failure and marks recovery/degraded state
- retry after response failure is idempotent
- concurrent writers cannot interleave updates
- unsupported schema version fails before write
- corrupted store fails closed for authorization and mutation
- no payload-like constraint or provider output data is copied into provenance receipts

## Non-Goals

- no writable routes
- no grant mutation CLI commands
- no runtime writes
- no grant activation
- no provider/helper invocation
- no Sensorium subscription activation
- no desktop traversal authority expansion
- no model-facing visual payload delivery

## Related Drafts

- [Grant Lifecycle](./grant_lifecycle.md)
- [Durable Grant Mutation Route Readiness](./durable_grant_mutation_route_readiness.md)

# Grant Store Writer Scaffold Review

Date: 2026-05-20

## Scope

Review after adding the pure durable grant-store writer scaffold.

Touched:

- `src/grantStoreWriter.js`
- `test/grantStoreWriter.test.js`
- `docs/concepts/drafts/grant_mutation_durable_write_recovery.md`
- `ROADMAP.md`

## Findings

The writer is intentionally narrow. It owns only the durable mutation ordering, adapter boundary,
failure classification, and receipt shape:

```text
lock -> read -> schema check -> mutate -> temp write -> fsync temp -> rename -> fsync dir
  -> provenance append -> success receipt -> release
```

The mutation function still comes from the existing pure grant helpers. Provenance event construction
still comes from the metadata-only grant mutation provenance constructors. The new module does not
register routes, expose CLI mutation, write `config/grants.json`, enable runtime writes, activate
providers, or invoke helpers.

The tests cover the first recovery cases required by the durable write design:

- successful ordering commits the grant store before appending provenance
- temporary write failure leaves the prior grant store authoritative
- rename failure leaves the prior grant store authoritative and attempts temp cleanup
- provenance append failure after rename returns a degraded recovery receipt
- stale schema fails before mutation
- lock failure is retryable and happens before read
- corrupted grant JSON fails closed before write

## Non-Activation Notes

This is not a durable grant feature yet. The writer is disconnected from app and CLI surfaces, and
no public call path can create, revoke, supersede, expire, or activate durable grants through it.

## Follow-Up

The next safe implementation slice is mutation-specific durable writer wrappers for create, revoke,
supersede, and expire. They should compose the pure grant mutation helpers, pure provenance
constructors, and the new writer while remaining disconnected from public routes and CLI mutation.

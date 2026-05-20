# Grant Store File Adapter Review

Date: 2026-05-20

## Scope

Review after adding the concrete filesystem adapter and lock-file strategy for the grant-store
writer.

Touched:

- `src/grantStoreFileAdapters.js`
- `test/grantStoreFileAdapters.test.js`
- `docs/concepts/drafts/grant_mutation_durable_write_recovery.md`
- `ROADMAP.md`

## Findings

The adapter implements the writer boundary with Node filesystem primitives:

- `readFile` reads the current grant store
- `writeFile` creates a same-directory temp file with exclusive creation
- `fsyncFile` syncs the temp file before promotion
- `rename` promotes the temp file over the grant store
- `fsyncDir` syncs the containing directory
- `unlink` supports temp cleanup after failed temp writes or promotion failures
- `tempPath` derives deterministic hidden temp paths from mutation ids

The lock strategy uses a sibling lock file with exclusive create semantics. A second writer that
cannot create the lock fails before reading, returns a retryable lock failure through the existing
writer receipt, and does not append provenance.

Temp-directory tests cover:

- successful write, rename, provenance append, lock release, and temp cleanup
- stale temp path failure without changing the grant store or appending provenance
- lock contention before read/write/provenance

## Non-Activation Notes

This still does not enable durable grant mutation. No app route, CLI command, runtime profile, or
default path uses the adapter. The tests create temporary grant files under the OS temp directory
and do not touch `config/grants.json`.

## Follow-Up

Durable writes still need a durable provenance retention decision and recovery inspection posture
before public mutation surfaces can be considered. The next safe slice is a provenance adapter or
receipt/reconciliation design that remains disconnected from app and CLI mutation.

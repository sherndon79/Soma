# Durable Grant Route Readiness

Review after documenting the durable grant mutation route-readiness gate.

## Scope

- `docs/concepts/drafts/durable_grant_mutation_route_readiness.md`
- `docs/concepts/drafts/grant_lifecycle.md`
- `docs/concepts/drafts/grant_mutation_durable_write_recovery.md`
- `ROADMAP.md`

## Summary

The new readiness checklist narrows the grant lifecycle and durable write/recovery drafts into a
route activation gate. It identifies the smallest safe writable surface as durable grant creation
and durable grant revocation, with supersede/expire deferred until create/revoke prove the boundary.

The checklist requires:

- server startup authority loading with recovery inspection
- explicit separation between durable grant authority and process-local Sensorium session grants
- durable writer delegation instead of central request-handler mutation
- stable mutation and failure response shapes
- post-attempt recovery inspection
- CLI wrappers that call HTTP routes only
- tests for validation failure, lock conflict, stale schema, corrupted store, partial write failure,
  idempotent revocation, and non-activation

## Boundary

This is documentation only. It does not implement `POST /grants`, durable revocation, CLI mutation,
runtime writes, repair, migration, Sensorium durable grants, model-facing visual delivery, or
capability activation.

## Residual Risk

The next safe implementation step is a dry-run preview surface that validates and previews mutation
metadata without writing grants or appending provenance. That preview should use a distinct
non-mutating route name so it cannot be mistaken for the future active mutation route.

Verification: `npm test` passes.

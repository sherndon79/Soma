# Grant Mutation Durable Composition Review

Date: 2026-05-20

## Scope

Review after adding internal end-to-end durable grant mutation composition tests.

Touched:

- `test/grantMutationDurableComposition.test.js`
- `docs/concepts/drafts/grant_mutation_durable_write_recovery.md`
- `ROADMAP.md`

## Findings

The internal durable grant mutation pieces now compose in temporary directories:

```text
mutation wrapper
  -> grant-store file adapter
  -> append-only provenance file adapter
  -> recovery inspector
```

The tests prove:

- durable create writes the grant store, appends `grant.created`, and recovery inspection is clean
- durable revoke writes terminal grant metadata, appends `grant.revoked`, and recovery inspection is
  clean
- if the grant store commits but provenance append fails, the writer returns a degraded recovery
  receipt and recovery inspection detects missing `grant.created` provenance

All tests use OS temporary directories. They do not touch `config/grants.json` and do not add app or
CLI mutation wiring.

## Non-Activation Notes

This is still internal composition only. Public durable mutation remains unavailable until Soma has
route/CLI activation gates, policy gateway checks that consult recovery state, operator-facing
recovery inspection, and tests proving failed writes do not create misleading authority.

## Follow-Up

The next safe implementation slice is policy-gateway recovery gating for grant authorization: a pure
helper that refuses to treat grants as authorizing when recovery inspection reports missing or
mismatched mutation provenance.

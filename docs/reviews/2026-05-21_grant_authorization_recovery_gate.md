# Grant Authorization Recovery Gate

Review after adding a pure recovery-aware grant authorization helper.

## Scope

- `src/grantAuthorization.js`
- `test/grantAuthorization.test.js`
- `docs/concepts/drafts/grant_mutation_durable_write_recovery.md`
- `ROADMAP.md`

## Summary

The new helper makes the policy-gateway recovery posture executable without wiring public grant
mutation, durable writes, CLI mutation commands, or route activation. It combines normal active
grant matching with recovery-inspection findings and fails closed when a matching grant has any
non-authorizing recovery finding.

Covered cases:

- active grant with matching creation provenance authorizes
- active grant with missing creation provenance is denied as degraded
- findings for unrelated grants do not deny the matching clean grant
- unknown/non-active statuses do not authorize
- newer grant-store schema versions are denied
- optional catalog/provider checks catch capability and provider mismatch

## Boundary

This helper is pure. It does not read grant files, append provenance, mutate the grant store, stop
subscriptions, start helpers, or change any HTTP/CLI route. The current Sensorium route still uses
its existing in-memory active-grant lookup until a separate wiring slice introduces an injected
recovery report.

## Residual Risk

The helper currently treats absence of a recovery report as non-degraded for compatibility with the
existing session-only in-memory grant path. Before durable grants are activated, route wiring should
make the provenance/recovery input explicit so durable grant stores cannot authorize without a fresh
recovery inspection.

Verification: `npm test` passes with 449 tests.

# Grant Mutation Recovery Inspector Review

Date: 2026-05-20

## Scope

Review after adding a pure grant mutation recovery inspector and documenting the durable
provenance retention decision.

Touched:

- `src/grantMutationRecovery.js`
- `test/grantMutationRecovery.test.js`
- `docs/concepts/drafts/grant_mutation_durable_write_recovery.md`
- `ROADMAP.md`

## Findings

The recovery inspector compares grant-store authority records against grant mutation provenance
events without authorizing anything itself. It reports degraded state when it sees:

- missing `grant.created` provenance
- missing terminal provenance for revoked, superseded, or expired grants
- mismatched capability, provider, scope, actor, reason, timestamp, or replacement id
- mutation or provenance records that claim activation
- unknown grant status

Every finding is marked `authorizing_safe: false`. This keeps recovery inspection separate from
policy authorization and prevents a malformed grant from becoming trusted merely because it is
present in the grant store.

## Retention Decision

Soma should use an append-only durable grant mutation provenance log as the primary audit artifact.
Mutation receipts remain useful as return values and recovery metadata, but they are not the
canonical audit store. This matches the existing write order:

```text
grant store commit -> durable provenance append -> success
```

If provenance append fails after the grant store commit, the recovery inspector can surface the
affected grant as degraded before future policy code trusts it.

## Non-Activation Notes

This is pure inspection and documentation only. No app route, CLI command, runtime profile,
provider/helper path, or `config/grants.json` write uses this inspector yet.

## Follow-Up

The next safe implementation slice is an append-only durable provenance file adapter for grant
mutation events, tested in temporary directories and still disconnected from public mutation
surfaces.

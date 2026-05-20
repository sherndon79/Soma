# Grant Mutation Provenance Constructors

Date: 2026-05-20

## Scope

Review after adding pure grant mutation provenance event constructors.

Touched:

- `src/grantMutationProvenance.js`
- `test/grantMutationProvenance.test.js`
- `ROADMAP.md`

## Findings

The new constructors create metadata-only events for future grant mutation writes:

- `grant.created`
- `grant.revoked`
- `grant.superseded`
- `grant.expired`

The slice remains disconnected from routes, CLI commands, durable writes, helper calls, and
capability activation. Event construction takes already-produced grant records and emits authority
metadata only: grant id, capability, provider, scope, actor, reason, timestamp, proposal/approval
references, replacement grant id, and `activation_performed=false`.

The constructors intentionally do not copy grant constraints or capability payload-shaped fields.
Tests cover that payload-like constraint keys are not serialized into the event.

## Non-Activation Notes

This does not add:

- `POST /grants`
- durable grant-store writes
- grant mutation CLI commands
- capability-specific constraint schema validation
- atomic write/recovery behavior
- provider/helper invocation
- desktop or Sensorium authority expansion

## Follow-Up

The next safe step is to design the atomic durable write and recovery posture for grant mutation,
still without enabling public mutation routes. That design should explicitly cover provenance/write
ordering, schema-version checks, and partial failure recovery.

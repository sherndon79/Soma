# Durable Grant Mutation Activation Policy

Status: first activation slice implemented behind explicit runtime write opt-in

This note defines the policy boundary for turning durable grant mutation from internal scaffolding
and preview surfaces into writable runtime authority. It is intentionally shorter than the route
readiness checklist: the checklist names implementation conditions; this policy names who may flip
the boundary, what must already be true, and what must remain separate.

## Current Boundary

Soma supports read-only grant inspection, recovery inspection, startup recovery loading, internal
durable writer composition, dry-run create/revoke previews, and a first writable create/revoke slice
behind explicit operator runtime write opt-in.

The active boundary remains:

- default posture is `runtime_writes_enabled: false`
- `SOMA_RUNTIME_WRITES_ENABLED=1` sets `runtime_writes_enabled: true`,
  `durable_grant_mutation_enabled: true`, and `activation_supported: true`
- `POST /grants` creates durable grants only under the enabled posture
- `POST /grants/:id/revoke` revokes durable grants only under the enabled posture
- CLI `grants create` and `grants revoke` are HTTP wrappers over those routes
- no grant repair routes
- no capability activation as a side effect of grant mutation

## Activation Authority

Durable grant mutation may only be activated by an explicit operator decision that changes runtime
configuration and passes a focused review. It must not be activated by:

- a model recommendation
- a provider manifest
- a capability proposal approval
- a dry-run preview result
- a CLI wrapper existing in the codebase
- a successful internal writer test alone

The operator decision should name the intended activation scope, the grant store path, the mutation
provenance path, the rollback posture, and the recovery/repair procedure to use if commit and
provenance diverge.

## Separation Rules

Preview and review surfaces are not commit surfaces.

- `POST /grants/mutation-previews` validates intent and returns dry-run metadata only.
- CLI `grants preview-create` and `grants preview-revoke` call only the preview route.
- Review text explains a planned mutation; it does not authorize a durable mutation.
- `--json` output is inspection data; it is not a replayable write receipt.

The durable commit surfaces use the distinct active route names `POST /grants` and
`POST /grants/:id/revoke`, require explicit runtime write enablement, and delegate to the durable
writer. They must not inherit preview-route HTTP exception handling or preview-only response
semantics by accident.

## Preconditions

For the enabled create/revoke slice, all of the following must remain true:

- startup authority loading pairs the grant store with durable mutation provenance
- policy gateways fail closed on degraded recovery for matching grants
- the durable writer rereads the grant store under lock before every mutation
- schema mismatch, corrupted grant JSON, lock conflict, temp write failure, rename failure, and
  provenance append failure have stable refusal or degraded-recovery behavior
- create and revoke routes delegate to the durable writer rather than mutating request-handler state
- mutation responses never imply capability activation, subscription activation, or model delivery
- failure responses expose bounded metadata only, without payloads or mismatch values
- CLI mutation commands are wrappers over HTTP commit routes only, not filesystem writers
- focused route, CLI, recovery, and policy-gateway tests pass in the same slice that flips the
  runtime boundary

## Operator Controls

The first activation mechanism requires `SOMA_RUNTIME_WRITES_ENABLED=1`, which resolves to
`runtime_writes_enabled: true` and `durable_grant_mutation_enabled: true`. The control is visible in
health, grant inspection, and mutation responses.

Repair must remain a separate operator-controlled surface. A repair route or command may be added
only after recovery finding classes have dedicated repair plans. Preview, create, revoke, and repair
must remain separate workflows so a failed write cannot silently repair or broaden authority.

## First Activation Slice

The first writable slice is limited to:

- durable create
- durable revoke
- read-only recovery inspection
- bounded mutation receipts
- no activation

Supersede, expire, migration, Sensorium durable perception grants, model-facing visual grants,
automatic repair, and provider/helper invocation should remain out of the first activation slice.

## Review Triggers

Run a focused review before merging any change that:

- introduces a durable mutation route or CLI command
- sets or reads a runtime write-enable flag
- repairs recovery findings
- changes grant mutation response semantics
- makes preview output replayable as a commit request
- links grant creation or revocation to capability activation

## Related Notes

- [Durable Grant Mutation Route Readiness](./durable_grant_mutation_route_readiness.md)
- [Grant Lifecycle](./grant_lifecycle.md)
- [Grant Mutation Durable Write Recovery](./grant_mutation_durable_write_recovery.md)

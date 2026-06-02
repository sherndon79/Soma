# Grant Lifecycle

Status: design draft, no mutation endpoints implemented

Soma should define the authority lifecycle before it implements writable grants. A grant is not a
proposal, not provider installation, and not activation by itself. It is a user-approved authority
record that may later be used by the policy gateway to permit a specific capability through a
specific provider under explicit scope and constraints.

The current implementation only supports read-only grant inspection through `GET /grants` and
`npm run cli -- grants list`.

## Current Runtime Boundary

Writable grant mutation is not active. The current API reports the grant store as file-backed and
read-only:

- `writable: false`
- `runtime_writes_enabled: false`
- `activation_performed: false`

Those fields are part of the safety boundary. A future implementation may only change them after
the mutation path has explicit user approval, revocation auditability, fail-closed validation,
durable provenance, and tests for create, revoke, supersede, expire, and migration behavior.
The operator decision boundary for enabling those runtime writes is defined in
[Durable Grant Mutation Activation Policy](./durable_grant_mutation_activation_policy.md).

Capability proposals remain intent records. Provider manifests remain implementation claims. The
grant store remains authority records. None of those records should silently collapse into another.

## Lifecycle

### Proposal Approved

A proposal approval records user intent for a requested capability. It should include approved
scope and provenance, but it must not create authority by itself.

Required invariant:

- proposal approval does not activate a capability
- proposal approval does not create a grant unless a future explicit grant-write path does so
- approved proposal fields remain inspectable for audit

### Grant Created

A future grant creation path may convert an approved proposal, or a direct explicit user action,
into a grant record.

Grant creation should require:

- exact capability key from the catalog
- provider id from the provider registry
- scope
- constraints
- participant-facing reason
- approval provenance id or direct explicit approval provenance
- expiration or review policy where appropriate
- revocation affordance shown before or with creation

Grant creation must fail closed if:

- the capability is unknown
- the provider does not advertise support for the capability
- the grant would broaden beyond the approved proposal
- constraints are missing or uninterpretable
- the participant-facing disclosure cannot be formed

The smallest safe creation path is:

1. validate the requested capability against the active catalog
2. validate the selected provider against the provider registry
3. validate scope and constraints against the capability contract
4. require a user decision record or explicit direct user action
5. append a durable provenance event
6. atomically persist the grant record
7. return the created grant without activating the capability unless a separate activation path
   explicitly consumes it

Model-authored JSON, provider self-description, or proposal approval alone must not create a grant.
The mutation caller should identify the acting surface and actor; only an explicit user actor, or a
trusted user-facing surface carrying a user decision record, may write authority.

### Grant Inspected

Grant inspection should remain available before and after revocation. A revoked grant is a record,
not authority.

Inspection should show:

- status
- capability
- provider
- scope
- constraints
- approval source
- reason
- creation timestamp
- review requirement
- revocation metadata
- replacement grant id, if superseded
- activation status

### Grant Revoked

Revocation removes authority while preserving the historical record.

Revocation should require:

- grant id
- revocation reason
- revoking actor
- timestamp
- provenance event

Revocation must be allowed even if activation never occurred. It should be possible to revoke an
unused grant because authority itself is meaningful.

Revocation should be idempotent. Revoking an already revoked, superseded, or expired grant should
not restore authority, delete history, or create a second contradictory authority record. The
response may report that no new authority change was needed, but the historical revoked state must
remain inspectable.

### Grant Superseded

Supersession replaces one grant with another, usually because the new grant is narrower, clearer,
or aligned to a changed capability contract.

Supersession should:

- mark the old grant `status: "revoked"` or `status: "superseded"`
- set `replacement_grant_id`
- preserve the old constraints and reason
- require explicit approval for the replacement grant
- never silently map old authority onto a broader capability

Supersession is two linked authority decisions, not a rename. The replacement grant must pass the
same validation as a new grant, and the old grant must remain visible with its original scope,
constraints, reason, approval source, and replacement link.

### Grant Expired

Expiration removes authority because a scope or time boundary ended.

Expiration should:

- mark the grant `status: "expired"`
- preserve the original approval and constraints
- record when expiration happened
- avoid prompting for renewal unless the current task materially needs the capability

Expired grants must not authorize capability use.

## Mutation Prerequisites

Before any writable grant endpoint or CLI command is implemented, Soma should have these concrete
pieces in place:

- a typed mutation validator for create, revoke, supersede, and expire inputs
- capability-catalog lookup for exact capability keys
- provider-registry lookup that confirms the provider supports the requested capability
- constraint validation per capability contract
- explicit actor and user-decision provenance requirements
- an atomic write strategy for the grant store, with schema-version checks before write
- durable provenance append before or with the grant write, with a documented recovery behavior if
  either step fails
- idempotent revocation semantics
- migration behavior for stale, ambiguous, or future grant records
- a user-facing disclosure surface that explains authority, scope, constraints, duration, and
  revocation before approval
- an operator inspection path that can show active, revoked, superseded, expired, and
  review-required grants without activating them

The first implementation should prefer a narrow grant-store module over adding mutation logic
directly to the central request handler. Route and CLI handlers should parse requests and delegate
to the grant module; the grant module should own validation, state transition rules, persistence,
and provenance event construction.

The durable write and recovery posture is defined separately in
[Grant Mutation Durable Write Recovery](./grant_mutation_durable_write_recovery.md). Writable grant
routes should not be enabled until that recovery posture has executable tests.

The route activation gate is narrowed in
[Durable Grant Mutation Route Readiness](./durable_grant_mutation_route_readiness.md). That checklist
must be satisfied before reserved route names or CLI mutation commands are implemented.

## Mutation Tests Required

Writable grant mutation is not ready until tests prove:

- grant creation rejects unknown capabilities
- grant creation rejects unsupported providers
- grant creation rejects missing, malformed, or broader-than-approved constraints
- grant creation requires explicit user approval or a direct explicit user action
- grant creation writes a provenance event and a grant record without activating the capability
- model-originated requests cannot create grants by themselves
- revocation records `revoked_at`, `revoked_by`, `revocation_reason`, and a provenance event
- revocation is idempotent and never restores authority
- revoked, expired, superseded, and unknown-status grants do not authorize capability use
- supersession preserves the old grant and links the replacement grant
- failed validation performs no grant-store write
- failed writes do not emit misleading success provenance
- corrupted or ambiguous grant stores fail closed for grant-dependent capability checks
- `GET /grants` remains inspectable and non-activating
- malformed CLI/API arguments fail before helper execution and do not emit misleading stdout
- desktop traversal authority remains limited to authorized root refs with summary-only provenance

These tests should be added before flipping `runtime_writes_enabled` to `true`.

## Durable API

```text
POST /grants
POST /grants/:id/revoke
POST /grants/:id/supersede
```

`POST /grants` and `POST /grants/:id/revoke` are implemented for durable create/revoke only when
runtime writes are explicitly enabled with `SOMA_RUNTIME_WRITES_ENABLED=1`. Without that opt-in,
they return durable mutation disabled refusals. `POST /grants/:id/supersede` remains reserved.

CLI shape:

```bash
npm run cli -- grants create --capability capability-key --provider provider-id --reason "Reason"
npm run cli -- grants revoke grant-id --reason "No longer needed"
npm run cli -- grants supersede grant-id --replacement replacement-grant-id --reason "Narrower grant approved"
```

`grants create` and `grants revoke` call the HTTP routes. `grants supersede` remains reserved.

They should also satisfy the route-readiness checklist in
[Durable Grant Mutation Route Readiness](./durable_grant_mutation_route_readiness.md).

When these names are implemented, they should remain non-activating by default. Creating a grant is
not the same operation as using the granted capability.

## Sensorium Grant Review

Sensorium perception grants are a special case of the same grant lifecycle, not a separate
permission system. The first writable Sensorium grants should be session-only. Durable perception
grants should wait until the review surface, active disclosure, and revocation UX are strong enough
that live sensing does not become ambient by accident.

A Sensorium grant review must include:

- exact capability key, such as `perception.sensorium.color.subscribe`
- provider id and host segment, such as `soma.provider.sensorium.jetsorano` and `jetsorano`
- exact topic or topic family being authorized
- stream type and risk class
- scope, initially `session`
- `max_seconds`
- `max_fps` where applicable
- `format_required` where applicable
- `downsample_to` bounds where applicable
- disclosure wording that will be shown while active
- revocation behavior and whether revocation stops the active subscription immediately
- whether payloads may be recorded; current default is no
- model-boundary warning for camera-class streams

Sensorium grant migration should fail closed when the provider host, topic namespace, capability
shape, risk class, or stream schema version changes. A grant with missing or malformed Sensorium
constraints should not authorize subscription use.

Before any approved Sensorium proposal becomes a session grant, Soma should construct a
non-writing grant-create candidate and validate the prerequisites:

- proposal status and decision are approved
- decision was made by the user
- approval provenance exists
- `review_context` and `grant_intent` are present
- capability, provider, scope, topic, and constraints still agree
- scope is `session`
- revocation includes immediate stop behavior
- topic and constraints still pass Sensorium request validation

The current candidate builder returns a grant-create input only. It does not write to the grant
store, does not mutate `config/grants.json`, and does not activate a subscription. Proposal
approval alone remains non-authorizing.

The first Sensorium session grant creation path is runtime-only. `POST /sensorium/grants` consumes
the approved proposal candidate, appends an active session grant to the in-memory grant store, and
records metadata-only provenance. It does not mutate `config/grants.json`, and it does not activate
a subscription. Live subscription use is still a separate `POST /sensorium/subscriptions` action
and must pass route-time grant, provider, topic, and constraint checks.

Sensorium session grant revocation is also runtime-only. `POST /sensorium/grants/:id/revoke`
requires an explicit user actor and reason, marks the grant revoked in the in-memory grant store,
and records metadata-only provenance. If active Sensorium subscriptions are tied to the grant, Soma
stops them with termination reason `revoked` and records the corresponding subscription-ended
summaries. The durable grant file is not mutated.

## Provenance Events

Future grant mutation should record:

- `grant.created`
- `grant.revoked`
- `grant.superseded`
- `grant.expired`

Events should include:

- grant id
- capability
- provider
- scope
- actor
- reason
- timestamp
- source proposal id, if any
- replacement grant id, if any
- activation state

Provenance should not store sensitive payloads exposed by the capability. It should record
authority metadata, not the content accessed under that authority.

## Why Not Implement Writes Yet

Writable grants should wait until Soma has:

- a user-facing review surface strong enough to make authority comprehensible
- explicit revocation UX
- durable provenance or a documented retention posture
- migration behavior for grant schema and capability catalog changes
- tests for fail-closed grant loading and ambiguous revocation state
- a clear decision on whether grants are session-only, durable, or both
- activation logic that consumes grants without letting providers or models self-authorize

Until then, read-only records and examples are safer than premature mutation endpoints.

## Non-Goals

- no activation from proposal approval
- no implicit grant from provider installation
- no grant writes through model-generated JSON alone
- no broad "desktop access" grant that bundles unrelated capabilities
- no silent renewal of expired grants
- no deletion of revoked grants as the default revocation behavior

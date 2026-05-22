# Durable Grant Mutation Route Readiness

Status: readiness checklist, no writable grant routes or CLI mutation commands enabled

This note defines the gate before Soma may expose durable grant mutation routes such as
`POST /grants`, `POST /grants/:id/revoke`, `POST /grants/:id/supersede`, or matching CLI
commands. It narrows the larger lifecycle and recovery drafts into implementation conditions.

## Current Boundary

Soma currently supports:

- read-only grant inspection through `GET /grants` and `soma grants list`
- read-only grant recovery inspection through `GET /grants/recovery` and `soma grants recovery`
- server startup composition of `config/grants.json` with append-only grant mutation provenance
- recovery-aware authorization gates for grant-dependent capability use
- process-local Sensorium session grant create/revoke flows that do not mutate `config/grants.json`

Soma does not currently support:

- durable `POST /grants`
- durable `POST /grants/:id/revoke`
- durable grant mutation CLI commands
- `runtime_writes_enabled: true`
- grant repair routes
- grant mutation that implies capability activation

## Route Activation Gate

Writable durable grant routes are not ready until all conditions below are true.

### Authority Loading

- server startup loads the grant store and durable mutation provenance together
- degraded recovery reports are passed to every grant-dependent policy gateway
- unsupported grant-store schema versions fail closed before route mutation and authorization
- corrupted grant-store JSON has an explicit operator-facing failure path
- process-local session grants are not mistaken for durable grant authority

### Mutation Scope

The first durable route slice should expose only the smallest useful pair:

- `POST /grants` for durable grant creation
- `POST /grants/:id/revoke` for durable grant revocation

Supersede and expire should remain internal or deferred until create/revoke prove the durable
boundary. Revocation is a safety/control path and should stay available even when capability use is
blocked by degraded recovery, as long as the route can append revocation provenance.

### Request Preconditions

Creation must require:

- explicit user actor or a trusted user-facing decision record
- capability key present in the active catalog
- provider id present in the provider registry
- provider support for the requested capability
- scope and constraints validated against the capability contract
- participant-facing reason
- either an approved proposal reference or direct explicit user action
- no provider output, payload bytes, screenshots, frames, audio, text content, or model-authored
  authority claims

Revocation must require:

- grant id
- explicit user actor
- participant-facing revocation reason
- current durable grant store reread under lock
- terminal provenance event construction before success is returned
- idempotent response for already terminal grants without restoring authority

### Durable Write Semantics

Every route mutation must delegate to the durable writer module rather than mutating state in the
central request handler.

The durable writer must:

- acquire the grant-store lock before reading
- reread the current grant store under lock
- revalidate the request against the just-read store
- build the next grant store and metadata-only provenance event in memory
- write the grant store through temp-file, fsync, atomic rename, and directory fsync
- append and fsync the grant mutation provenance event
- return success only after both durable facts are complete
- return degraded/failure receipts without implying authority when provenance append fails

### Response Shape

Successful mutation responses must include:

- mutated grant metadata
- `durable: true`
- `grant_written: true`
- `activation_performed: false`
- `subscription_activated: false`
- `model_delivery_performed: false`
- mutation receipt status
- grant mutation provenance event type or id when available
- recovery report summary after mutation

Failure responses must include:

- stable error code
- whether the grant store was committed
- whether recovery is required
- whether retry is safe
- bounded recovery finding metadata when available

Failure responses must not include payloads, provider outputs, raw file contents, screenshots,
frames, audio, text content, or mismatch values that copy participant reasons unnecessarily.

### Recovery Behavior

After any durable mutation attempt:

- run recovery inspection against the post-attempt grant store and provenance log
- if grant-store commit succeeded but provenance append failed, return failure with degraded
  recovery state
- policy gateways must reject grants with non-authorizing recovery findings
- revocation of active capability grants should stop any active runtime uses tied to the grant, but
  only after the route has a bounded stop/error policy for that capability family
- direct deletion rollback is forbidden after a grant record becomes visible

### CLI Boundary

CLI mutation commands may be added only as wrappers over the HTTP routes:

```bash
npm run cli -- grants create --proposal proposal-id --provider provider-id
npm run cli -- grants revoke grant-id --reason "No longer needed"
```

The CLI must:

- fail local argument validation before sending malformed requests
- print mutation receipts without implying activation
- show degraded recovery state when returned
- support `--json` for exact route payloads
- avoid creating a separate filesystem mutation path

## Tests Required For Route Activation

Before any route is enabled, tests must prove:

- creation route rejects unknown capability and unsupported provider
- creation route rejects missing user actor, missing reason, and malformed constraints
- creation route rejects model-originated authority claims
- creation route delegates to durable writer and does not mutate in-memory-only state
- successful creation writes grant and provenance, then returns a clean recovery summary
- successful creation does not activate capability use
- revocation route rejects non-user actor, missing reason, and unknown grant
- revocation route is idempotent for already terminal grants
- revocation route writes terminal grant metadata and terminal provenance
- revocation prevents later authorization for that grant
- grant-store lock conflicts return a retryable conflict without writes
- stale schema fails before write
- corrupted grant store fails closed
- temp write failure leaves prior grant store and provenance unchanged
- rename failure leaves prior grant store authoritative and provenance unchanged
- provenance append failure after grant-store commit returns failure plus degraded recovery
- response failure retry returns the completed mutation or a clearly idempotent status
- CLI create/revoke wrappers call only the HTTP routes
- `GET /grants` and `GET /grants/recovery` remain read-only and non-activating

## Explicit Non-Goals For The Activation Slice

- no Sensorium durable perception grants by default
- no live camera subscription as part of grant creation
- no model-facing visual payload delivery
- no desktop authority expansion
- no grant repair route
- no automatic migration that broadens authority
- no provider/helper invocation from durable grant mutation
- no activation bundled with creation, revocation, supersession, or expiration

## Related Drafts

- [Grant Lifecycle](./grant_lifecycle.md)
- [Grant Mutation Durable Write Recovery](./grant_mutation_durable_write_recovery.md)

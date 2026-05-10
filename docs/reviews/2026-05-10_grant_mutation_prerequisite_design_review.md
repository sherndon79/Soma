# Grant Mutation Prerequisite Design Review

Date: 2026-05-10

Scope:

- `docs/concepts/drafts/grant_lifecycle.md`
- `docs/operators.md`
- current read-only `GET /grants` behavior

## Finding

The grant lifecycle draft now defines the missing prerequisite layer between read-only grant
inspection and future writable grant mutation. The design keeps the current runtime boundary intact:

- no grant mutation routes are implemented
- `GET /grants` remains read-only and non-activating
- proposal approval still records intent, not authority
- provider manifests still advertise capability, not authority
- grant creation remains separate from capability activation

This is the right level of movement for the current slice. It narrows the next implementation work
without prematurely adding authority writes.

## Accepted Constraints

The document correctly preserves these constraints:

- exact capability keys must be validated against the catalog
- selected providers must advertise the requested capability
- scope and constraints must validate against the capability contract
- user approval or an explicit direct user action is required
- model-authored JSON cannot create authority by itself
- revocation must be inspectable, audited, and idempotent
- supersession is a linked replacement decision, not a silent rename
- mutation should belong in a grant-store module rather than the central request handler
- traversal authority is unchanged and remains limited to authorized root refs

## Actionable Follow-Up

The next implementation slice should scaffold the grant mutation validator and state-transition
module without wiring writable routes yet.

Recommended first artifacts:

- grant mutation input schemas for create, revoke, supersede, and expire
- state-transition helpers that operate on in-memory grant records
- tests for validation failures, idempotent revocation, and supersession links
- no file writes
- no route activation
- no change to `runtime_writes_enabled`

This gives Soma executable authority semantics before durable mutation is exposed.

## Residual Risk

The write/provenance ordering is still only described at a policy level. Before runtime writes are
enabled, Soma needs a concrete recovery posture for partial failure:

- provenance appended but grant write fails
- grant write succeeds but provenance append fails
- schema changes while a mutation is being prepared
- concurrent write attempts

Those are not blockers for the current documentation slice, but they are blockers for enabling
`POST /grants`.

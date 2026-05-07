# Grant Lifecycle

Status: design draft, no mutation endpoints implemented

Soma should define the authority lifecycle before it implements writable grants. A grant is not a
proposal, not provider installation, and not activation by itself. It is a user-approved authority
record that may later be used by the policy gateway to permit a specific capability through a
specific provider under explicit scope and constraints.

The current implementation only supports read-only grant inspection through `GET /grants` and
`npm run cli -- grants list`.

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

### Grant Superseded

Supersession replaces one grant with another, usually because the new grant is narrower, clearer,
or aligned to a changed capability contract.

Supersession should:

- mark the old grant `status: "revoked"` or `status: "superseded"`
- set `replacement_grant_id`
- preserve the old constraints and reason
- require explicit approval for the replacement grant
- never silently map old authority onto a broader capability

### Grant Expired

Expiration removes authority because a scope or time boundary ended.

Expiration should:

- mark the grant `status: "expired"`
- preserve the original approval and constraints
- record when expiration happened
- avoid prompting for renewal unless the current task materially needs the capability

Expired grants must not authorize capability use.

## Reserved Future API

These route names are reserved for future design. They are not implemented.

```text
POST /grants
POST /grants/:id/revoke
POST /grants/:id/supersede
```

Expected future CLI shape:

```bash
npm run cli -- grants create --proposal proposal-id --provider provider-id
npm run cli -- grants revoke grant-id --reason "No longer needed"
npm run cli -- grants supersede grant-id --replacement replacement-grant-id --reason "Narrower grant approved"
```

Reserved names should not be implemented until the policy, provenance, review, and failure-mode
requirements in this document are satisfied.

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

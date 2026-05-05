# Capability Proposals

Status: draft concept, Phase 1 partially implemented

Soma should let an assistant or tool ask for a capability it does not currently have, but it
should never let that request activate the capability by itself. A request is a reviewable consent
object, not an escalation path.

## Core Rule

**Models may propose. The harness decides whether a proposal is reviewable. The user approves or
denies. Activation is separate from approval and must be recorded.**

No model, helper, tool, or remote service should be able to silently widen its own authority.

## Why This Exists

Models may know about capabilities that Soma has designed but not exposed in the current effective
harness. For example, a model may know that focused desktop inspection exists as a possible future
surface while `desktop.inspect.focus` remains disabled.

That is acceptable if the model can say:

> I can do better if `desktop.inspect.focus` is available.

It is not acceptable for the model to silently enable that capability, route around the harness, or
bury the request in ordinary conversation without a reviewable notification.

## Proposal Is Not Activation

The proposal lifecycle should be:

```text
model notices need
  -> model emits structured capability proposal
  -> harness validates proposal shape
  -> user is notified
  -> proposal is recorded in provenance
  -> user approves or denies
  -> approval/denial is recorded in provenance
  -> activation happens only if the capability/module is known and allowed for approval
  -> activation is recorded in provenance
  -> revocation remains available
```

Activation should never be implied by proposal creation.

## Required Notification Content

Every capability proposal must produce a user-facing notification. The notification must include:

- requester identity
- requested capability
- reason for the request
- requested scope
- data or authority that would become visible or possible
- excluded data or actions
- risk summary
- fallback if denied
- approval and denial choices
- revocation path if approved

No reason means no valid proposal.

## Proposal Object

Example:

```json
{
  "id": "proposal-id",
  "type": "capability_proposal",
  "status": "pending",
  "requested_by": "assistant",
  "capability": "desktop.inspect.focus",
  "reason": "Need to identify the currently focused UI role before advising next action.",
  "requested_scope": "session",
  "data_exposed": [
    "focused object role",
    "focused object child count",
    "focused object service/path"
  ],
  "excluded_data": [
    "text content",
    "child names",
    "descriptions",
    "actions",
    "screenshots"
  ],
  "risk": "May reveal active application context.",
  "fallback": "Continue using broad desktop inspection summary only.",
  "created_at": "2026-05-05T00:00:00.000Z",
  "provenance_id": "..."
}
```

## User Notification Shape

Example text:

```text
Capability requested
Requested by: assistant
Capability: desktop.inspect.focus
Reason: Need to identify the currently focused UI role before advising next action.
Scope requested: session
Data exposed: focused object role and child count; no text content
Risk: may reveal active application context
Fallback: continue with current limited desktop inspection
Approve / Deny
```

The harness should format the notification from structured proposal fields. The model should not
control the final consent wording alone.

## Approval Object

Example:

```json
{
  "proposal_id": "proposal-id",
  "decision": "approved",
  "approved_scope": "session",
  "approved_by": "user",
  "revocation": "drop session grant for desktop.inspect.focus",
  "provenance_id": "..."
}
```

Denial should also be explicit:

```json
{
  "proposal_id": "proposal-id",
  "decision": "denied",
  "denied_by": "user",
  "reason": "Not needed right now.",
  "provenance_id": "..."
}
```

## Scope

Initial supported scopes should be conservative:

- `once`
- `session`

Later scopes may include:

- `project`
- `module`
- `standing_policy`

Longer-lived scopes require stronger disclosure and a clearer revocation surface.

## Provenance

Capability proposal provenance should record separate events:

- `capability.proposal.created`
- `capability.proposal.approved`
- `capability.proposal.denied`
- `capability.proposal.activated`
- `capability.proposal.revoked`

Proposal provenance should not include raw user secrets or hidden context. It should include the
capability key, requester, reason, requested scope, decision, activation status, and revocation
path.

## Proposed API

Initial proposal store:

```text
POST /capability-proposals
GET /capability-proposals
GET /capability-proposals/:id
```

Later approval:

```text
POST /capability-proposals/:id/approve
POST /capability-proposals/:id/deny
POST /capability-proposals/:id/revoke
```

The first implementation should not activate capabilities. It should only store, notify, list, and
record proposals.

## Proposed CLI

```bash
npm run cli -- proposals list
npm run cli -- proposals show proposal-id
npm run cli -- proposals deny proposal-id
npm run cli -- proposals approve proposal-id --scope session
```

The CLI should print pending proposals in a concise operator format. Full proposal JSON should stay
behind `--json`.

## Interaction With Harness Modules

Approval should activate only known and approved harness surfaces:

- a temporary session capability grant
- an approved module
- a narrower approved policy overlay

Approving a proposal must not allow arbitrary new tools, arbitrary shell commands, arbitrary
network calls, or model-defined capabilities.

The harness should reject proposals for unknown capabilities unless the proposal is being stored
only as an unimplemented request for future design review.

## Phased Implementation

Phase 1:

- in-memory proposal store
- proposal creation endpoint
- proposal listing endpoint
- required proposal fields
- provenance for proposal creation
- CLI list
- no activation

Current implementation status:

- `POST /capability-proposals` creates an in-memory pending proposal.
- `GET /capability-proposals` lists proposals and supports `status=pending`.
- `npm run cli -- proposals list` prints a concise proposal summary.
- `POST /capability-proposals/:id/approve` records an approval decision with approved scope.
- `POST /capability-proposals/:id/deny` records a denial decision with reason.
- `npm run cli -- proposals approve proposal-id --scope session` records approval.
- `npm run cli -- proposals deny proposal-id --reason "reason"` records denial.
- `GET /harness-modules` includes `pending_capability_proposals` for operator status.
- `capability.proposal.created` provenance is recorded.
- `capability.proposal.approved` and `capability.proposal.denied` provenance are recorded.
- revocation and activation are not implemented.

Phase 2:

- pending proposal notifications in `status`
- proposal show command
- still no activation

Phase 3:

- activation for predeclared session-scoped capabilities
- revocation path
- provenance for activation and revocation

Phase 4:

- module-backed approvals
- longer-lived scopes
- durable proposal records if durable governance state exists

## Non-Goals

- no silent escalation
- no model self-approval
- no activation from proposal creation
- no unknown executable tool grants
- no disabling disclosure or revocation
- no hidden remote export
- no approval without reason, scope, risk, and fallback

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

Capability notifications should be just-in-time, not constant. Soma should present a summarized
capability posture at initialization, then interrupt the user only when the current task materially
requires a requestable capability that is not currently authorized.

When several related capabilities are requested together, Soma should summarize them by family for
readability while preserving exact capability keys in the underlying proposal and grant records.
Grouping is for comprehension only; approval and activation remain atomic.

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
GET /notifications
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
npm run cli -- notifications
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

Known capability semantics should come from the capability catalog, not from a provider or model.
Provider installation should never imply activation. See
[Capability Catalog and Providers](./capability_catalog_and_providers.md).

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
- `POST /capability-design-proposals` creates an in-memory `capability_design` proposal for
  new-tooling design review. It uses the proposed capability key in `capability` and additionally
  requires `proposed_name`, `failure_mode`, `proposed_reversibility`, `provider_boundary`, and
  advisory `proposed_risk_class`.
- `GET /capability-proposals` lists proposals and supports `status=pending`.
- `GET /capability-proposals/:id` shows full review context for one proposal.
- `GET /notifications` surfaces pending proposal notifications with show/approve/deny action
  paths.
- Optional desktop push notifications are off by default and can be enabled with
  `SOMA_DESKTOP_NOTIFY=1`. They use a fixed Soma title and bounded structured body via
  `notify-send`; failures are non-fatal. Low and sensitive proposals get fixed Approve/Deny
  actions only when the catalog marks the capability explicitly reversible; high-risk,
  irreversible, or unknown-reversibility proposals are review-only and route to the deliberate
  CLI/API flow.
- `npm run cli -- proposals list` prints a concise proposal summary.
- `npm run cli -- notifications` prints pending proposal-review notifications.
- `npm run cli -- proposals show proposal-id` prints full review context.
- `POST /capability-proposals/:id/approve` records an approval decision with approved scope and
  optional sanitized feedback.
- `POST /capability-proposals/:id/deny` records a denial decision with reason and optional
  sanitized feedback.
- Approving a `capability_design` means approved for consideration only. It does not make the
  capability usable, does not mutate the catalog, and cannot create a runtime grant; the runtime
  grant route explicitly rejects `capability_design` proposals.
- `npm run cli -- proposals approve proposal-id --scope session [--feedback text]` records
  approval.
- `npm run cli -- proposals deny proposal-id --reason "reason" [--feedback text]` records denial.
- `GET /harness-modules` includes `pending_capability_proposals` for operator status.
- `npm run cli -- status` includes concise pending proposal details.
- `capability.proposal.created` provenance is recorded.
- `capability.proposal.approved` and `capability.proposal.denied` provenance are recorded.
- `capability.design_proposal.created`, `.approved`, and `.denied` provenance are recorded for
  design-only proposals.
- Implemented designs can be closed with durable repo receipts in
  `docs/capability-design-implementations/`. Receipt tests validate the linked catalog capability
  and provider claim. Receipts are evidence only and do not grant authority.
- `status.snapshot.read` is the first receipt-backed demo capability. It is explicit-grant and
  exposes bounded aggregate status summaries only.
- `desktop.notification.emitted` provenance records desktop notification `emitted`, `skipped`, or
  `failed` status separately from proposal approval and grant authority.
- Decision records include a generic outcome message even when feedback is absent.
- revocation and activation are not implemented.

Phase 2:

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

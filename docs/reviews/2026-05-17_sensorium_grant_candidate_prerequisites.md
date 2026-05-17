# Sensorium Grant Candidate Prerequisites

Date: 2026-05-17

Scope:

- `src/sensoriumGrantCreateCandidate.js`
- `test/sensoriumGrantCreateCandidate.test.js`
- `test/app.test.js`
- `docs/concepts/drafts/sensorium_integration.md`
- `docs/concepts/drafts/grant_lifecycle.md`
- `ROADMAP.md`

## Finding

The approved-proposal bridge is now represented as a pure candidate builder, not a grant writer.
This is the right intermediate step before writable Sensorium grants.

`buildSensoriumGrantCreateCandidateFromProposal` returns a validated grant-create input only when
the proposal is approved by the user, approval provenance exists, and the Sensorium review metadata
still agrees with the grant intent.

## Accepted Boundary

The candidate builder is non-writing:

- no grant store mutation
- no `config/grants.json` mutation
- no subscription activation
- no frame, coordinate, or payload recording

The builder returns `grant_written: false`, `subscription_activated: false`, and
`activation_performed: false`.

## Accepted Prerequisites

The candidate requires:

- approved proposal status and decision
- user decision actor
- approval provenance id
- Sensorium subscription capability
- `review_context`
- `grant_intent`
- matching capability, provider, scope, topic, and constraints
- session scope
- immediate-stop revocation posture
- topic and constraints that still pass Sensorium request validation

The candidate includes `constraints.topic` so future grant creation can preserve exact topic
authority.

## Non-Activation Proof

The app test suite now asserts that approving a Sensorium proposal does not create grants, does not
make `/grants` writable, and does not start Sensorium subscriptions.

## Actionable Follow-Up

The next safe slice is an explicit session grant creation endpoint or CLI command that consumes the
validated candidate and appends an active session grant while still not activating a subscription.

## Residual Risk

The live subscription route currently enforces provider host and bounded constraints, but not the
candidate's exact `constraints.topic`. When writable Sensorium grants are introduced, route-time
enforcement should fail closed if the request topic differs from the grant's exact topic.

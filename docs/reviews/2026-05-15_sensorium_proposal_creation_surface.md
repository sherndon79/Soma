# Sensorium Proposal Creation Surface

Date: 2026-05-15

Scope:

- `src/app.js`
- `src/cli.js`
- `src/capabilityProposals.js`
- `test/app.test.js`
- `test/cli.test.js`
- `docs/operators.md`
- `docs/concepts/drafts/sensorium_integration.md`
- `README.md`
- `ROADMAP.md`

## Finding

Sensorium review objects can now become normal pending capability proposals without creating
authority. `POST /sensorium/proposals` and `soma sensorium propose` validate through the Sensorium
template, then store a proposal carrying `review_context` and `grant_intent` metadata.

Generic capability proposal creation does not accept caller-supplied review metadata. The metadata
attachment path is explicitly enabled only for the Sensorium validated route, so arbitrary callers
cannot smuggle hidden review payloads into ordinary proposals.

This preserves the lifecycle separation:

- proposal creation records intent only
- approval remains non-activating
- no grant is written
- no subscription is activated

## Accepted Boundary

The proposal creation path stores only metadata needed for review:

- capability
- provider
- topic
- stream type
- risk class
- scope
- bounded constraints
- active disclosure wording
- revocation summary
- recording posture
- model-boundary warning
- provenance posture

It does not store frame, coordinate, or sample payloads.

## Provenance

`capability.proposal.created` now records Sensorium review metadata when present:

- review provider
- review topic
- review stream type
- review risk class
- grant-intent provider
- grant-intent scope

This is intentionally metadata-only. The proposal event remains non-authorizing.

## Actionable Follow-Up

The next safe slice is the grant-creation prerequisite design. It should define how an approved
Sensorium proposal may become an active session grant, while proving approval alone still does not
create a grant and grant creation still does not activate a subscription.

## Residual Risk

`review_context` and `grant_intent` are currently generic optional proposal fields. Before durable
proposal storage exists, schema/versioning rules should define how these fields migrate or fail
closed when Sensorium capability, provider, topic, or constraint semantics change.

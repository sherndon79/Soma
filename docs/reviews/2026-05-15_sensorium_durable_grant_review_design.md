# Sensorium Durable Grant Review Design

Date: 2026-05-15

Scope:

- `docs/concepts/drafts/sensorium_integration.md`
- `docs/concepts/drafts/grant_lifecycle.md`
- `docs/operators.md`

## Finding

The Sensorium grant review design now makes the consent surface explicit before any durable grant
write path exists. This is the right ordering for perception-class capability work.

The design recommends session-only Sensorium grants first. Durable perception grants are deferred
until Soma has a mature review surface, active disclosure, revocation UX, and migration behavior.

## Accepted Review Surface

A Sensorium grant review must show:

- exact capability key
- provider id and host segment
- exact topic or topic family
- stream type and risk class
- scope
- maximum duration
- maximum frame rate where applicable
- required encoding where applicable
- downsample bounds where applicable
- active disclosure wording
- revocation behavior
- recording posture
- model-boundary warning
- provenance posture

This keeps "Sensorium access" from becoming a broad bundled grant. Grants remain atomic by exact
capability key and provider/topic scope.

## Accepted Lifecycle Mapping

The design preserves Soma's existing authority rules:

- proposal approval records intent only
- provider installation grants nothing
- grant creation requires explicit user approval
- grant creation is separate from subscription activation
- active subscription still depends on route-time provider, host, topic, and constraint checks

## Migration Rules

The design correctly fails closed for Sensorium-specific authority drift:

- provider id or `host_segment` changes require review
- topic namespace changes require review
- capability split or merge does not silently preserve authority
- stream schema version changes require review before interpretation
- risk-class increases require review
- missing or malformed grant constraints make the grant inactive until reviewed

## Actionable Follow-Up

The next safe slice is a non-writing Sensorium grant proposal template. It should create or validate
review-ready proposal objects for Sensorium grants, but it should not create grants, activate
subscriptions, or add Sensorium grants to `config/grants.json`.

Recommended first template fields:

- capability
- provider
- topic
- scope
- constraints
- risk class
- active disclosure wording
- revocation summary
- model-boundary warning
- provenance posture

## Residual Risk

The review design is still text-only. Before durable grants can exist, Soma needs a concrete UI or
operator surface that makes these fields visible without overwhelming the participant.

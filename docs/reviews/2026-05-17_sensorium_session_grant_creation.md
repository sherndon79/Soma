# Sensorium Session Grant Creation

Date: 2026-05-17

Scope:

- `src/app.js`
- `src/cli.js`
- `test/app.test.js`
- `test/cli.test.js`
- `docs/concepts/drafts/sensorium_integration.md`
- `docs/concepts/drafts/grant_lifecycle.md`
- `docs/operators.md`
- `README.md`
- `ROADMAP.md`

## Finding

Soma now has an explicit Sensorium session grant creation path. `POST /sensorium/grants` and
`soma sensorium grant-create proposal-id --by user` consume an approved Sensorium proposal, rebuild
the validated grant-create candidate, and append an active runtime session grant.

This is a narrow write path, not subscription activation.

## Accepted Boundary

The route requires an explicit user actor and an already approved proposal. It preserves:

- proposal decision provenance
- provider id
- exact topic authority in `constraints.topic`
- session scope
- bounded request constraints
- immediate-stop revocation posture

The response records `grant_written: true`, but keeps `activation_performed: false`,
`subscription_activated: false`, and `file_written: false`.

## Non-Durable Posture

The new grant is appended to the runtime grant store only. `config/grants.json` is not mutated, and
no default Sensorium grants are introduced.

This keeps perception grants opt-in, session-first, and review-derived.

## Route-Time Authority

`POST /sensorium/subscriptions` now rejects requests when the active grant carries
`constraints.topic` and the requested topic differs. Provider host and bounded constraint checks
still apply before the subscriber is invoked.

## Actionable Follow-Up

Before making subscription activation ergonomic through CLI commands, add explicit session grant
revocation that can stop matching active subscriptions when the grant requires immediate stop.

## Residual Risk

Runtime-only grants are still process-local. A service restart clears them. That is acceptable for
session-first Sensorium work, but durable perception grants should remain deferred until the review
surface, lifecycle policy, and migration behavior are mature enough to preserve operator intent
across restarts.

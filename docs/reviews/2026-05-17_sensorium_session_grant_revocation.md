# Sensorium Session Grant Revocation

Date: 2026-05-17

Scope:

- `src/app.js`
- `src/cli.js`
- `src/sensoriumSubscriber.js`
- `test/app.test.js`
- `test/cli.test.js`
- `test/sensoriumSubscriber.test.js`
- `docs/concepts/drafts/sensorium_integration.md`
- `docs/concepts/drafts/grant_lifecycle.md`
- `docs/operators.md`
- `README.md`
- `ROADMAP.md`

## Finding

Soma now has an explicit runtime revocation path for Sensorium session grants.
`POST /sensorium/grants/:id/revoke` and
`soma sensorium grant-revoke grant-id --reason text --by user` mark a grant revoked without
mutating `config/grants.json`.

## Accepted Boundary

Revocation requires:

- an explicit user actor
- an existing grant id
- a Sensorium subscription capability
- a participant-facing reason

Unknown grants, non-Sensorium grants, and non-user actors fail closed before any subscription stop
attempt.

## Subscription Stop Behavior

When a revoked active grant has active Sensorium subscriptions, Soma stops those subscriptions with
termination reason `revoked`. The route records both the grant-revoked event and metadata-only
subscription-ended events.

No frame payloads, decoded samples, coordinates, or screenshots are recorded.

## Runtime-Only Posture

The revocation path updates the in-memory grant store only. It returns `file_written: false`,
`activation_performed: false`, and `subscription_activated: false`.

This keeps session grants reversible within the running process without introducing durable
perception authority.

## Actionable Follow-Up

The next safe slice is ergonomic subscription operation from the CLI: start from an already active
grant, list active subscriptions, and stop a specific subscription. Those commands should not create
grants and should preserve exact-topic and bounded-constraint enforcement.

## Residual Risk

Revocation is process-local for runtime grants. A service restart clears both runtime grants and
runtime revocation state. Durable perception grants should still wait for mature lifecycle and
migration policy.

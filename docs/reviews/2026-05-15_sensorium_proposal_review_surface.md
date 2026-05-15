# Sensorium Proposal Review Surface

Date: 2026-05-15

Scope:

- `src/app.js`
- `src/cli.js`
- `test/app.test.js`
- `test/cli.test.js`
- `docs/operators.md`
- `docs/concepts/drafts/sensorium_integration.md`
- `README.md`
- `ROADMAP.md`

## Finding

The Sensorium proposal template is now inspectable through an operator-facing surface without
creating authority. `POST /sensorium/proposal-template` and `soma sensorium proposal-template`
return the review-ready template while preserving the non-activating boundary.

This correctly turns the pure builder into a usable review surface without collapsing proposal,
approval, grant creation, or subscription activation into one step.

## Accepted Boundary

The endpoint and CLI surface are review-only:

- no Sensorium subscriber is required
- no proposal is stored
- no grant is written
- no subscription is activated
- no frame, coordinate, or sample payload is recorded
- responses expose `activation_performed: false`, `grant_written: false`, and
  `subscription_activated: false`

The endpoint validates through the same Sensorium template builder, so review input must still
match catalog, provider, topic, scope, and constraint rules before any review object is returned.

## Actionable Follow-Up

The next safe slice is connecting this review object to generic capability proposal creation. That
should create a pending proposal with Sensorium review context, but approval must remain
non-activating and grant creation must remain a separate future step.

## Residual Risk

The CLI prints the review object, but it does not yet create a pending notification. That is
intentional for this slice; operator review comes before proposal persistence.

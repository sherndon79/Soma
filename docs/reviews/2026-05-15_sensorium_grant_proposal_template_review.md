# Sensorium Grant Proposal Template Review

Date: 2026-05-15

Scope:

- `src/sensoriumGrantProposalTemplate.js`
- `test/sensoriumGrantProposalTemplate.test.js`
- `docs/concepts/drafts/sensorium_integration.md`
- `ROADMAP.md`

## Finding

The Sensorium proposal template keeps the next consent surface concrete without introducing a
grant write path. The implementation prepares review-ready objects only. It does not approve,
persist, create grants, mutate `config/grants.json`, or activate Sensorium subscriptions.

This is the right intermediate shape between runtime subscription enforcement and future operator
review UX.

## Accepted Boundary

The template is pure and non-writing:

- `activation_performed: false`
- `durable: false`
- `writable: false`
- no file-backed grant mutation
- no proposal-store mutation
- no Sensorium subscriber invocation

It validates against:

- known Sensorium capability keys
- capability catalog entries
- provider registry entries
- provider support for the requested capability
- provider host segment versus topic namespace
- existing Sensorium subscription request validation
- session-only initial scope
- required review constraints for each stream family

## Accepted Review Fields

The output carries both current proposal-compatible fields and Sensorium-specific review fields.
That lets a later endpoint or CLI surface present the richer consent surface without overloading the
existing generic proposal shape prematurely.

The `grant_intent` object is useful, but it must remain intent only until a separate explicit
approval and grant-creation path exists.

## Actionable Follow-Up

The next safe slice is a non-activating operator surface for the template, either:

- an endpoint that returns the template for review, or
- a CLI command that prints the template in concise and JSON forms.

That slice should prove the surface is read/review-only and still cannot create grants or activate
subscriptions.

## Residual Risk

The template currently exists as a library surface. Until an endpoint or CLI command uses it, the
operator cannot exercise the review flow directly from the harness.

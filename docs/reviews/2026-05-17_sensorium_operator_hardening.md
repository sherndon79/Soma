# Sensorium Operator Hardening

Date: 2026-05-17

Scope:

- `test/sensoriumCliIntegration.test.js`
- `docs/concepts/drafts/sensorium_integration.md`
- `docs/operators.md`
- `ROADMAP.md`

## Finding

Sensorium CLI command shapes are now tested against `createRequestHandler`, not only against mocked
CLI request functions. This verifies that the CLI remains a wrapper over the HTTP authority
boundary.

## Covered Paths

The integration test covers:

- successful `subscribe-start`
- payload-free `subscriptions` disclosure
- explicit `subscribe-stop`
- no-active-grant failure
- exact-topic mismatch failure
- grant constraint failure
- missing subscription id usage failure before HTTP

## Accepted Boundary

The tests confirm that subscription commands consume existing grants only. They do not create
proposals, approve proposals, create grants, revive revoked grants, or write durable grant config.

## Documentation

The operator guide now includes a complete bounded flow from review template through proposal,
approval, runtime grant creation, subscription start/list/stop, and runtime grant revocation.

## Actionable Follow-Up

Add an opt-in live smoke workflow for a real helper-backed Sensorium runtime. It should remain
environment-gated, use a low-risk topic first, and avoid recording, decoding, or preprocessing.

# Sensorium Subscription CLI

Date: 2026-05-17

Scope:

- `src/cli.js`
- `test/cli.test.js`
- `docs/concepts/drafts/sensorium_integration.md`
- `docs/operators.md`
- `README.md`
- `ROADMAP.md`

## Finding

Soma now exposes the existing guarded Sensorium subscription routes through the CLI:

- `soma sensorium subscribe-start`
- `soma sensorium subscriptions`
- `soma sensorium subscribe-stop`

The commands are ergonomic wrappers only. They do not create grants, approve proposals, write
durable config, or bypass route-time authorization.

## Accepted Boundary

Subscription start still depends on the server route to enforce:

- active grant presence
- provider support
- provider host matching
- exact topic authority when the grant carries `constraints.topic`
- bounded request constraints

The CLI only constructs the request body and renders summaries.

## Disclosure Posture

The list and stop commands surface subscription metadata only. CLI summaries do not include frame
payloads, decoded samples, coordinates, screenshots, or raw sensor values.

## Actionable Follow-Up

Add integration-style tests that run the new CLI command shapes against the HTTP request handler,
especially no-grant failure, exact-topic mismatch, constraint-denied requests, and payload-free
disclosure after start/stop/revoke sequences.

## Residual Risk

The CLI start command can still be pointed at any topic string. That is acceptable because the
server remains the authority boundary, but operator-facing errors should be made clearer for common
authorization failures.

# Sensorium Runtime Opt-In Review

Date: 2026-05-15

Scope:

- `src/server.js`
- `src/sensoriumRuntime.js`
- `test/sensoriumRuntime.test.js`
- `.env.example`
- operator and Sensorium docs

## Finding

Sensorium runtime construction is now explicitly opt-in. Default `npm start` does not construct a
sensor broker manager or subscriber, so the HTTP seam remains in the configured-off posture unless
an operator sets `SOMA_SENSORIUM_ENABLED=1`.

When enabled, startup creates a `SensorBrokerManager`, starts the helper, constructs a
`SensoriumSubscriber`, and passes it into the app. Shutdown handlers stop the helper on `SIGINT` or
`SIGTERM`.

## Accepted Boundary

The slice preserves the default safety posture:

- default startup keeps `sensoriumSubscriber` unset
- no Sensorium grants are added to `config/grants.json`
- no CLI subscription activation is added
- helper startup failure is explicit and stable as `sensorium_runtime_start_failed`
- `SOMA_SENSOR_BROKER` may override the helper path
- HTTP policy checks from the previous seam remain unchanged

This gives operators a concrete way to test the local Sensorium node without making perception a
default capability.

## Actionable Follow-Up

The next safe slice is Sensorium grant constraint enforcement. The route should compare requested
constraints against the active grant before invoking the subscriber.

Recommended checks:

- requested `max_seconds` must be no greater than the grant maximum
- requested `max_fps` must be no greater than the grant maximum
- requested `format_required` must match the grant format when the grant pins one
- requested `downsample_to` must fit within grant dimensions when the grant pins bounds
- omitted request constraints should resolve to safe defaults or grant maxima explicitly

## Residual Risk

The runtime opt-in starts the helper, but real durable grants are still absent. Any local testing
that exercises successful subscription must inject an explicit grant fixture or wait for the grant
mutation path. This is deliberate; the integration should not normalize hand-edited long-lived
perception grants before constraint semantics are defined.

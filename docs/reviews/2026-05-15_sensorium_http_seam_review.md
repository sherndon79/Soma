# Sensorium HTTP Seam Review

Date: 2026-05-15

Scope:

- `src/app.js`
- `test/app.test.js`
- `test/sensoriumPublicPathFailClosed.test.js`
- `docs/concepts/drafts/sensorium_integration.md`

## Finding

The Sensorium HTTP seam is now present but remains fail-closed by default.

The route block adds:

- `GET /sensorium/subscriptions`
- `POST /sensorium/subscriptions`
- `DELETE /sensorium/subscriptions/:id`

Those routes only operate when a `sensoriumSubscriber` is injected into the app. The default server
does not yet construct one, so default deployments return
`sensorium_subscriber_not_configured`.

## Accepted Boundary

The POST path preserves the important policy ordering:

- malformed subscription requests are rejected before grant lookup
- missing active grants return `sensorium_subscription_no_grant`
- provider records must exist and support the requested Sensorium capability
- hostname-scoped topics must match the grant provider's `host_segment`
- the subscriber is not invoked on validation or policy denial
- provenance records lifecycle metadata, not frame payloads

This means a grant for `soma.provider.sensorium.jetsorano` authorizes only matching
`sensor/jetsorano/...` topics. It cannot be reused for another Sensorium node on the fabric.

## Actionable Follow-Up

The next safe slice is server runtime wiring behind an explicit operator opt-in:

- instantiate `SensorBrokerManager` and `SensoriumSubscriber` only when an environment flag is set
- preserve default-off behavior
- fail cleanly when the helper binary is missing or not executable
- stop the helper on process shutdown
- keep `config/grants.json` free of Sensorium grants
- avoid adding CLI activation until the server posture is proven

## Residual Risk

Grant constraint enforcement is still coarse. The route validates request constraints against the
Sensorium request contract, but it does not yet compare requested bounds against grant-specific
maximums. Before durable Sensorium grants are introduced, Soma should define how grant constraints
limit `max_seconds`, `max_fps`, format, and downsample bounds.

The `sensoriumPublicPathFailClosed` helper lifecycle test requires the helper to open a local Zenoh
listener. In the Codex sandbox this fails or times out because local networking is restricted; it
passes when run outside the sandbox.

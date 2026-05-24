# Remote Graphical Broker Status Seam

Review after adding a no-op remote graphical broker status surface.

## Scope

- `src/remoteGraphicalBroker.js`
- `src/app.js`
- `src/cli.js`
- `test/remoteGraphicalBroker.test.js`
- `test/app.test.js`
- `test/cli.test.js`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

Soma now exposes provider-neutral remote graphical broker status through:

- `GET /remote-graphical/status`
- `soma remote-graphical status`

The default broker is no-op and reports `provider_not_configured` with no active sessions. Tests can
inject a broker-shaped object to exercise the disclosure normalization without enabling live
transport.

## Boundary

This surface does not require grants, create grants, pair with Sunshine, start Moonlight, open a
session, capture frames, attach video to model context, dispatch pointer or keyboard input, stop a
provider session, record, or write durable grant config.

The response reports:

- `activation_performed: false`
- `durable: false`
- `grant_written: false`
- `session_opened: false`
- `pairing_performed: false`
- `video_attached: false`
- `input_dispatched: false`
- `recording_started: false`
- `provider_session_stopped: false`
- `model_delivery: false`
- `live_transport_used: false`

## Review Notes

Tests cover default no-op status, injected disclosure normalization, route behavior without grants,
route behavior with an injected broker, CLI request shaping, and CLI summary output.

## Residual Risk

The next slice should keep session-open review separate from video observation and input authority.
No live Sunshine/Moonlight calls should be introduced until session-open review and refusal paths are
tested.

Verification: `node --test test/remoteGraphicalBroker.test.js`, `node --test test/app.test.js`,
`node --test test/cli.test.js`, `npm test`, and `git diff --check` pass.

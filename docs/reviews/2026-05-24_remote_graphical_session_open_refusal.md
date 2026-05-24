# Remote Graphical Session-Open Refusal

Review after adding the default-off remote graphical session-open route.

## Scope

- `src/remoteGraphicalSessionOpenReview.js`
- `src/app.js`
- `src/cli.js`
- `test/remoteGraphicalSessionOpenReview.test.js`
- `test/app.test.js`
- `test/cli.test.js`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

Soma now exposes a fail-closed session-open attempt through:

- `POST /remote-graphical/sessions`
- `soma remote-graphical session-open grant-id --reason text --by user`

The route validates an active remote graphical grant, explicit user actor, and reason, then returns a
structured `provider_not_configured` refusal.

## Boundary

This route does not call the broker, pair with Sunshine, start Moonlight, open a session, capture
frames, attach video to model context, dispatch pointer or keyboard input, stop a provider session,
record, create grants, revoke grants, or write durable grant config.

The response reports:

- `refused: true`
- `status: provider_not_configured`
- `broker_called: false`
- `activation_performed: false`
- `grant_written: false`
- `session_opened: false`
- `pairing_performed: false`
- `video_attached: false`
- `input_dispatched: false`
- `recording_started: false`
- `model_delivery: false`
- `live_transport_used: false`

## Review Notes

Tests cover successful refusal, non-user actor refusal, missing grant refusal, inactive grant
refusal, CLI request shaping, and CLI validation before dispatch. Route tests inject a broker with
an `openSession` method and prove it is not called.

## Residual Risk

Before any live broker-backed session open, the project should document activation policy for opt-in
configuration, provider fixtures, active disclosure, refusal modes, and metadata-only provenance.

Verification: `node --test test/remoteGraphicalSessionOpenReview.test.js`,
`node --test test/app.test.js`, `node --test test/cli.test.js`, `npm test`, and
`git diff --check` pass.

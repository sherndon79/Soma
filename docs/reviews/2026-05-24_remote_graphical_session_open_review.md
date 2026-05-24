# Remote Graphical Session-Open Review

Review after adding review-only scaffolding for remote graphical session open.

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

Soma now exposes session-open review through:

- `POST /remote-graphical/session-open-review`
- `soma remote-graphical session-open-review grant-id --reason text`

The review requires an active remote graphical grant and returns operator-facing metadata for the
future `open_session` broker action.

## Boundary

This is a review surface only. It does not call the broker, pair with Sunshine, start Moonlight,
open a session, capture frames, attach video to model context, dispatch pointer or keyboard input,
record, create grants, revoke grants, or write durable grant config.

The response reports:

- `review_only: true`
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

Tests cover successful review creation, inactive grant refusal, non-remote grant refusal, malformed
grant refusal, missing reason refusal, route behavior without broker calls, and CLI validation
before request dispatch.

## Residual Risk

The next slice can add a no-op session-open refusal route, but it should still fail closed by default
and should not invoke Sunshine/Moonlight until a later explicit live-broker activation policy exists.

Verification: `node --test test/remoteGraphicalSessionOpenReview.test.js`,
`node --test test/app.test.js`, `node --test test/cli.test.js`, `npm test`, and
`git diff --check` pass.

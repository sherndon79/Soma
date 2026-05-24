# Remote Graphical Configured Broker Refusals

Review after adding broker-posture-aware session-open refusals without live transport.

## Scope

- `src/remoteGraphicalSessionOpenReview.js`
- `src/app.js`
- `test/remoteGraphicalSessionOpenReview.test.js`
- `test/app.test.js`
- `docs/operators.md`
- `docs/concepts/drafts/remote_graphical_session_open_activation_policy.md`
- `ROADMAP.md`

## Summary

`POST /remote-graphical/sessions` now validates grant, reason, and explicit user actor before
inspecting remote graphical broker posture. It still refuses without calling `openSession`, but the
refusal code now reflects the configured posture:

- `remote_graphical_broker_not_enabled` when runtime opt-in is absent or disabled
- `remote_graphical_broker_not_configured` when runtime is enabled but no provider broker is configured
- `remote_graphical_broker_provider_unavailable` for configured fake/test brokers before live activation

Tests prove unset opt-in, enabled-but-unconfigured, and configured fake broker paths all preserve
`broker_called=false`, `session_opened=false`, and `live_transport_used=false`.

## Boundary

This change does not enable Sunshine/Moonlight calls, pairing, credential storage, broker
`openSession` invocation, video observation, screenshots, input dispatch, recording, model-facing
visual payload delivery, or durable grant writes.

## Residual Risk

The next slice can add an injected fake `openSession` fixture path. That should remain test-only /
provider-neutral and should not introduce real Sunshine/Moonlight transport.

## Verification

- `node --test test/remoteGraphicalSessionOpenReview.test.js`
- `node --test test/app.test.js`
- `node --test test/cli.test.js`
- `npm test`
- `git diff --check`

# Remote Graphical Open-Session Fixture

Review after adding a provider-neutral fixture-only `openSession` path.

## Scope

- `src/remoteGraphicalBroker.js`
- `src/remoteGraphicalSessionOpenReview.js`
- `src/app.js`
- `test/remoteGraphicalBroker.test.js`
- `test/remoteGraphicalSessionOpenReview.test.js`
- `test/app.test.js`
- `docs/operators.md`
- `docs/concepts/drafts/remote_graphical_session_open_activation_policy.md`
- `ROADMAP.md`

## Summary

`POST /remote-graphical/sessions` can now invoke an injected test broker only when all existing
review gates pass and broker status reports:

- `requested: true`
- `enabled: true`
- `configured: true`
- `session_open_fixture: true`

The fixture success response is explicitly bounded with `fixture_only=true`,
`broker_called=true`, `session_opened=true`, and `live_transport_used=false`. It preserves
`pairing_performed=false`, `video_attached=false`, `input_dispatched=false`,
`recording_started=false`, `model_delivery=false`, `durable=false`, and `grant_written=false`.

Fixture failures map to `remote_graphical_broker_session_open_failed` without copying transport or
exception details into the response.

## Boundary

This change does not enable Sunshine/Moonlight calls, real transport, pairing, credential storage,
video observation, screenshots, input dispatch, recording, model-facing visual payload delivery, or
durable grant writes.

Configured brokers without `session_open_fixture: true` still refuse with
`remote_graphical_broker_provider_unavailable` and do not call `openSession`.

## Residual Risk

The next slice should add pure metadata-only provenance constructors for fixture session-open
success and failure. Route-level provenance append should remain separately reviewed.

## Verification

- `node --test test/remoteGraphicalBroker.test.js`
- `node --test test/remoteGraphicalSessionOpenReview.test.js`
- `node --test test/app.test.js`
- `npm test`
- `git diff --check`

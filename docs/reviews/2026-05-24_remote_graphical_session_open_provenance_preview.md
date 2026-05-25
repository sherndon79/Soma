# Remote Graphical Session-Open Provenance Preview

Review after threading metadata-only fixture provenance previews into session-open responses.

## Scope

- `src/app.js`
- `test/app.test.js`
- `docs/operators.md`
- `docs/concepts/drafts/remote_graphical_session_open_activation_policy.md`
- `ROADMAP.md`

## Summary

Fixture-only remote graphical session-open success and failure responses now include
`provenance_preview`, built from the existing pure
`remote_graphical.session_open.fixture` constructor.

Tests inject a provenance log whose `append()` throws, proving the route does not append the preview
yet. The preview remains metadata-only and carries explicit false flags for payload bytes, frames,
screenshots, recognized text, clipboard, input events, window/file metadata, audio, transport
diagnostics, live transport, durable writes, video, input, recording, and model delivery.

## Boundary

This change does not enable provenance append, durable writes, live Sunshine/Moonlight transport,
pairing, credential storage, video observation, screenshots, input dispatch, recording, model-facing
visual payload delivery, or grant mutation.

## Residual Risk

The next slice should document append policy before wiring `provenanceLog.append`. The ordering and
failure behavior should be explicit before route-level append is enabled.

## Verification

- `node --test test/app.test.js`
- `node --test test/remoteGraphicalSessionOpenProvenance.test.js`
- `node --test test/remoteGraphicalSessionOpenReview.test.js`
- `npm test`
- `git diff --check`

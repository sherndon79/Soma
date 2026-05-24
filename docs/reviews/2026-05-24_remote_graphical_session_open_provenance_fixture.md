# Remote Graphical Session-Open Provenance Fixture

Review after adding a pure metadata-only provenance constructor for fixture session-open results.

## Scope

- `src/remoteGraphicalSessionOpenProvenance.js`
- `test/remoteGraphicalSessionOpenProvenance.test.js`
- `docs/concepts/drafts/remote_graphical_broker_boundary.md`
- `docs/concepts/drafts/remote_graphical_session_open_activation_policy.md`
- `ROADMAP.md`

## Summary

Soma now has a pure constructor for `remote_graphical.session_open.fixture` summaries. It accepts
fixture session-open success or failure results and produces bounded metadata only:

- grant, capability, provider, target host, scope, requester, broker action
- status and state
- session id for success
- bounded error and cause code for failure
- explicit false flags for frames, screenshots, recognized text, clipboard, input events, window/file
  metadata, audio payloads, transport diagnostics, live transport, durable writes, video, input,
  recording, and model delivery

The constructor rejects content-bearing or diagnostic-shaped fields before summary creation.

## Boundary

This change does not append route provenance, enable live transport, call Sunshine/Moonlight, open
real sessions, capture frames, dispatch input, record, deliver model visual payloads, or write
durable grants.

## Residual Risk

The next slice may add `provenance_preview` to fixture success/failure responses. Actual
`provenanceLog.append` should remain separately reviewed.

## Verification

- `node --test test/remoteGraphicalSessionOpenProvenance.test.js`
- `node --test test/remoteGraphicalSessionOpenReview.test.js`
- `node --test test/app.test.js`
- `npm test`
- `git diff --check`

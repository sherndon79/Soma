# Remote Graphical Live Session-Open Result Review

Review after adding pure live session-open success and failure result constructors.

## Scope

- `src/remoteGraphicalLiveSessionOpenResult.js`
- `test/remoteGraphicalLiveSessionOpenResult.test.js`
- `docs/concepts/drafts/remote_graphical_live_session_open_result.md`
- `docs/concepts/drafts/remote_graphical_live_broker_activation_checklist.md`
- `docs/README.md`
- `ROADMAP.md`

## Summary

Soma now has pure constructors for future live session-open results:

- `buildRemoteGraphicalLiveSessionOpenSuccess`
- `buildRemoteGraphicalLiveSessionOpenFailure`

The success constructor composes reviewed intent, bounded broker result, opened-but-not-observing
active disclosure, and a live provenance preview. The failure constructor requires a stable
`cause.code` and returns a bounded refusal with live provenance preview.

Both constructors reject content-bearing fields before result construction.

## Boundary

This slice does not change `POST /remote-graphical/sessions`, call a live broker, append live
provenance, pair with Sunshine, start Moonlight, observe video, capture screenshots, run OCR,
dispatch input, record, stop provider sessions, write grants, or deliver visual payloads to a
model.

## Verification

- `node --test test/remoteGraphicalLiveSessionOpenResult.test.js test/remoteGraphicalLiveSessionDisclosure.test.js test/remoteGraphicalSessionOpenProvenance.test.js`

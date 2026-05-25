# Remote Graphical Live Session-Open Provenance Constructor

Review after adding the pure constructor scaffold for future live remote graphical session-open
provenance.

## Scope

- `src/remoteGraphicalSessionOpenProvenance.js`
- `test/remoteGraphicalSessionOpenProvenance.test.js`
- `ROADMAP.md`

## Summary

Soma now has a pure `createRemoteGraphicalSessionOpenLiveProvenanceSummary` helper for future
`remote_graphical.session_open.live` summaries. The helper is not wired into routes. It shares the
forbidden-field scan with the fixture constructor, keeps fixture and live event types distinct, and
requires:

- live success to include `session_id`
- live failure to include both `error` and `cause_code`
- content-bearing and diagnostic-shaped fields to be rejected before summary construction
- durable writes, grants, pairing, video, input, recording, model delivery, and content flags to
  remain false

## Boundary

This change does not append live provenance, call a live broker, activate Sunshine/Moonlight,
change route behavior, create grants, attach frames, dispatch input, record, or deliver visual
payloads to a model.

## Residual Risk

The live constructor is now available as a helper, so route-level tests should continue proving that
current fixture/refusal paths do not emit `remote_graphical.session_open.live` until live activation
is explicitly reviewed.

## Verification

- `node --test test/remoteGraphicalSessionOpenProvenance.test.js`
- `npm test`
- `git diff --check`

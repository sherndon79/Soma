# Remote Graphical Proposal Persistence

Review after adding pending proposal persistence for remote graphical session requests.

## Scope

- `src/app.js`
- `src/cli.js`
- `test/app.test.js`
- `test/cli.test.js`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

Soma now stores pending remote graphical proposals through:

- `POST /remote-graphical/proposals`
- `soma remote-graphical propose ...`

The route uses the same non-activating proposal-template builder, then stores the proposal in the
existing capability proposal store with review metadata and grant intent.

## Boundary

Creating a pending remote graphical proposal does not:

- write grants
- pair with Sunshine
- open a Moonlight session
- capture or decode video
- attach frames to model context
- dispatch keyboard or pointer input
- disconnect a remote session
- start recording

Approval remains a separate decision, and approval still does not create grants or activate runtime
transport.

## Review Notes

The app test asserts the proposal is pending while `grant_written`, `session_opened`,
`pairing_performed`, `video_attached`, `input_dispatched`, and `recording_started` remain false. The
CLI test verifies `remote-graphical propose` uses the persistence endpoint and renders those
non-activation flags.

## Residual Risk

The next lifecycle step is a grant-candidate builder for approved proposals. That should remain
non-writing first, mirroring the Sensorium sequence, before any runtime grant creation or
Moonlight/Sunshine broker work.

Verification: `node --test test/app.test.js` and `node --test test/cli.test.js` pass.

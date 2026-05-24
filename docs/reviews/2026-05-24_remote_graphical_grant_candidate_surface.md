# Remote Graphical Grant Candidate Surface

Review after exposing remote graphical grant-candidate review through HTTP and CLI without writes.

## Scope

- `src/app.js`
- `src/cli.js`
- `test/app.test.js`
- `test/cli.test.js`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

Approved remote graphical proposals can now be reviewed as grant candidates through:

- `POST /remote-graphical/grant-candidates`
- `soma remote-graphical grant-candidate proposal-id`

The route looks up the stored proposal, runs the pure grant-candidate builder, and returns validated
`grant_create_input` plus explicit non-activation flags.

## Boundary

This surface does not write grants, pair with Sunshine, open Moonlight, capture video, attach
frames, dispatch pointer or keyboard input, disconnect sessions, or start recording.

The response reports:

- `review_only: true`
- `activation_performed: false`
- `grant_written: false`
- `session_opened: false`
- `pairing_performed: false`
- `video_attached: false`
- `input_dispatched: false`
- `recording_started: false`

## Review Notes

Route tests cover an approved proposal, a pending proposal refusal, and metadata drift refusal. CLI
tests cover accepted candidate review and local proposal-id validation before any request.

## Residual Risk

The next step is the policy decision around actual runtime grant creation. That should remain
separate from Moonlight/Sunshine transport activation: creating a grant may authorize future use, but
should not pair, open a session, observe frames, or send input.

Verification: `node --test test/app.test.js` and `node --test test/cli.test.js` pass.

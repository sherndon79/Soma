# Remote Graphical Proposal Surface

Review after exposing the remote graphical proposal template builder through a non-activating HTTP
route and CLI command.

## Scope

- `src/app.js`
- `src/cli.js`
- `test/app.test.js`
- `test/cli.test.js`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

Soma now exposes a review-only remote graphical proposal path:

- `POST /remote-graphical/proposal-template`
- `soma remote-graphical proposal-template ...`

The surface validates the same builder contract as the internal module and returns operator-facing
review fields for remote graphical view, pointer input, keyboard input, or disconnect requests.

## Boundary

The route and CLI do not store proposals, create grants, pair with Sunshine, start Moonlight,
decode video, capture screenshots, dispatch pointer or keyboard input, disconnect remote sessions,
record frames, or attach visual payloads to model context.

The response explicitly reports:

- `review_only: true`
- `activation_performed: false`
- `grant_written: false`
- `session_opened: false`
- `pairing_performed: false`
- `video_attached: false`
- `input_dispatched: false`
- `recording_started: false`

## Review Notes

The accepted test covers view-only video review. The refusal test proves a video proposal cannot
smuggle keyboard authority through `requested_channels`. CLI tests assert the command validates
required flags before making a request.

## Residual Risk

The surface is not yet connected to the generic proposal store. That is intentional for this slice:
review formatting is now visible, while persistence and grant lifecycle decisions can be added after
the operator review copy settles.

Verification: `node --test test/app.test.js` and `node --test test/cli.test.js` pass.

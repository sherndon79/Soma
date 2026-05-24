# Remote Graphical Runtime Grant Revocation

Review after adding process-local remote graphical grant revocation.

## Scope

- `src/app.js`
- `src/cli.js`
- `test/app.test.js`
- `test/cli.test.js`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

Remote graphical runtime grants can now be revoked through:

- `POST /remote-graphical/grants/:id/revoke`
- `soma remote-graphical grant-revoke grant-id --reason text --by user`

The route accepts only explicit user actors, requires a revocation reason, verifies the target grant
is a remote graphical grant, and updates only the running process grant store.

## Boundary

Revocation remains separate from transport/provider control. This path does not write durable grant
configuration, pair with Sunshine, open or stop Moonlight, capture frames, attach video to model
context, dispatch pointer or keyboard input, disconnect a provider session, or start recording.

The response reports:

- `durable: false`
- `file_written: false`
- `grant_written: true`
- `activation_performed: false`
- `session_opened: false`
- `pairing_performed: false`
- `video_attached: false`
- `input_dispatched: false`
- `recording_started: false`
- `provider_session_stopped: false`

## Review Notes

Tests cover successful runtime revocation, non-user actor refusal, unknown grant refusal, non-remote
grant refusal, missing reason refusal, CLI request shaping, and CLI local validation before any
request.

## Residual Risk

The next slice should define the remote graphical broker boundary before any live Sunshine/Moonlight
control. Session open, video observation, input dispatch, disconnect, and recording should remain
separate reviewed actions rather than being implied by grant existence.

Verification: `node --test test/app.test.js` and `node --test test/cli.test.js` pass.

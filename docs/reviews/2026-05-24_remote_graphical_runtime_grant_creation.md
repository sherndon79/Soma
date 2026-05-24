# Remote Graphical Runtime Grant Creation

Review after adding process-local remote graphical grant creation from approved proposals.

## Scope

- `src/app.js`
- `src/cli.js`
- `test/app.test.js`
- `test/cli.test.js`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

Approved remote graphical proposals can now create runtime grants through:

- `POST /remote-graphical/grants`
- `soma remote-graphical grant-create proposal-id --by user`

The route reuses the approved-proposal grant-candidate builder, then writes the resulting grant only
into the running process grant store. It records bounded metadata provenance for the grant creation.

## Boundary

Grant creation remains separate from transport activation. The new path does not write durable grant
configuration, pair with Sunshine, open Moonlight, capture frames, attach video to model context,
dispatch pointer or keyboard input, disconnect a session, or start recording.

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

## Review Notes

Tests cover approval-only behavior, successful runtime grant creation, non-user actor refusal,
pending proposal refusal, CLI request shaping, and CLI local proposal-id validation.

## Residual Risk

The next mutation slice should add runtime-only remote graphical grant revocation before any
transport broker activation. Revocation should remain process-local and should not attempt provider
session control until a broker exists with its own review and activation boundary.

Verification: `node --test test/app.test.js` and `node --test test/cli.test.js` pass.

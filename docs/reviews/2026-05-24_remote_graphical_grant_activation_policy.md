# Remote Graphical Grant Activation Policy

Review after documenting the activation boundary for future remote graphical grant creation.

## Scope

- `docs/concepts/drafts/remote_graphical_grant_activation_policy.md`
- `docs/concepts/drafts/remote_graphical_session_provider.md`
- `ROADMAP.md`

## Summary

The policy decision is to allow a future **session-only runtime grant** path for approved remote
graphical proposals, while keeping durable grants out of scope until the broader durable grant
mutation policy is activated.

The policy also keeps grant creation separate from transport activation. A grant route must not
pair Sunshine, open Moonlight, capture frames, send input, disconnect sessions, record, or attach
visual payloads to model context.

## Boundary

This is documentation only. It does not add a writable route, CLI command, runtime grant creation,
revocation, transport broker, pairing, video capture, input dispatch, recording, or model visual
delivery.

## Residual Risk

The next implementation slice can add runtime-only grant creation, but should carry explicit
non-activation flags and tests proving approval alone does not create grants and grant creation does
not start transport.

Verification: documentation-only change; `git diff --check` passes.

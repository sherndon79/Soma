# Remote Graphical Session-Open Activation Policy

Review after documenting activation gates for a future live remote graphical session-open path.

## Scope

- `docs/concepts/drafts/remote_graphical_session_open_activation_policy.md`
- `docs/concepts/drafts/remote_graphical_broker_boundary.md`
- `docs/README.md`
- `ROADMAP.md`

## Summary

The new policy defines prerequisites for changing the current `provider_not_configured`
session-open refusal into a real broker-backed `open_session` operation.

It requires explicit runtime opt-in, configured broker injection, active remote graphical grant
matching, explicit user actor, reviewed intent, active disclosure, metadata-only provenance, stable
refusal codes, and cleanup behavior before any live transport call is enabled.

## Boundary

This is documentation only. It does not enable Sunshine/Moonlight calls, pairing, credential
persistence, session opening, video observation, screenshot capture, input dispatch, recording,
durable grant writes, or model-facing visual payload delivery.

## Residual Risk

The next implementation slice should add only runtime opt-in posture reporting. It should keep the
default broker no-op, keep session-open refusal as the default, and prove no live transport is used.

## Verification

- `git diff --check`

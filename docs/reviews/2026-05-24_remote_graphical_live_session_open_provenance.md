# Remote Graphical Live Session-Open Provenance

Review after documenting the future metadata-only provenance shape for live remote graphical
session-open.

## Scope

- `docs/concepts/drafts/remote_graphical_live_session_open_provenance.md`
- `docs/concepts/drafts/remote_graphical_session_open_provenance_append_policy.md`
- `docs/concepts/drafts/remote_graphical_live_broker_activation_checklist.md`
- `ROADMAP.md`

## Summary

The new draft reserves `remote_graphical.session_open.live` for future live broker-backed
session-open provenance and keeps it distinct from the existing
`remote_graphical.session_open.fixture` event type. It defines allowed bounded metadata, required
false flags, forbidden content-bearing fields, and validation expectations.

## Boundary

This change is documentation-only. It does not change the existing fixture constructor, append
route, broker behavior, live transport posture, grant writes, frame handling, input dispatch,
recording, or model-facing visual delivery.

## Residual Risk

The next implementation slice should still avoid live transport. A safe next step would be a pure
constructor scaffold and tests for the reserved live event type, without route append or broker
activation.

## Verification

- `npm test`
- `git diff --check`

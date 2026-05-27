# Remote Graphical Live Broker Adapter Plan Review

Review after documenting the live Sunshine/Moonlight broker adapter boundary.

## Scope

- `docs/concepts/drafts/remote_graphical_live_broker_adapter_plan.md`
- `docs/concepts/drafts/remote_graphical_broker_boundary.md`
- `docs/concepts/drafts/remote_graphical_live_broker_activation_checklist.md`
- `docs/concepts/drafts/remote_graphical_session_provider.md`
- `docs/README.md`
- `ROADMAP.md`

## Summary

The adapter plan names the live broker implementation split without implementing transport:

- Node owns policy, grants, route gates, readiness, disclosure, provenance, and lifecycle state.
- A future Rust helper owns bounded Sunshine/Moonlight process or socket interaction.
- MCP remains a possible facade after the internal contract is stable, not the trust boundary.

The plan defines the first helper surface (`status`, `open_session`, `describe_active`,
`cleanup_for_grant`), bounded Node inputs, bounded helper outputs, subprocess/timeout boundaries,
stable provider-neutral error classes, and cleanup limits.

## Boundary

This is documentation only. It does not add helper binaries, Node managers, subprocess calls,
sockets, pairing, credential persistence, live route invocation, video observation, screenshots,
OCR, input dispatch, recording, provider-wide disconnect, grant writes, provenance append, or
model-facing visual delivery.

## Verification

- `git diff --check`

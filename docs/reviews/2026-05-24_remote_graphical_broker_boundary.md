# Remote Graphical Broker Boundary

Review after documenting the remote graphical broker boundary before live transport activation.

## Scope

- `docs/concepts/drafts/remote_graphical_broker_boundary.md`
- `docs/concepts/drafts/remote_graphical_session_provider.md`
- `docs/README.md`
- `ROADMAP.md`

## Summary

The new broker-boundary draft defines the seam between Soma's grant/review system and a future
Sunshine/Moonlight transport adapter. It captures:

- broker responsibilities and non-responsibilities
- provider-neutral lifecycle states
- separate action boundaries for status, session open, video observation, input, disconnect, and
  cleanup
- metadata-only disclosure shape
- first no-op/injected broker interface sketch
- metadata-only provenance expectations
- activation ordering before live transport

## Boundary

This is documentation only. It does not add a broker implementation, status route, CLI command,
Sunshine/Moonlight command invocation, socket connection, frame capture, input dispatch, recording,
pairing flow, credential persistence, durable grant write, or model-facing visual payload delivery.

## Residual Risk

The next implementation slice should add only the no-op/injected status seam. It should prove status
inspection does not require grants, create grants, pair, open sessions, capture frames, dispatch
input, record, or invoke Sunshine/Moonlight.

Verification: `git diff --check` passes.

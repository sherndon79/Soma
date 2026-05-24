# Remote Graphical Capability Contract

Review after adding the first disabled-first capability/provider contract for remote graphical
sessions.

## Scope

- `config/capability-catalog.json`
- `config/provider-registry.json`
- `test/capabilityCatalog.test.js`
- `docs/concepts/drafts/remote_graphical_session_provider.md`
- `ROADMAP.md`

## Summary

The catalog now exposes four remote graphical session capabilities:

- `perception.remote_desktop.video.subscribe`
- `desktop.remote.input.pointer`
- `desktop.remote.input.keyboard`
- `desktop.remote.session.disconnect`

The provider registry now includes `soma.provider.remote_desktop.sunshine` as a
Sunshine/Moonlight transport provider. Its presence makes the capabilities supported/requestable,
but all four remain disabled in the harness and require explicit grants.

## Boundary

This is a vocabulary and review-readiness slice only. It does not implement pairing, Moonlight
client control, video decoding, screenshots, frame capture, keyboard input, pointer input,
disconnect calls, route handlers, CLI commands, grant proposal helpers, session recording, or
model-facing visual delivery.

## Review Notes

The split between video, pointer input, keyboard input, and disconnect is load-bearing. View access
must not imply input authority, and transport pairing must not be treated as permission. The new
tests assert those authorities remain separate in `excluded_by_default` and provider claims.

## Residual Risk

The provider claim makes the capabilities appear requestable before a runtime broker exists. That is
consistent with the existing Sensorium disabled-first pattern, but the next slice should add a
non-activating proposal/review surface so operators see clear warnings before any future broker
activation work.

Verification: `node --test test/capabilityCatalog.test.js` passes.

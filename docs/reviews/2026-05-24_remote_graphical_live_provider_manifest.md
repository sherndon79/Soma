# Remote Graphical Live Provider Manifest

Review after documenting the declarative manifest required before a live Sunshine/Moonlight remote
graphical broker can be configured.

## Scope

- `docs/concepts/drafts/remote_graphical_live_provider_manifest.md`
- `docs/concepts/drafts/remote_graphical_live_broker_activation_checklist.md`
- `docs/concepts/drafts/remote_graphical_session_provider.md`
- `ROADMAP.md`

## Summary

The new manifest draft defines the metadata Soma should require for a future live
`soma.provider.remote_desktop.sunshine` broker: provider identity, runtime opt-ins, target-host
constraints, supported action claims, disabled authorities, metadata-only provenance, and
disclosure requirements.

The draft keeps the manifest declarative. It does not change the static provider registry or grant
authority, and it treats `soma-agent-desktop.local.sthnet.org` rollback as evidence rather than
permission.

## Boundary

This change is documentation-only. It does not construct a live broker, call Sunshine or Moonlight,
pair, persist credentials, open sessions, capture frames, dispatch input, record, write grants, or
deliver visual payloads to a model.

## Residual Risk

The next implementation slice should still stay non-live unless it is scoped to a pure schema,
fixture, or review artifact derived from this manifest.

## Verification

- `npm test`
- `git diff --check`

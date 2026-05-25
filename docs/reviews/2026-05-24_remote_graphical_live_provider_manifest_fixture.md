# Remote Graphical Live Provider Manifest Fixture

Review after adding a non-runtime fixture manifest for future live Sunshine/Moonlight provider
configuration.

## Scope

- `docs/fixtures/remote-graphical-live-provider-manifest.json`
- `test/remoteGraphicalLiveProviderManifest.test.js`
- `docs/concepts/drafts/remote_graphical_live_provider_manifest.md`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

The fixture captures the documented live provider manifest shape for
`soma.provider.remote_desktop.sunshine` and validates through the pure manifest validator. It also
carries explicit review-only flags:

- `review_only=true`
- `runtime_loaded=false`
- `provider_registry_entry=false`
- `broker_construction=false`

Operator docs now identify the fixture as review evidence only.

## Boundary

This change does not add the fixture to `config/provider-registry.json`, load it at runtime,
construct a broker, call Sunshine/Moonlight, open sessions, pair, persist credentials, attach
frames, dispatch input, record, write grants, or deliver visual payloads to a model.

## Residual Risk

The fixture and validator now provide a stable review target. The next safe step is still
non-runtime: document or test fixture inspection surfaces before any runtime loading path exists.

## Verification

- `node --test test/remoteGraphicalLiveProviderManifest.test.js`
- `npm test`
- `git diff --check`

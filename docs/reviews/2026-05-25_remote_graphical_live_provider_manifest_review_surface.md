# Remote Graphical Live Provider Manifest Review Surface

Review after adding a pure read-only formatter for future live remote graphical provider manifests.

## Scope

- `src/remoteGraphicalLiveProviderManifestReviewSurface.js`
- `test/remoteGraphicalLiveProviderManifestReviewSurface.test.js`
- `docs/concepts/drafts/remote_graphical_live_provider_manifest.md`
- `ROADMAP.md`

## Summary

Soma now has a pure `remoteGraphicalLiveProviderManifestReviewText` formatter. It validates the
manifest first, then renders operator-facing text for:

- provider identity, manifest version, contract, runtime, and implementation construction
- default-disabled posture and required runtime opt-ins
- target hosts, locality, attended requirement, and rollback posture
- supported actions and their grant/review/live-transport flags
- disabled authorities
- review-only/runtime-loaded/provider-registry/broker-construction blockers

The formatter is not exposed through HTTP or CLI and is not connected to runtime broker
construction.

## Boundary

This change does not load the manifest at runtime, add it to the provider registry, construct a
broker, call Sunshine/Moonlight, open sessions, pair, persist credentials, attach frames, dispatch
input, record, write grants, or deliver visual payloads to a model.

## Residual Risk

The review text currently exists only as a pure helper. A later CLI or HTTP review-only surface can
reuse it, but should preserve the same non-activation guarantees and validation-before-formatting
behavior.

## Verification

- `node --test test/remoteGraphicalLiveProviderManifestReviewSurface.test.js`
- `npm test`
- `git diff --check`

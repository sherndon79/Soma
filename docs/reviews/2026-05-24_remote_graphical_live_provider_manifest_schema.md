# Remote Graphical Live Provider Manifest Schema

Review after adding the pure validator scaffold for future live remote graphical provider
manifests.

## Scope

- `src/remoteGraphicalLiveProviderManifest.js`
- `test/remoteGraphicalLiveProviderManifest.test.js`
- `docs/concepts/drafts/remote_graphical_live_provider_manifest.md`
- `ROADMAP.md`

## Summary

Soma now has a pure `validateRemoteGraphicalLiveProviderManifest` helper for the documented
Sunshine/Moonlight live-provider manifest shape. The helper is not imported by runtime broker
construction or provider registry loading.

The validator checks:

- fixed provider identity, manifest version, provider contract, runtime, and explicit injection
- `default_enabled=false`
- required runtime opt-ins
- explicit non-wildcard target hosts, supported locality, attended posture, and rollback text
- required action separation for `status`, `open_session`, `describe_active`, and
  `cleanup_for_grant`
- required disabled authorities including pairing, video observation, input, recording,
  model-facing delivery, and durable grant writes

## Boundary

This change does not load a live manifest at runtime, alter the provider registry, construct a live
broker, call Sunshine/Moonlight, open sessions, pair, persist credentials, attach frames, dispatch
input, record, write grants, or deliver visual payloads to a model.

## Residual Risk

The validator is currently stricter than the prose sample was: it requires all four first-live
actions named in the action-claims table. That is intentional for a scaffold because it preserves
cleanup and disclosure posture before runtime loading exists.

## Verification

- `node --test test/remoteGraphicalLiveProviderManifest.test.js`
- `npm test`
- `git diff --check`

# Remote Graphical Runtime Manifest Loader Scaffold Review

Review after adding the default-off runtime manifest loader scaffold for remote graphical providers.

## Scope

- `config/remote-graphical-providers/soma.provider.remote_desktop.sunshine.json`
- `src/remoteGraphicalRuntimeManifestLoader.js`
- `src/remoteGraphicalRuntime.js`
- `src/remoteGraphicalBroker.js`
- `src/cli.js`
- `test/remoteGraphicalRuntimeManifestLoader.test.js`
- `test/remoteGraphicalRuntime.test.js`
- `test/remoteGraphicalBroker.test.js`
- `docs/concepts/drafts/remote_graphical_runtime_manifest_loader_decision.md`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

Soma now has a repository-owned runtime manifest root:

```text
config/remote-graphical-providers/
```

The loader remains default-off. It reads manifests only after `SOMA_REMOTE_GRAPHICAL_ENABLED=1` and
an explicit `SOMA_REMOTE_GRAPHICAL_PROVIDER` are present. It validates JSON manifests with
`validateRemoteGraphicalLiveProviderManifest` before any provider can influence runtime posture.

A valid repository manifest can make remote graphical status report
`provider_manifest_configured`, including target host, locality, attended requirement, and bounded
source metadata. It does not enable live transport.

## Boundary

This slice does not add Sunshine/Moonlight broker construction, pairing, session open, video
observation, screenshots, OCR, pointer or keyboard input, clipboard, file transfer, audio,
recording, grant writes, provenance append, or model-facing visual delivery.

The docs fixture review path remains separate from runtime loading. `remote-graphical
manifest-review` still reads only `docs/fixtures/remote-graphical-live-provider-manifest.json` and
does not mutate runtime provider configuration.

## Tests

Focused tests cover:

- default-off loader does not read the manifest root
- opt-in without provider id refuses before manifest reads
- missing root fails closed
- valid repository manifest configures status metadata only
- invalid disabled authorities fail closed
- duplicate provider manifests fail closed
- provider mismatch fails closed
- runtime posture carries configured manifest metadata while keeping `enabled: false`
- broker status reports configured metadata while preserving all live activation flags as false

## Verification

- `node --test test/remoteGraphicalRuntimeManifestLoader.test.js test/remoteGraphicalRuntime.test.js test/remoteGraphicalBroker.test.js`

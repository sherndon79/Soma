# Remote Graphical Runtime Manifest Loader Decision Review

Review after documenting the runtime manifest loader decision for remote graphical live providers.

## Scope

- `docs/concepts/drafts/remote_graphical_runtime_manifest_loader_decision.md`
- `docs/concepts/drafts/remote_graphical_manifest_selection_policy.md`
- `docs/concepts/drafts/remote_graphical_live_provider_manifest.md`
- `docs/concepts/drafts/remote_graphical_live_broker_activation_checklist.md`
- `docs/README.md`
- `ROADMAP.md`

## Summary

The loader decision is conservative: no dynamic or operator-supplied runtime manifest loading.
The only future eligible runtime source is a default-off, repository-owned manifest root:

```text
config/remote-graphical-providers/
```

That root does not exist yet and no loader was implemented. The current fixture review command
remains review-only evidence and cannot influence provider selection or broker construction.

## Boundary

This is documentation only. It does not add a manifest root, runtime loader, HTTP route, provider
registry mutation, broker construction, Sunshine/Moonlight call, live transport, pairing, video,
input, recording, grant write, provenance append, or model delivery.

## Follow-Up

The next implementation slice may add a default-off loader scaffold only if it proves:

- default-off startup does not read runtime manifests
- opt-in without provider id refuses before broker construction
- malformed, missing, duplicate, unsupported-version, provider-mismatched, target-mismatched, or
  disabled-authority-incomplete manifests refuse before broker construction
- fixture review remains disconnected from runtime loading
- session-open remains refused unless the separate live broker activation checklist is satisfied

## Verification

- `git diff --check`

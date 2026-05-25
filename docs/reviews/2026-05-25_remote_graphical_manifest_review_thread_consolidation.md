# Remote Graphical Manifest Review Thread Consolidation

Review after consolidating the live provider manifest review thread and naming the next activation
boundary.

## Scope

- `docs/concepts/drafts/remote_graphical_live_provider_manifest.md`
- `docs/concepts/drafts/remote_graphical_live_broker_activation_checklist.md`
- `ROADMAP.md`

## Summary

The live provider manifest draft now summarizes the implemented review-only thread:

```text
manifest draft
  -> pure validator
  -> repository fixture
  -> pure review formatter
  -> CLI fixture review
  -> smoke expectations
  -> fixture source-selection policy
  -> local source-selection guard
```

It also names the current non-activation invariants and identifies the next true boundary:
runtime-manifest-loader design. The broker activation checklist now requires an explicit loader
decision before any manifest influences provider selection.

## Boundary

This is documentation only. It does not add runtime manifest loading, an HTTP route, provider
registry mutation, broker construction, Sunshine/Moonlight calls, live transport, pairing, video,
input, recording, grant writes, provenance append, or model delivery.

## Verification

- `git diff --check`

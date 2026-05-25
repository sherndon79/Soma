# Remote Graphical Manifest Selection Policy

Review after documenting the source-selection boundary for remote graphical live provider manifest
review.

## Scope

- `docs/concepts/drafts/remote_graphical_manifest_selection_policy.md`
- `docs/concepts/drafts/remote_graphical_live_provider_manifest.md`
- `docs/runbooks/remote_graphical_manifest_review_smoke.md`
- `docs/operators.md`
- `docs/README.md`
- `ROADMAP.md`

## Summary

The new policy keeps `remote-graphical manifest-review` docs-fixture-only for now. It documents why
the command reads only `docs/fixtures/remote-graphical-live-provider-manifest.json`, and lists the
requirements that must be settled before any future `--manifest-path`, stdin, URL input, or runtime
manifest loading exists.

The key distinction is explicit: manifest review may validate and explain review evidence, but
runtime manifest loading is a separate activation boundary.

## Boundary

This is documentation only. It does not change CLI behavior, add source-selection flags, add stdin
input, add an HTTP route, load runtime manifests, change provider registry behavior, construct a
broker, call Sunshine/Moonlight, append provenance, write grants, dispatch input, attach video, or
deliver visual payloads to a model.

## Follow-Up

The next slice should make this policy executable by rejecting unsupported source-selection flags
locally while preserving the fixed fixture behavior.

## Verification

- `git diff --check`

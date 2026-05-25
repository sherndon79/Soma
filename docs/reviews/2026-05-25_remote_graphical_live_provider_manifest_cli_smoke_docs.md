# Remote Graphical Live Provider Manifest CLI Smoke Docs

Review after documenting the operator smoke expectations for the CLI-only live provider manifest
review command.

## Scope

- `docs/runbooks/remote_graphical_manifest_review_smoke.md`
- `docs/README.md`
- `docs/operators.md`
- `docs/concepts/drafts/remote_graphical_live_provider_manifest.md`
- `ROADMAP.md`

## Summary

The new runbook records the exact local commands for reviewing the live provider manifest fixture:

- `npm run cli -- remote-graphical manifest-review`
- `npm run cli -- remote-graphical manifest-review --json`

It also lists expected text markers and the JSON false flags that prove the command remains
review-only: no runtime load, no provider registry entry, no broker construction, no live transport,
no grant write, no session open, no input, no video attachment, and no model delivery.

## Boundary

This is documentation only. It does not change CLI behavior, add an HTTP route, load a manifest at
runtime, configure a provider, construct a broker, call Sunshine/Moonlight, append provenance, write
grants, dispatch input, attach video, record, or deliver visual payloads to a model.

## Residual Risk

The next design decision is whether manifest review remains repository-fixture-only or later accepts
explicit operator-supplied paths. That should be settled before adding `--manifest-path`, stdin
input, or any runtime manifest loader.

## Verification

- `npm run cli -- remote-graphical manifest-review`
- `npm run cli -- remote-graphical manifest-review --json`
- `git diff --check`

# Remote Graphical Manifest Source Guard Smoke Notes

Review after documenting operator-facing refusal examples for the fixture-only manifest review
source guard.

## Scope

- `docs/runbooks/remote_graphical_manifest_review_smoke.md`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

The manifest review smoke runbook now includes local refusal examples for:

- `remote-graphical manifest-review --manifest-path /tmp/operator-manifest.json`
- `remote-graphical manifest-review --stdin`
- `remote-graphical manifest-review /tmp/operator-manifest.json`

Each example documents the expected `usage_error` marker. The examples reinforce that the command is
docs-fixture-only and the refusals do not require a running Soma service.

## Boundary

This is documentation only. It does not change CLI behavior, add external manifest review, add an
HTTP route, read provider registry data, load runtime manifests, construct brokers, call
Sunshine/Moonlight, append provenance, write grants, dispatch input, attach video, record, or deliver
visual payloads to a model.

## Verification

- `npm run cli -- remote-graphical manifest-review --manifest-path /tmp/operator-manifest.json`
- `npm run cli -- remote-graphical manifest-review --stdin`
- `npm run cli -- remote-graphical manifest-review /tmp/operator-manifest.json`
- `git diff --check`

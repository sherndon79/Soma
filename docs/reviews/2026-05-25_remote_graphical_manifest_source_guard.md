# Remote Graphical Manifest Source Guard

Review after making the fixture-only manifest review policy executable in the CLI.

## Scope

- `src/cli.js`
- `test/cli.test.js`
- `docs/concepts/drafts/remote_graphical_manifest_selection_policy.md`
- `docs/runbooks/remote_graphical_manifest_review_smoke.md`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

`remote-graphical manifest-review` now rejects source-selection inputs locally before reading the
fixture or contacting a service. The guard rejects positional manifest paths and unsupported flags
such as `--manifest-path`, `--stdin`, `--manifest-url`, `--source`, `--url`, and `--provider`.

The existing fixture-only command still accepts plain text output and `--json`.

## Boundary

This does not add external manifest review. It does not add `--manifest-path`, stdin, URL loading,
an HTTP route, provider registry loading, runtime manifest loading, broker construction, live
transport, provenance append, grant writes, session open, input dispatch, video attachment,
recording, or model delivery.

## Residual Risk

The guard currently blocks the known source-selection shapes. Future CLI flags added to
`manifest-review` should be reviewed explicitly so they do not become accidental source selectors.

## Verification

- `node --test --test-name-pattern "remote-graphical manifest-review" test/cli.test.js`
- `npm test`
- `git diff --check`

# Remote Graphical Live Provider Manifest CLI Review

Review after exposing the live provider manifest docs fixture through a CLI-only, non-activating
review command.

## Scope

- `src/cli.js`
- `test/cli.test.js`
- `docs/concepts/drafts/remote_graphical_live_provider_manifest.md`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

`soma remote-graphical manifest-review` now reads
`docs/fixtures/remote-graphical-live-provider-manifest.json`, validates it through the pure manifest
validator, and renders `remoteGraphicalLiveProviderManifestReviewText`.

Default output is human review text. `--json` returns the validated fixture, the review text, and
explicit false flags for activation, live transport, grant writes, session open, input dispatch,
video attachment, and model delivery.

## Boundary

This command does not call the Soma service, add an HTTP route, load a runtime manifest, modify the
provider registry, construct a broker, call Sunshine/Moonlight, open sessions, pair, persist
credentials, append provenance, write grants, attach frames, dispatch input, record, or deliver
visual payloads to a model.

## Residual Risk

The command reads a repository fixture. If future work allows selecting arbitrary manifest paths,
that should be reviewed separately for path handling, provenance expectations, and whether
operator-supplied manifests remain review-only inputs.

## Verification

- `node --test --test-name-pattern "remote-graphical manifest-review" test/cli.test.js`
- `npm test`
- `git diff --check`

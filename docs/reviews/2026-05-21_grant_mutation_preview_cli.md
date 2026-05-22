# Grant Mutation Preview CLI

Review after adding CLI wrappers for grant mutation previews.

## Scope

- `src/cli.js`
- `test/cli.test.js`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

The CLI now exposes dry-run grant mutation previews:

- `soma grants preview-create`
- `soma grants preview-revoke`

Both commands call `POST /grants/mutation-previews` and print a compact preview summary by default.
`--json` preserves the route payload. `preview-create` validates `--constraints-json` locally before
making a request.

The summary reports dry-run state, mutation kind, grant id, event type, receipt status, and the
non-write flags (`grant_written`, `provenance_appended`, `activation_performed`).

## Boundary

These commands are not mutation commands. They do not call future active route names, write
`config/grants.json`, append grant mutation provenance, repair recovery, activate capabilities,
start Sensorium subscriptions, or perform provider/helper work.

## Residual Risk

The next useful refinement is operator-facing review text that explains the preview in language
suited for human approval. That formatter should stay pure and should not become a mutation path.

Verification: `node --test test/cli.test.js` passes.

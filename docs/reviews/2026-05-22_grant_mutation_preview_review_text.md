# Grant Mutation Preview Review Text

Review after adding operator-facing review text for grant mutation previews.

## Scope

- `src/grantMutationPreviewReviewSurface.js`
- `src/cli.js`
- `test/grantMutationPreviewReviewSurface.test.js`
- `test/cli.test.js`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

Grant mutation preview human output now flows through a pure review-surface formatter. The CLI keeps
calling only `POST /grants/mutation-previews`, while the formatter presents create/revoke previews as
dry-run, non-writing, non-activating review text.

The review text reports bounded fields: mutation kind, grant id, planned status, capability,
provider, scope, event preview, receipt status, next grant count, state-change preview, and write
flags. It does not expose grant constraints in human output.

## Boundary

The review surface does not create, revoke, repair, activate, append provenance, or write durable
grant state. It rejects obvious payload-shaped and mismatch-value fields before formatting.

`--json` remains available for raw preview payload inspection.

## Residual Risk

The next useful hardening is route-level failure coverage for unsupported mutation kinds and
malformed preview bodies. That should preserve the same dry-run/non-writing guarantees and should
not introduce writable `POST /grants` behavior.

Verification: `node --test test/grantMutationPreviewReviewSurface.test.js test/cli.test.js` passes.

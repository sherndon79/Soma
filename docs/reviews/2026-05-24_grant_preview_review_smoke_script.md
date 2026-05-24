# Grant Preview Review Smoke Script

Review after adding a guarded functional smoke script for grant preview/review flows.

## Scope

- `scripts/grant-preview-review-smoke.js`
- `test/grantPreviewReviewSmokeScript.test.js`
- `package.json`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

`npm run grant-preview:smoke` now provides an operator-run smoke for the real Soma service. It
prints a plan and, when live execution is explicitly enabled, runs:

- `status --json`
- `grants list --json` before the smoke
- `grants recovery --json`
- `grants preview-create --json`
- `grants review-preview --stdin --json` for the accepted preview
- `grants review-preview --stdin --json` for a refused fixture
- `grants list --json` after the smoke

Live execution requires `SOMA_GRANT_PREVIEW_REVIEW_SMOKE=1`. `--dry-run` prints the plan without
calling the live service. The live path fails if the grant list changes during the smoke.

## Boundary

The script uses only read, dry-run, and review-only surfaces. It does not invoke durable commit
routes, write grants, append provenance, repair recovery findings, activate capabilities, start
subscriptions, invoke providers/helpers, or deliver model context.

## Residual Risk

The grant-list comparison assumes no other operator mutates grants concurrently during the smoke.
That is acceptable for a local functional check. Broader multi-operator testing should use an
isolated service instance or fixture-backed grant store.

Verification: `node --test test/grantPreviewReviewSmokeScript.test.js` passes.

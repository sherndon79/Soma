# Grant Mutation Preview Review Fixtures

Review after adding fixture coverage for the grant mutation preview review boundary.

## Scope

- `docs/fixtures/grant-mutation-preview-review-cases.json`
- `test/grantMutationPreviewReviewSurface.test.js`
- `test/app.test.js`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

`docs/fixtures/grant-mutation-preview-review-cases.json` now records the active review boundary for
grant mutation preview formatting. The fixture includes:

- one accepted summary-only preview case
- the complete current forbidden review key set
- one nested rejected case per forbidden key

The formatter tests assert that every forbidden key in the fixture is rejected even when nested under
otherwise valid preview objects. The route tests now reuse the same accepted and rejected fixture
cases.

## Boundary

This slice does not change route behavior, CLI behavior, preview creation, durable grant mutation,
runtime write posture, provenance append, repair, activation, subscriptions, provider/helper
invocation, or model delivery. It documents and tests the existing review-only minimization boundary.

## Residual Risk

If the forbidden key set changes, the fixture and tests should change in the same commit so review
surface drift is visible. Future formatting additions should continue to prove that nested payloads,
provider output, text content, and raw grant/event values are rejected before text is returned.

Verification: `node --test test/grantMutationPreviewReviewSurface.test.js test/app.test.js` passes.

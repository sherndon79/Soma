# Grant Mutation Preview Review CLI Refusal Integration

Review after adding a real-handler refusal smoke for `soma grants review-preview`.

## Scope

- `src/cli.js`
- `test/grantMutationPreviewReviewCliIntegration.test.js`
- `docs/fixtures/grant-mutation-preview-review-cases.json`
- `ROADMAP.md`

## Summary

The CLI integration smoke now covers a rejected fixture case through the real HTTP handler. It sends
a forbidden nested `event_value` through `grants review-preview --stdin --json` and asserts the CLI
throws with:

- `code: grant_mutation_preview_review_forbidden_field`
- `statusCode: 400`
- the expected validation path from the fixture

`apiRequest` now preserves `validation_errors` on thrown HTTP errors so operator-facing CLI callers
can inspect the specific rejected path instead of seeing only the high-level error code.

## Boundary

This remains a refusal-path test and error-detail preservation change only. It does not create
previews, write grants, append provenance, enable runtime writes, repair recovery findings, activate
capabilities, start subscriptions, invoke providers/helpers, or deliver model context.

## Residual Risk

The CLI still throws for this route refusal instead of rendering a specialized human refusal surface.
That is acceptable for this slice because the route is a review formatter rather than the dry-run
preview creation route. If review-preview refusals need human formatting later, that should be a
separate CLI UX slice.

Verification: `node --test test/grantMutationPreviewReviewCliIntegration.test.js` passes.

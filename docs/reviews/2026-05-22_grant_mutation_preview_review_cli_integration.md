# Grant Mutation Preview Review CLI Integration

Review after adding an integration smoke for `soma grants review-preview`.

## Scope

- `test/grantMutationPreviewReviewCliIntegration.test.js`
- `docs/fixtures/grant-mutation-preview-review-cases.json`
- `ROADMAP.md`

## Summary

The new integration test starts a real `createRequestHandler` behind a local HTTP server and runs the
CLI through its default request path. It pipes the accepted review fixture through
`grants review-preview --stdin --json`, then asserts the route response remains review-only:

- `review_only: true`
- `durable: false`
- `grant_written: false`
- `provenance_appended: false`
- `activation_performed: false`
- `subscription_activated: false`
- `model_delivery_performed: false`

The test also asserts the formatted review text is returned, fixture-only constraint details are not
rendered, and the injected grant store remains unchanged.

## Boundary

This is a test-only integration smoke. It does not add preview generation, durable grant mutation,
runtime write enablement, provenance append, repair, activation, subscriptions, provider/helper
invocation, or model delivery.

## Residual Risk

The integration smoke covers the accepted fixture path. Rejected fixture cases remain covered at the
formatter and route levels; if CLI error rendering for review-preview refusals becomes important,
that should be a separate CLI integration slice.

Verification: `node --test test/grantMutationPreviewReviewCliIntegration.test.js` passes.

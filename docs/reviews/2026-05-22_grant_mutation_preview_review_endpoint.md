# Grant Mutation Preview Review Endpoint

Review after exposing the grant mutation preview review formatter through an HTTP route.

## Scope

- `src/app.js`
- `test/app.test.js`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

`POST /grants/mutation-preview-review-text` now formats a caller-supplied grant mutation preview
object through `grantMutationPreviewReviewText`.

The route accepts the preview object as `review_response`, `response`, or `preview` and returns
review text with explicit non-write flags:

- `review_only: true`
- `durable: false`
- `grant_written: false`
- `provenance_appended: false`
- `activation_performed: false`
- `subscription_activated: false`
- `model_delivery_performed: false`

Payload-shaped and mismatch-value fields are rejected by the shared review formatter before text is
returned.

## Boundary

This endpoint is formatting-only. It does not create mutation previews, call durable grant mutation
writers, write `config/grants.json`, append provenance, activate capabilities, repair recovery
findings, start or stop subscriptions, invoke providers/helpers, or deliver model context.

## Residual Risk

Future durable mutation activation should keep this route separate from preview creation and commit
routes. If the review text surface gains richer detail, tests should continue to prove that it never
copies payload bytes, raw grant/event values, or commit-shaped state.

Verification: `node --test test/app.test.js` passes.

# Grant Mutation Preview Review Operator Examples

Review after adding accepted and refused operator examples for `soma grants review-preview`.

## Scope

- `docs/operators.md`
- `ROADMAP.md`

## Summary

The operator guide now includes copyable `grants review-preview --stdin` examples for:

- an accepted summary-only grant creation preview
- a refused preview containing nested `event_value`

The refusal example documents that the route returns
`grant_mutation_preview_review_forbidden_field` and that CLI callers can inspect
`validation_errors`, such as `response.event.audit.event_value`, when handling the thrown request
error.

## Boundary

This is documentation-only. It does not change CLI behavior, route behavior, preview generation,
durable grant mutation, runtime write enablement, provenance append, repair, activation,
subscriptions, provider/helper invocation, or model delivery.

## Residual Risk

The CLI currently exposes validation paths programmatically on thrown errors, not as a specialized
human-rendered refusal output. That is acceptable for the current operator examples because
`grants review-preview` remains a formatter route, not the dry-run mutation preview route.

Verification: documentation-only; `git diff --check` passes.

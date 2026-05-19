# Model Visual Review Surface

Date: 2026-05-19

## Scope

Review after adding the first operator-facing review formatter for model-facing visual attachment.

Touched:

- `src/modelVisualAttachReviewSurface.js`
- `test/modelVisualAttachReviewSurface.test.js`
- `docs/concepts/drafts/model_facing_visual_delivery_boundary.md`
- `docs/operators.md`

## Findings

The first surface is intentionally a pure formatting helper rather than an HTTP route or CLI command.
It summarizes proposal and grant-candidate review data for the operator while keeping payload bytes
out of the surface.

The review text makes the load-bearing separation explicit: proposal approval is not preview
acknowledgement and neither action is model delivery. The candidate text also reports that no grant
was written, no subscription was activated, no model delivery was performed, and no payload was
attached.

The helper rejects payload-shaped fields before formatting. That keeps review plumbing from becoming
an accidental transport for image bytes, depth bytes, screenshots, point clouds, scene descriptions,
or OCR text.

## Non-Activation Notes

This does not add:

- HTTP routes
- CLI commands
- preview rendering
- runtime grant mutation
- prompt assembly
- model invocation
- payload attachment

## Follow-Up

The next safe step is a runtime refusal validator for model-facing visual attachment requests, so
future route or CLI work has a shared fail-closed gate before any payload handling.

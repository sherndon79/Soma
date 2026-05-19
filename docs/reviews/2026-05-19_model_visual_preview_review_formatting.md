# Model Visual Preview Review Formatting

Date: 2026-05-19

## Scope

Review after exposing preview acknowledgement metadata in the pure model visual review helpers.

Touched:

- `src/modelVisualAttachReviewSurface.js`
- `test/modelVisualAttachReviewSurface.test.js`
- `docs/concepts/drafts/model_facing_visual_delivery_boundary.md`
- `docs/operators.md`

## Findings

The proposal and grant-candidate review text now show the preview artifact id, acknowledgement id,
user actor, acknowledgement timestamp, and cleanup requirement. This makes the operator-facing
review surface line up with the stricter grant-candidate and request validators.

The helper remains byte-free. The existing payload-field rejection still blocks image bytes, depth
bytes, screenshots, point clouds, scene descriptions, OCR text, and similarly payload-shaped fields
before formatting.

This is a display-only change. It does not create preview artifacts, acknowledge them, clean up
preview bytes, write grants, attach payloads, assemble prompts, or invoke a model.

## Non-Activation Notes

This does not add:

- HTTP routes
- CLI commands
- preview rendering
- cleanup implementation
- runtime grant mutation
- prompt assembly
- model invocation
- visual payload delivery

## Follow-Up

The next safe step is to expose a review-only route or CLI surface for model visual proposal and
grant-candidate review text, while continuing to leave visual request handling and payload delivery
unwired.

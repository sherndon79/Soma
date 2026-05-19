# Model Visual Review Text Route

Date: 2026-05-19

## Scope

Review after exposing the model visual proposal/candidate review formatter through a review-only
HTTP route.

Touched:

- `src/app.js`
- `test/app.test.js`
- `docs/concepts/drafts/model_facing_visual_delivery_boundary.md`
- `docs/operators.md`

## Findings

`POST /model-visual/review-text` accepts `kind=proposal` or `kind=grant_candidate` plus a
`review_response` object and returns the existing operator review text. The response explicitly
reports `review_only=true`, `activation_performed=false`, `grant_written=false`,
`subscription_activated=false`, `model_delivery_performed=false`, `payload_attached=false`, and
`payload_bytes_included=false`.

The route reuses the existing review helper payload guard. Payload-shaped fields still fail before
formatting, so the route is not an accidental image, depth, screenshot, OCR, scene-description, or
geometry transport.

This is a presentation route only. It does not persist proposals, approve proposals, create grants,
acknowledge previews, clean up preview bytes, assemble prompts, invoke models, or attach visual
payloads.

## Non-Activation Notes

This does not add:

- CLI commands
- visual attach request handling
- preview rendering
- cleanup implementation
- runtime grant mutation
- prompt assembly
- model invocation
- visual payload delivery

## Follow-Up

The next safe step is a CLI wrapper for the review-only route, or a separate dry-run visual attach
request refusal surface. Either path should remain metadata-only and non-delivering.

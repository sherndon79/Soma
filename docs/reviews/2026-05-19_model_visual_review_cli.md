# Model Visual Review CLI

Date: 2026-05-19

## Scope

Review after adding a CLI wrapper for the model visual review text route.

Touched:

- `src/cli.js`
- `test/cli.test.js`
- `docs/concepts/drafts/model_facing_visual_delivery_boundary.md`
- `docs/operators.md`

## Findings

`soma model-visual review --kind proposal|grant_candidate --review-json json` now posts a supplied
review object to `POST /model-visual/review-text` and prints the returned operator text by default.
`--json` preserves the full route response for inspection.

The CLI validates the review kind and JSON shape before making the request. It does not parse,
decode, or handle visual payload bytes itself; payload-shaped fields are still rejected by the route
through the shared review helper.

This remains a review-only surface. It does not create proposals, approve proposals, write grants,
acknowledge previews, start subscriptions, assemble prompts, invoke models, or attach visual
payloads.

## Non-Activation Notes

This does not add:

- visual attach request handling
- preview rendering
- cleanup implementation
- runtime grant mutation
- prompt assembly
- model invocation
- visual payload delivery

## Follow-Up

The next safe step is a dry-run visual attach request refusal surface, or a more ergonomic file/stdin
input path for the review CLI. Either should keep payload delivery unwired.

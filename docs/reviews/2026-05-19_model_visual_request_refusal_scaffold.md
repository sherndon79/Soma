# Model Visual Request Refusal Scaffold

Date: 2026-05-19

## Scope

Review after adding a pure fail-closed validator for model-facing visual attachment requests.

Touched:

- `src/modelVisualAttachRequest.js`
- `test/modelVisualAttachRequest.test.js`
- `docs/concepts/drafts/model_facing_visual_delivery_boundary.md`

## Findings

The validator is intentionally unrouted. It validates a metadata-only request envelope before any
future payload handling and returns non-delivery flags. It does not start subscriptions, render
previews, attach payloads, assemble prompts, invoke models, or append runtime provenance.

The validator requires an active `model.context.visual.*.attach` grant. An active
`perception.sensorium.*.subscribe` grant is explicitly insufficient, preserving the separation
between observing a Sensorium stream and attaching visual context to a model turn.

The validator refuses unacknowledged preview, retention modes other than `none`, model-target drift,
broader frame-age bounds, and payload-shaped fields such as image bytes, depth bytes, screenshots,
point clouds, scene descriptions, prompts, or model responses.

## Non-Activation Notes

This does not add:

- HTTP routes
- CLI commands
- visual grant mutation
- preview rendering
- prompt assembly
- model invocation
- payload delivery

## Follow-Up

The next safe step is to decide whether to expose visual attach proposals through an HTTP/CLI review
path or to first add a preview-rendering design that can acknowledge transformed payloads without
retaining them.

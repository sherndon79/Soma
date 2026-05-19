# Model Visual Attachment Provenance Fixture

Date: 2026-05-19

## Scope

Review after documenting the future byte-free provenance shape for a live model-facing visual
attachment event.

Touched:

- `docs/fixtures/future-model-visual-attachment-provenance-summary.json`
- `test/modelVisualAttachProvenanceFixture.test.js`
- `docs/concepts/drafts/model_facing_visual_delivery_boundary.md`

## Findings

The new fixture defines the future `model.context.visual.attached` provenance summary without
activating delivery. It records the grant id, source subscription/grant identity, model target,
payload type, frame bounds, transformed dimensions/format, preview artifact and acknowledgement
metadata, retention posture, memory posture, and training-use posture.

The test asserts that the fixture remains byte-free. It excludes frame bytes, screenshots, raw
depth, OCR text, scene descriptions, geometry, prompts, messages, model responses, and training
records.

This is a fixture-only design step. It does not create the live attachment event, append runtime
provenance, assemble prompts, invoke models, attach payloads, retain payloads, write visual memory,
or authorize training use.

## Non-Activation Notes

This does not add:

- live visual attach request handling
- prompt assembly
- model invocation
- visual payload delivery
- preview rendering
- cleanup implementation
- durable retention
- visual memory writes

## Follow-Up

The next safe step is to add a pure provenance-summary builder for the future attachment event,
validated against this fixture, while keeping it disconnected from routes and model invocation.

# Model Visual Attachment Provenance Builder

Date: 2026-05-19

## Scope

Review after adding a pure helper for the future `model.context.visual.attached` provenance summary.

Touched:

- `src/modelVisualAttachmentProvenance.js`
- `test/modelVisualAttachmentProvenance.test.js`
- `docs/concepts/drafts/model_facing_visual_delivery_boundary.md`

## Findings

The helper builds the future live attachment provenance summary from a validated metadata-only visual
attach request. It matches the fixture fields for grant identity, source identity, model target,
payload type, frame bounds, transformed dimensions/format, preview acknowledgement metadata,
retention posture, memory posture, and training-use posture.

The helper rejects payload-shaped fields before summary creation and does not copy transient dry-run
validation flags such as `activation_performed`, `subscription_activated`, or `preview_acknowledged`.

This is still disconnected from runtime delivery. Nothing calls the helper from a route, no prompt is
assembled, no model is invoked, no payload is attached, and no provenance is appended for live visual
delivery.

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

The next safe step is to add a dry-run CLI or route summary that can optionally show the future
provenance preview for an accepted dry-run, while still avoiding live delivery and provenance append.

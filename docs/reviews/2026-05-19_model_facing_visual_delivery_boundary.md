# Model-Facing Visual Delivery Boundary Review

Date: 2026-05-19

Scope:

- `docs/concepts/drafts/model_facing_visual_delivery_boundary.md`
- `docs/concepts/drafts/sensorium_integration.md`
- `docs/README.md`
- `ROADMAP.md`

## Disposition

Accepted as a design-only boundary.

This records the distinction between Sensorium subscription authority and model-facing visual
payload delivery authority. A stream grant is not sufficient to attach transformed color/depth bytes
to a model turn.

## What Landed

- Draft capability names for future visual attach operations.
- Required grant fields for source, payload type, frame count, dimensions, age, preview, retention,
  and memory-write separation.
- Disclosure preview requirements before any payload enters model context.
- Provenance fields that record delivery shape without storing frame bytes.
- Default retention posture of `none`.
- Activation gates for future implementation and live testing.

## Boundary

No implementation was added.

This does not authorize:

- model-facing image/depth delivery
- prompt assembly with visual payloads
- screenshots
- recordings
- raw depth arrays
- point clouds or meshes
- scene descriptions generated before user preview
- durable visual memory

## Next Safe Step

The next safe implementation slice is non-activating scaffolding:

- disabled/requestable catalog entries
- review-only proposal template shape
- pure validation tests
- proof that subscription grants alone cannot authorize model visual delivery

Prompt assembly and live model delivery remain out of scope.

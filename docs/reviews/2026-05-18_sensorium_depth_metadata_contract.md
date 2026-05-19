# Sensorium Depth Metadata Contract Review

Date: 2026-05-18

Scope:

- `src/sensoriumStreamContracts.js`
- `test/sensoriumStreamContracts.test.js`
- `docs/concepts/drafts/sensorium_depth_metadata_contract.md`
- `docs/concepts/drafts/sensorium_integration.md`
- `ROADMAP.md`

## Disposition

Accepted as a pre-activation contract slice.

The depth capability already existed in the catalog and request validator. This change gives it the
same explicit stream-summary boundary that color has before any live depth subscription is attempted.

## What Landed

- `perception.sensorium.depth.subscribe` now has a stream contract.
- Allowed depth summaries are limited to:
  - `schema_version`
  - `frame_number`
  - `width`
  - `height`
  - `format`
  - `depth_units`
  - `payload_size`
- `format` is restricted to `png`.
- `depth_units` must be a positive finite number.
- Raw depth arrays, payload bytes, full frames, point clouds, meshes, screenshots, text content, and
  timestamps are rejected as contract violations.
- The integration draft now points to a dedicated depth metadata contract document.

## Boundary

This is not depth activation.

The slice does not add:

- live depth smoke
- depth payload decoding in Node
- helper-side depth PNG minimization
- model-facing depth delivery
- recordings, screenshots, point clouds, meshes, or derived scene geometry

Depth remains camera-class restricted. Any live depth validation still requires explicit
acknowledgement, bounded constraints, metadata-only summaries, runtime cleanup, and a separate
review.

## Verification

Commands run:

```bash
npm test -- --test-name-pattern sensoriumStreamContracts
npm test
```

Result:

- focused stream-contract tests passed
- full Node test suite passed: `348` tests

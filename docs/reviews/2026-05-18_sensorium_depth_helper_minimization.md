# Sensorium Depth Helper Minimization Review

Date: 2026-05-18

Scope:

- `crates/soma-sensor-broker/Cargo.toml`
- `crates/soma-sensor-broker/src/main.rs`
- `src/sensoriumSubscriber.js`
- `test/sensoriumSubscriber.test.js`
- `docs/concepts/drafts/sensorium_depth_metadata_contract.md`
- `docs/concepts/drafts/sensorium_integration.md`
- `ROADMAP.md`

## Disposition

Accepted as the pre-live helper boundary for depth.

Depth subscription can now use the same shape as color: Node forwards camera-class transform
constraints and the Rust helper enforces minimization before sample bytes are emitted back to Node.

## What Landed

- `soma-sensor-broker` now supports depth PNG transform parameters.
- Depth transforms require `format_required=png` paired with `downsample_to`.
- The helper rejects mismatched formats before opening the subscription path.
- The helper decodes Sensorium `DepthFrame` MessagePack, validates schema version, validates positive
  finite `depth_units`, decodes PNG payloads, downsamples within the requested bounds, re-encodes
  PNG, and re-encodes the MessagePack frame.
- Malformed MessagePack, invalid PNG, invalid units, transform failures, and oversized transformed
  dimensions fail closed instead of passing through full-resolution payloads.
- Node now forwards depth camera-class transform constraints to the helper.
- Node records depth sample summaries only as bounded metadata.

## Boundary

This is still not model-facing depth delivery.

The slice does not add:

- screenshots
- recordings
- raw depth arrays
- point clouds
- meshes
- derived scene geometry
- depth payload delivery to model context

Live depth smoke remains a separate explicit-acknowledgement verification step.

## Verification

Commands run:

```bash
cargo test -p soma-sensor-broker
npm test -- --test-name-pattern "depth samples|depth transform|DepthPayload|depth_units|passes depth"
npm test
cargo build -p soma-sensor-broker
```

Result:

- Rust broker tests passed: `18` tests
- focused Node depth tests passed
- full Node test suite passed: `356` tests
- Rust broker build passed

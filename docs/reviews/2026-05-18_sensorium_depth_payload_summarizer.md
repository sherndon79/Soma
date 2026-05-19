# Sensorium Depth Payload Summarizer Review

Date: 2026-05-18

Scope:

- `src/sensoriumDepthPayload.js`
- `src/sensoriumSubscriptionDisclosure.js`
- `src/sensoriumSubscriptionProvenance.js`
- `test/sensoriumDepthPayload.test.js`
- `test/sensoriumSubscriptionDisclosure.test.js`
- `test/sensoriumSubscriptionProvenance.test.js`
- `docs/concepts/drafts/sensorium_depth_metadata_contract.md`
- `docs/concepts/drafts/sensorium_integration.md`
- `ROADMAP.md`

## Disposition

Accepted as a pre-live metadata slice.

This adds a standalone Node depth payload summarizer and bounded summary-copy support for
`depth_units`, but it does not activate live depth subscription metadata handling. Live depth remains
blocked on helper-side PNG minimization.

## What Landed

- `summarizeSensoriumDepthPayload` decodes Sensorium depth MessagePack into the previously reviewed
  metadata-only contract.
- The summarizer reports schema-version mismatches without retaining payload bytes.
- Disclosure and provenance copy `depth_units` only when it is a positive finite number.
- Tests prove raw depth fields such as `raw_depth` are not copied through disclosure or provenance.
- The roadmap now names helper-side depth minimization as the next prerequisite before live depth
  smoke.

## Boundary

This change does not add:

- live depth smoke
- helper-side depth downsampling
- active subscriber depth sample summarization
- model-facing depth delivery
- screenshots, recordings, raw depth arrays, point clouds, meshes, or derived geometry

The standalone summarizer is useful contract scaffolding, but it is not a substitute for helper-side
minimization. Depth subscription activation still needs the helper to enforce `format_required=png`
and `downsample_to` before payload bytes cross into Node-visible state.

## Verification

Commands run:

```bash
npm test -- --test-name-pattern "DepthPayload|depth_units|stream-contract|sensoriumStreamContracts"
npm test
```

Result:

- focused tests passed
- full Node test suite passed: `353` tests

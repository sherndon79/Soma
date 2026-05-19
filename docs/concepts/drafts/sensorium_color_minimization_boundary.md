# Sensorium Color Minimization Boundary

## Purpose

Soma can already subscribe to Sensorium color frames under an explicit grant, but the active color
path is metadata-only: it decodes enough MessagePack to record bounded frame metadata and deliberately
does not deliver image bytes to model context.

The visual step captured here is not "send frames to the model." It is the
content-minimization boundary that enforces `downsample_to` before any
model-facing visual payload exists.

## Current State

Implemented:

- color subscriptions require explicit camera-class acknowledgement in the live smoke wrapper
- grants validate `max_seconds`, `max_fps`, `format_required`, and `downsample_to`
- `soma-sensor-broker` enforces `max_fps` before sample payload bytes are serialized to Node
- Node records only `stream_summary_observed` metadata for color samples
- live color metadata smoke passes with bounded sample delivery and clean runtime cleanup

Implemented in the helper for color JPEG subscriptions:

- image decoding
- image downsampling
- image re-encoding
- fail-closed transform errors

Still not implemented:

- model-facing visual delivery
- image recording or screenshots
- derivative visual streams

## Decision

The first active `downsample_to` implementation should live at the bounded helper boundary, not in
the Node policy layer and not in Sensorium.

Rationale:

- Sensorium remains producer-only and consumer-agnostic.
- Node remains the policy authority, but should not become a media-processing hot path.
- The helper already sits at the byte-flow boundary between Zenoh samples and Node notifications.
- Enforcing minimization before bytes cross into Node reduces accidental retention and disclosure
  risk.
- A helper transform can fail closed before producing a model-facing payload.

The first implementation should transform only color JPEG payloads for
`perception.sensorium.color.subscribe` subscriptions that declare `downsample_to`.

## Input Contract

The helper may receive these optional `sensorium.subscribe.start` params from Node:

```json
{
  "topic": "sensor/jetsorano/realsense/color",
  "zenoh_config_path": "config/sensorium-zenoh-client.example.json5",
  "max_fps": 1,
  "downsample_to": [320, 240],
  "format_required": "jpeg"
}
```

Rules:

- `max_fps` remains a delivery-rate bound.
- `downsample_to` is a maximum output size, not permission to enlarge frames.
- `format_required` must match the decoded color payload format before transformation.
- Missing transform params keep the current pass-through subscription behavior, but color smoke and
  future model-facing visual delivery should require explicit transform params.
- Invalid transform params fail before opening a subscription.

## Transform Contract

For color JPEG samples:

1. Decode Sensorium `ColorFrame` MessagePack.
2. Verify `schema_version == 1`.
3. Verify `format == "jpeg"` when `format_required == "jpeg"`.
4. Decode JPEG bytes.
5. Resize to fit within `[max_width, max_height]` while preserving aspect ratio.
6. Re-encode JPEG.
7. Re-encode MessagePack with:
   - original `schema_version`
   - original `timestamp`
   - original `frame_number`
   - transformed `width`
   - transformed `height`
   - original `format`
   - transformed `data`

The transform must never emit:

- raw decoded pixels
- screenshots
- text extraction
- scene descriptions
- additional inferred metadata
- persistent files

## Failure Rules

The transform fails closed for:

- malformed MessagePack
- unsupported schema version
- unsupported or mismatched format
- JPEG decode failure
- resize or encode failure
- transformed dimensions exceeding requested bounds
- transformed payload still reporting original dimensions

When a transform fails, the helper should emit a bounded error notification or terminate the
subscription with an error class; it must not pass through the original full-resolution frame as a
fallback.

## Metadata-Only Smoke

The existing color live smoke remains metadata-only. It asserts that the observed
`stream_summary_observed.width` and `.height` fit within the requested `downsample_to` bound while
still refusing image bytes, screenshots, text content, recordings, or model-facing visual payloads.

## Covered Test Requirements

Unit tests:

- Node forwards `downsample_to` and `format_required` to the helper only after request validation.
- helper rejects malformed `downsample_to` and unsupported `format_required` before opening Zenoh.
- helper transform rejects malformed MessagePack and invalid JPEG bytes.
- helper transform preserves frame number and schema while changing dimensions and payload size.
- helper transform never enlarges frames.
- helper transform fails closed instead of passing through full-resolution bytes.

Integration tests:

- fake or fixture-backed helper test proves a 1280x720 color payload becomes bounded to 320x180 or
  smaller for `downsample_to=[320, 240]`.
- live color smoke may pass only when observed metadata fits the declared bounds.

Regression tests:

- metadata-only paths still do not expose `data`, `payload_bytes`, `image_bytes`, screenshots, text
  content, or raw frames in disclosure/provenance.
- model-facing visual delivery remains unavailable until a separate capability explicitly consumes
  the transformed payload.

## Dependency Choice

The helper uses a small Rust image stack for this boundary:

- `rmp-serde` and `serde` for Sensorium `ColorFrame` MessagePack
- `image` with JPEG support for decode/resize/encode

This keeps the first transform inside `soma-sensor-broker`. If additional media transforms grow
substantially, split them into a dedicated crate or binary before adding broader image/video
processing responsibilities.

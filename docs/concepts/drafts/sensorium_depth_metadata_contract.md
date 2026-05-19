# Sensorium Depth Metadata Contract

## Purpose

Soma already models `perception.sensorium.depth.subscribe` as a camera-class restricted capability,
but live depth subscription should not proceed until the metadata boundary is explicit and
test-backed.

Depth maps are not "less sensitive" than color frames. Even without color texture, they can reveal
room geometry, body presence, posture, motion, and spatial relationships. This contract keeps the
first depth step metadata-only and out of model context.

## Current State

Implemented before live depth smoke:

- the capability catalog includes `perception.sensorium.depth.subscribe`
- the request validator binds depth capability requests to `sensor/<host>/realsense/depth`
- the request validator allows depth constraints for `max_seconds`, `max_fps`, `format_required`,
  and `downsample_to`
- the only allowed depth format is `png`
- the stream-summary contract accepts only bounded depth metadata
- the standalone depth payload summarizer decodes MessagePack only into bounded metadata
- disclosure and provenance copy `depth_units` only when it is a positive finite number

Still not implemented:

- live depth smoke
- helper-side depth PNG minimization
- depth map delivery to model context
- depth recording, screenshots, point clouds, meshes, or derived scene geometry

## Depth Summary

Sensorium depth payloads are expected to represent PNG-encoded 16-bit depth maps with a
`depth_units` field that lets a downstream consumer convert raw samples into distance units.

Soma's first depth contract is metadata-only. It permits only this summary shape:

- `schema_version`
- `frame_number`
- `width`
- `height`
- `format`
- `depth_units`
- `payload_size`

Rules:

- `schema_version` must be an integer.
- `frame_number` must be a non-negative integer when present.
- `width` and `height` must be positive integers.
- `format` must be `png`.
- `depth_units` must be a positive finite number.
- `payload_size` must be a non-negative integer when present.

## Excluded Content

Depth summaries must not expose:

- `data`
- `payload_bytes`
- `depth_bytes`
- `depth_array`
- `raw_depth`
- `raw_frame`
- `point_cloud`
- `mesh`
- `image_bytes`
- `image_content`
- `screenshot`
- `text_content`
- `timestamp`

They also must not include cross-stream fields such as status uptime, enabled stream lists, color
image content, or location data.

## Activation Boundary

Before any live depth smoke:

- the bounded depth contract must be reviewed
- depth smoke must require explicit camera-class acknowledgement
- smoke must require `max_seconds`, `max_fps`, `format_required=png`, and `downsample_to`
- active disclosure and end provenance must expose only `stream_summary_observed`
- cleanup must return to zero active subscriptions

Live depth smoke remains out of scope for this contract slice. This document only defines the
minimum acceptable metadata surface.

The standalone Node summarizer is intentionally not treated as live activation by itself. Depth
subscription activation still depends on helper-side minimization so Soma does not silently consume
full-resolution depth maps while reporting bounded intent.

## Future Helper Boundary

If depth minimization becomes active, it should happen in `soma-sensor-broker` before payload bytes
cross into Node-visible state, matching the color minimization posture.

The helper-side depth transform must fail closed for:

- malformed MessagePack
- unsupported schema version
- unsupported or mismatched format
- PNG decode failure
- invalid 16-bit depth representation
- resize or encode failure
- transformed dimensions exceeding requested bounds
- transformed payload still reporting original dimensions

The helper must not fall back to passing through the original full-resolution depth map after a
transform failure.

## Model Boundary

This contract does not authorize model-facing depth delivery. Any later model-facing depth
capability needs a separate grant and a separate minimization/disclosure review because spatial
scene data can be identifying and difficult to retract after interpretation.

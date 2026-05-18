# Sensorium Color Live Metadata Verification

**Date:** 2026-05-18
**Scope:** Explicitly acknowledged live Sensorium color smoke against `jetsorano`, with bounded
runtime grant constraints and metadata-only observation.

## Commands Exercised

Soma was started with Sensorium enabled and the stable Zenoh client config:

```bash
SOMA_PORT=8876 \
SOMA_SENSORIUM_ENABLED=1 \
SOMA_SENSORIUM_ZENOH_CONFIG=config/sensorium-zenoh-client.example.json5 \
npm start
```

The guarded camera-class smoke was run with explicit acknowledgement:

```bash
SOMA_URL=http://127.0.0.1:8876 \
SOMA_SENSORIUM_ENABLED=1 \
SOMA_SENSORIUM_LIVE_SMOKE=1 \
npm run sensorium:smoke -- \
  --capability perception.sensorium.color.subscribe \
  --provider soma.provider.sensorium.jetsorano \
  --topic sensor/jetsorano/realsense/color \
  --max-seconds 15 \
  --max-fps 1 \
  --format jpeg \
  --downsample 320x240 \
  --observe-seconds 8 \
  --acknowledge-camera-stream
```

## Result: Delivery Rate

Pass, after one implementation correction.

Initial live smoke completed the control path but observed `194` samples in eight seconds despite
`--max-fps 1`. That showed `max_fps` was being validated as grant authority but not applied at the
helper delivery boundary.

Soma now passes `max_fps` to `soma-sensor-broker`, and the Rust helper drops samples before
serializing `payload_bytes` back to Node when the requested delivery interval has not elapsed. The
smoke wrapper also fails camera-class runs that far exceed the declared `max_fps` bound.

After rebuilding the helper binary and restarting Soma, the same live smoke passed:

```text
Observation wait: 8 second(s).
Observed sample count: 9
Sensorium live smoke completed.
```

## Observed Metadata

A manual temporary color subscription captured only bounded metadata in disclosure/provenance:

```text
frames_consumed: 9
schema_version_observed: 1
schema_mismatches: 0
first_frame_number: 79940
last_frame_number: 80181
stream_summary_observed:
  schema_version: 1
  frame_number: 80181
  width: 1280
  height: 720
  format: jpeg
  payload_size: 180246
frames_recorded: false
text_content_included: false
```

Cleanup check:

```text
active_count: 0
frames_recorded: false
```

## Boundary Note

This verifies metadata-only color observation and helper-side `max_fps` delivery throttling. It does
not verify image downsampling. The `downsample_to=320x240` constraint is currently part of the grant
and review surface, but the observed metadata still reflects the native producer frame
(`1280x720`). Before any color frame is delivered to model context, Soma needs a separate
implementation slice that performs content minimization/downsampling at the helper or another
bounded preprocessing boundary.

No image bytes, screenshots, recordings, text content, or model-facing visual payloads were retained
or surfaced by the Soma disclosure/provenance path in this run.

## Addendum: Color Downsample Boundary

After the follow-up minimization slice, Soma now passes color-only `downsample_to` and
`format_required` constraints to `soma-sensor-broker`. The helper decodes Sensorium color
MessagePack/JPEG samples, downsamples them before serializing sample bytes back to Node, re-encodes
JPEG output, and fails closed on malformed payloads instead of passing original bytes through.

The guarded camera-class smoke was rerun with the same command above after rebuilding
`target/debug/soma-sensor-broker` and restarting Soma. The smoke wrapper now also verifies that
observed color metadata fits the declared `--downsample` bound.

```text
Observation wait: 8 second(s).
Observed sample count: 9
Sensorium live smoke completed.
```

A manual temporary color subscription captured the resulting bounded metadata:

```text
frames_consumed: 9
schema_version_observed: 1
schema_mismatches: 0
first_frame_number: 156784
last_frame_number: 157026
stream_summary_observed:
  schema_version: 1
  frame_number: 157026
  width: 320
  height: 180
  format: jpeg
  payload_size: 16233
frames_recorded: false
text_content_included: false
```

Cleanup check:

```text
active_count: 0
streams: []
```

This verifies the live helper-side color JPEG minimization boundary for `downsample_to=320x240`:
the original `1280x720` producer frame is reduced to `320x180`, preserving aspect ratio inside the
requested bound, before Node receives sample bytes for metadata summarization. It still does not
activate model-facing visual delivery, screenshots, recording, retention, or derivative streams.

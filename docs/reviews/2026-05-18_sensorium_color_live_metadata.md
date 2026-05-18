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

## Result

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

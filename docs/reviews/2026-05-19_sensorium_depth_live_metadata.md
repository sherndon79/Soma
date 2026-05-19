# Sensorium Depth Live Metadata Verification

Date: 2026-05-19

Scope: explicitly acknowledged live depth metadata smoke against the `jetsorano` Sensorium producer
after helper-side depth PNG minimization landed.

## Runtime Setup

Soma was started with Sensorium explicitly enabled and pointed at the pinned Zenoh client config:

```bash
env SOMA_PORT=8876 \
  SOMA_SENSORIUM_ENABLED=1 \
  SOMA_SENSORIUM_ZENOH_CONFIG=config/sensorium-zenoh-client.example.json5 \
  npm start
```

Startup reported the local helper path and listened on `http://127.0.0.1:8876`.

The remote producer was running:

```text
sensorium-node Up 16 hours
```

## Status Smoke

Command:

```bash
env SOMA_URL=http://127.0.0.1:8876 \
  SOMA_SENSORIUM_ENABLED=1 \
  SOMA_SENSORIUM_LIVE_SMOKE=1 \
  npm run sensorium:smoke -- \
  --capability perception.sensorium.status.subscribe \
  --provider soma.provider.sensorium.jetsorano \
  --topic sensor/jetsorano/status \
  --max-seconds 30 \
  --observe-seconds 8
```

Result:

- observed sample count: `2`
- smoke completed successfully

## Acknowledged Depth Smoke

Command:

```bash
env SOMA_URL=http://127.0.0.1:8876 \
  SOMA_SENSORIUM_ENABLED=1 \
  SOMA_SENSORIUM_LIVE_SMOKE=1 \
  npm run sensorium:smoke -- \
  --capability perception.sensorium.depth.subscribe \
  --provider soma.provider.sensorium.jetsorano \
  --topic sensor/jetsorano/realsense/depth \
  --max-seconds 15 \
  --max-fps 1 \
  --format png \
  --downsample 320x240 \
  --observe-seconds 8 \
  --acknowledge-camera-stream
```

Result:

- first run observed sample count: `8`
- rerun after smoke-wrapper `depth_units` validation observed sample count: `9`
- smoke completed successfully
- the camera-class stream required explicit acknowledgement

## Manual Depth Metadata Capture

A manual proposal, approval, runtime grant, subscription, stop, and revocation pass was run to
inspect bounded depth metadata. The active stream summary after eight seconds was:

```json
{
  "active_count": 1,
  "frames_recorded": false,
  "stream": {
    "frames_consumed_so_far": 8,
    "recent_frame_rate": 0.9847008949995958,
    "stream_summary_observed": {
      "schema_version": 1,
      "frame_number": 1756325,
      "width": 320,
      "height": 181,
      "format": "png",
      "payload_size": 62143,
      "depth_units": 0.0010000000474974513
    },
    "helper_error_class": ""
  }
}
```

The manual stop summary was:

```json
{
  "frames_consumed": 8,
  "termination_reason": "clean_stop",
  "error_class": "",
  "schema_version_observed": 1,
  "schema_mismatches": 0,
  "first_frame_number": 1756108,
  "last_frame_number": 1756325,
  "stream_summary_observed": {
    "schema_version": 1,
    "frame_number": 1756325,
    "width": 320,
    "height": 181,
    "format": "png",
    "payload_size": 62143,
    "depth_units": 0.0010000000474974513
  },
  "frames_recorded": false,
  "text_content_included": false
}
```

The final active subscription check returned:

```json
{
  "active_count": 0,
  "streams": []
}
```

## Disposition

Accepted as the first live depth metadata verification.

This verifies the helper-side depth minimization boundary under live producer conditions:

- depth metadata stayed within the requested `320x240` bound
- the observed stream format was `png`
- `depth_units` was present and positive
- runtime grants remained process-local
- cleanup returned to zero active subscriptions
- no recording, screenshots, raw depth arrays, point clouds, meshes, text content, or model-facing
  payload delivery occurred

This remains metadata-only. Any future model-facing visual or spatial payload delivery still needs a
separate capability, disclosure preview, retention policy, and review.

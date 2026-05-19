# Sensorium Post-Hardening Live Regression

Date: 2026-05-18

Scope: post-hardening live regression against the `jetsorano` Sensorium producer after helper
stream-error metadata, `max_seconds` timeout enforcement, automatic ending provenance, and
current-state documentation cleanup.

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
sensorium-node Up 6 hours
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
- runtime grant and subscription cleanup completed through the smoke wrapper

## Acknowledged Color Smoke

Command:

```bash
env SOMA_URL=http://127.0.0.1:8876 \
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

Result:

- observed sample count: `8`
- smoke completed successfully
- the camera-class stream required explicit acknowledgement
- runtime grant and subscription cleanup completed through the smoke wrapper

## Manual Color Metadata Capture

A manual proposal, approval, runtime grant, subscription, stop, and revocation pass was run to
inspect bounded disclosure metadata. The active stream summary after eight seconds was:

```json
{
  "active_count": 1,
  "frames_recorded": false,
  "stream": {
    "frames_consumed_so_far": 8,
    "recent_frame_rate": 0.983889647744206,
    "stream_summary_observed": {
      "schema_version": 1,
      "frame_number": 661387,
      "width": 320,
      "height": 180,
      "format": "jpeg",
      "payload_size": 14883
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
  "first_frame_number": 661171,
  "last_frame_number": 661387,
  "stream_summary_observed": {
    "schema_version": 1,
    "frame_number": 661387,
    "width": 320,
    "height": 180,
    "format": "jpeg",
    "payload_size": 14883
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

Accepted as a post-hardening live regression.

This verifies that the recent helper-error, timeout, automatic-ending, and documentation alignment
work did not regress the known live Sensorium control path. The status stream still delivers bounded
metadata, the acknowledged color stream still enforces a bounded `max_fps` and `downsample` request,
and cleanup still returns to zero active subscriptions.

This run did not live-trigger timeout or helper-error paths. Those remain covered by focused tests
and bounded provenance validation rather than this normal-path smoke.

The boundary remains unchanged:

- no default Sensorium grants
- runtime grants only
- no raw image bytes retained in Node-visible state
- no recordings or screenshots
- no text payload routed to model context
- no model-facing visual delivery

# Remote Graphical Live Session-Open Provenance

Status: draft, live session-open provenance disabled

This draft defines the metadata-only provenance shape for a future live remote graphical
`open_session` action. It does not enable live Sunshine/Moonlight transport, pairing, video
observation, input dispatch, recording, durable grant writes, or model-facing visual delivery.

The existing fixture event type remains:

```text
remote_graphical.session_open.fixture
```

A future live event must use a distinct event type:

```text
remote_graphical.session_open.live
```

The separate event type prevents fixture evidence from being confused with live transport evidence.

## Construction Rule

Live session-open provenance should follow the same preview-first discipline as fixture
provenance:

```text
broker result
  -> metadata-only provenance preview
  -> append preview
  -> response write
```

The appended event must equal the response `provenance_preview`. If append fails, the failure must
be bounded and must not retry the broker, re-open transport, mutate grants, or leak provider
diagnostics.

## Allowed Fields

A live session-open provenance summary may include only bounded metadata:

```json
{
  "event_type": "remote_graphical.session_open.live",
  "outcome": "success",
  "source_grant_id": "grant-remote-video",
  "capability": "perception.remote_desktop.video.subscribe",
  "provider": "soma.provider.remote_desktop.sunshine",
  "target_host": "soma-agent-desktop.local.sthnet.org",
  "scope": "session",
  "requested_by": "user",
  "broker_action": "open_session",
  "status": "opened",
  "state": "open_observe_inactive",
  "session_id": "runtime-session-id",
  "error": "",
  "cause_code": "",
  "fixture_only": false,
  "activation_performed": true,
  "broker_called": true,
  "session_opened": true,
  "durable": false,
  "grant_written": false,
  "pairing_performed": false,
  "video_attached": false,
  "input_dispatched": false,
  "recording_started": false,
  "provider_session_stopped": false,
  "model_delivery": false,
  "live_transport_used": true,
  "payload_bytes_included": false,
  "frames_included": false,
  "screenshots_included": false,
  "recognized_text_included": false,
  "clipboard_included": false,
  "input_events_included": false,
  "window_metadata_included": false,
  "file_metadata_included": false,
  "audio_payload_included": false,
  "transport_diagnostics_included": false
}
```

On failure, `outcome` should be `failure`, `session_opened` should be `false`, `session_id` should
be empty, and `error` plus `cause_code` should contain stable bounded codes. Failure provenance may
set `broker_called=true` only when the configured live broker was actually invoked.

## Required False Flags

The first live session-open event must preserve these false flags:

- `durable`
- `grant_written`
- `pairing_performed`
- `video_attached`
- `input_dispatched`
- `recording_started`
- `provider_session_stopped`
- `model_delivery`
- `payload_bytes_included`
- `frames_included`
- `screenshots_included`
- `recognized_text_included`
- `clipboard_included`
- `input_events_included`
- `window_metadata_included`
- `file_metadata_included`
- `audio_payload_included`
- `transport_diagnostics_included`

`live_transport_used` may be `true` only for the live event type and only after the live broker
activation checklist is satisfied. It must remain `false` for fixture events.

## Forbidden Inputs

The constructor must reject any input carrying content-bearing or diagnostic-shaped fields,
including:

- frame bytes, images, screenshots, thumbnails, or video payloads
- OCR or recognized text
- clipboard contents
- keystrokes, pointer paths, or input events
- window titles, file names, paths, or remote application metadata
- audio payloads
- transport logs, stdout/stderr, stack traces, or provider diagnostics

Transport diagnostics are intentionally excluded from the event even when they would be useful for
debugging. Debuggability must not widen provenance content.

## Validation Requirements

Before live provenance append can be implemented, tests should prove:

- fixture and live constructors use different event types
- live success requires `session_id`
- live failure requires stable `error` and `cause_code`
- fixture events cannot set `live_transport_used=true`
- live events cannot include payload, frame, screenshot, OCR, clipboard, input, window, file,
  audio, or diagnostic fields
- append failure does not cause a second broker invocation
- refusal paths before broker invocation do not append live session-open provenance
- `provenance list --event-type remote_graphical.session_open.live --json` shows only metadata

## Out Of Scope

This draft does not authorize:

- live broker construction
- Sunshine/Moonlight pairing
- frame capture or video observation
- screenshots, OCR, window metadata, or remote semantic inspection
- pointer, keyboard, clipboard, file, controller, or audio channels
- provider disconnect
- recording
- model-facing visual delivery
- durable grant mutation

## Related Documents

- [Remote Graphical Session-Open Provenance Append Policy](./remote_graphical_session_open_provenance_append_policy.md)
- [Remote Graphical Live Broker Activation Checklist](./remote_graphical_live_broker_activation_checklist.md)
- [Remote Graphical Live Provider Manifest](./remote_graphical_live_provider_manifest.md)
- [Remote Graphical Session-Open Activation Policy](./remote_graphical_session_open_activation_policy.md)
- [Remote Graphical Broker Boundary](./remote_graphical_broker_boundary.md)

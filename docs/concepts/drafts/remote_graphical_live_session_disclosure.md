# Remote Graphical Live Session Disclosure

Status: pure disclosure constructor implemented, no route activation

This document defines the active disclosure shape for a future live remote graphical session that has
opened a provider substrate but has not activated observation or input.

## State

The first live opened-substrate state is:

```text
open_observe_inactive
```

This means Soma has a provider session substrate, but the following remain inactive:

- video observation
- screenshot capture
- OCR or recognized text
- pointer input
- keyboard input
- clipboard, file transfer, audio, or controller channels
- recording
- model-facing visual delivery

## Disclosure Shape

`createRemoteGraphicalLiveSessionDisclosure` returns metadata only:

```json
{
  "type": "remote_graphical_live_session_disclosure",
  "session_id": "live-session-1",
  "source_grant_id": "grant-remote-video",
  "provider": "soma.provider.remote_desktop.sunshine",
  "target_host": "soma-agent-desktop.local.sthnet.org",
  "state": "open_observe_inactive",
  "locality": "lan",
  "attended": true,
  "opened_at": "2026-05-26T12:00:00.000Z",
  "expires_at": "2026-05-26T12:02:00.000Z",
  "active_authorities": [],
  "input_channels": [],
  "video": {
    "observing": false,
    "frames_attached": false,
    "screenshots_captured": false,
    "recognized_text_included": false
  },
  "recording": false,
  "model_delivery": false
}
```

The disclosure also includes revocation text pointing at bounded `cleanup_for_grant`.

## Forbidden Content

The constructor and validator reject content-bearing fields, including:

- frame bytes, images, thumbnails, screenshots, and video frames
- OCR or recognized text
- clipboard content
- keystrokes, pointer paths, and input events
- remote window titles or window metadata
- file names, file paths, and audio payloads
- transport logs, stdout, stderr, stack traces, or diagnostics

## Relationship To Activation

The constructor is not called by `POST /remote-graphical/sessions` in the current implementation.
It is a contract for future live broker results and active disclosure review.

A valid disclosure may set:

```text
activation_performed=true
broker_called=true
session_opened=true
live_transport_used=true
```

Those fields refer only to the opened session substrate. They do not imply video, input, recording,
provider-wide disconnect, durable grant writes, or model delivery.

## Related Documents

- [Remote Graphical Live Broker Readiness](./remote_graphical_live_broker_readiness.md)
- [Remote Graphical Live Broker Activation Checklist](./remote_graphical_live_broker_activation_checklist.md)
- [Remote Graphical Broker Boundary](./remote_graphical_broker_boundary.md)
- [Remote Graphical Live Session-Open Provenance](./remote_graphical_live_session_open_provenance.md)

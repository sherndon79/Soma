# Remote Graphical Live Session-Open Result

Status: pure result constructors implemented, no route activation

This document defines the future live session-open result composition. It does not authorize
`POST /remote-graphical/sessions` to call a live broker.

## Success Shape

`buildRemoteGraphicalLiveSessionOpenSuccess` composes:

- the reviewed session-open intent
- a bounded live broker result
- metadata-only active disclosure for `open_observe_inactive`
- metadata-only live provenance preview

The success result sets:

```text
type=remote_graphical_session_open_result
refused=false
state=open_observe_inactive
fixture_only=false
activation_performed=true
broker_called=true
session_opened=true
live_transport_used=true
provenance_appended=false
```

The following remain false:

- durable grant writes
- pairing
- video observation or model-facing visual delivery
- pointer or keyboard input
- recording
- provider session stop

## Failure Shape

`buildRemoteGraphicalLiveSessionOpenFailure` requires a stable `cause.code` and returns a bounded
refusal with a live provenance preview. It does not copy exception messages, stacks, diagnostics,
stdout, stderr, transport logs, or other content-bearing fields.

## Route Boundary

The constructors are not wired into `POST /remote-graphical/sessions`. The route still refuses
configured non-fixture brokers until the live activation checklist is satisfied and reviewed.

## Related Documents

- [Remote Graphical Live Session Disclosure](./remote_graphical_live_session_disclosure.md)
- [Remote Graphical Live Session-Open Provenance](./remote_graphical_live_session_open_provenance.md)
- [Remote Graphical Live Broker Readiness](./remote_graphical_live_broker_readiness.md)
- [Remote Graphical Live Broker Activation Checklist](./remote_graphical_live_broker_activation_checklist.md)

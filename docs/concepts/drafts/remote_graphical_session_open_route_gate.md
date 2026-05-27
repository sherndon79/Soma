# Remote Graphical Session-Open Route Gate

Status: pure route gate implemented, live invocation disabled

This document defines the decision point used by `POST /remote-graphical/sessions` before broker
invocation.

## Current Behavior

The route may invoke only the existing configured fixture path:

```text
requested=true
enabled=true
configured=true
session_open_fixture=true
broker.openSession is present
```

That preserves current fixture-only behavior and does not authorize live Sunshine/Moonlight
transport.

## Live Route Boundary

`decideRemoteGraphicalSessionOpenRouteInvocation` can represent a future live route decision, but
live invocation remains refused unless a future reviewed switch explicitly sets
`allowLiveRouteInvocation=true` and live readiness reports `ready=true`.

Without that explicit switch:

```text
ready=true
route_mode=refusal
refusal=live_route_invocation_disabled
```

With only candidate readiness:

```text
candidate=true
route_mode=refusal
refusal=live_activation_guard_disabled
```

The current HTTP route does not pass live readiness into the gate and does not set the live route
switch. Therefore the route cannot call a live broker in this slice.

## Non-Activation Guarantees

The route gate is pure. It does not call a broker and reports false for:

- `activation_performed`
- `broker_called`
- `session_opened`
- `pairing_performed`
- `video_attached`
- `input_dispatched`
- `recording_started`
- `provider_session_stopped`
- `model_delivery`
- `live_transport_used`

## Related Documents

- [Remote Graphical Live Broker Readiness](./remote_graphical_live_broker_readiness.md)
- [Remote Graphical Live Session-Open Result](./remote_graphical_live_session_open_result.md)
- [Remote Graphical Live Broker Activation Checklist](./remote_graphical_live_broker_activation_checklist.md)

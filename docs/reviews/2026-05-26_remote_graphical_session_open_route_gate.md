# Remote Graphical Session-Open Route Gate Review

Review after adding the pure route gate for remote graphical session-open invocation.

## Scope

- `src/remoteGraphicalSessionOpenRouteGate.js`
- `src/app.js`
- `test/remoteGraphicalSessionOpenRouteGate.test.js`
- `docs/concepts/drafts/remote_graphical_session_open_route_gate.md`
- `docs/concepts/drafts/remote_graphical_live_broker_activation_checklist.md`
- `docs/README.md`
- `ROADMAP.md`

## Summary

`POST /remote-graphical/sessions` now uses a named pure route decision before invoking the existing
fixture broker path. The current invokable path remains exactly the configured fixture case:

```text
requested=true
enabled=true
configured=true
session_open_fixture=true
broker.openSession present
```

The gate can represent future live readiness, but live invocation remains refused unless a future
reviewed switch explicitly enables it.

## Boundary

This slice does not pass live readiness into the HTTP route, set `allowLiveRouteInvocation`, call a
live broker, append live provenance, pair with Sunshine, start Moonlight, observe video, capture
screenshots, run OCR, dispatch input, record, stop provider sessions, write grants, or deliver visual
payloads to a model.

## Verification

- `node --test test/remoteGraphicalSessionOpenRouteGate.test.js test/remoteGraphicalSessionOpenReview.test.js test/app.test.js`

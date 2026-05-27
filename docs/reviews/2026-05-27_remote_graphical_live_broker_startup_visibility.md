# Remote Graphical Live Broker Startup Visibility Review

Date: 2026-05-27

## Scope

- `src/cli.js`
- `test/cli.test.js`
- `docs/concepts/drafts/remote_graphical_live_broker_adapter_plan.md`
- `ROADMAP.md`

## Summary

This slice exposes the pure startup posture planner as review-only CLI visibility:

```text
soma remote-graphical startup-review [--json]
```

The command reads the committed remote graphical live provider manifest fixture locally, builds the
startup posture plan, and prints either concise operator text or JSON-first machine output. It does
not call the Soma service, construct `RemoteGraphicalLiveBrokerManager`, start the helper, call the
broker, open a session, or use live transport.

## Boundary

Implemented:

- local `startup-review` command and help text
- text summary for startup eligibility and inactive side-effect flags
- JSON response containing review-only plan metadata
- tests proving no service request is made and unsupported source-selection flags fail locally

Not implemented:

- runtime construction of `RemoteGraphicalLiveBrokerManager`
- helper startup or method implementation
- route invocation, session-open, pairing, video observation, input dispatch, recording, model
  delivery, durable grant writes, cleanup invocation, or live provenance append

## Verification

- `node --test test/cli.test.js`
- `npm test`

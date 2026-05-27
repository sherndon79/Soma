# Remote Graphical Live Broker Startup Plan Review

Date: 2026-05-27

## Scope

- `src/remoteGraphicalLiveBrokerStartupPlan.js`
- `test/remoteGraphicalLiveBrokerStartupPlan.test.js`
- `docs/concepts/drafts/remote_graphical_live_broker_adapter_plan.md`
- `ROADMAP.md`

## Summary

This slice adds a pure startup posture planner for future live broker manager construction.
`planRemoteGraphicalLiveBrokerManagerStartup` reports eligibility only when:

- remote graphical runtime opt-in is explicit
- repository manifest posture is configured and loaded
- provider and target host identity are present
- the helper binary path is reviewed

The planner returns review metadata only. It does not construct `RemoteGraphicalLiveBrokerManager`,
start the helper, call the broker, open sessions, or alter `createRemoteGraphicalRuntime`.

## Boundary

Implemented:

- pure eligibility/refusal planner for future manager startup
- tests for runtime opt-in, manifest posture, identity, helper path, and eligible posture
- regression coverage proving `createRemoteGraphicalRuntime` remains on the no-op broker path
- adapter-plan and roadmap updates

Not implemented:

- runtime construction of `RemoteGraphicalLiveBrokerManager`
- helper startup or method implementation
- route invocation, session-open, pairing, video observation, input dispatch, recording, model
  delivery, durable grant writes, cleanup invocation, or live provenance append

## Verification

- `node --test test/remoteGraphicalLiveBrokerStartupPlan.test.js test/remoteGraphicalRuntime.test.js`
- `npm test`

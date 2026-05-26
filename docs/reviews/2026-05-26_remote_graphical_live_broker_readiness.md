# Remote Graphical Live Broker Readiness Review

Review after adding the pure live broker readiness contract for remote graphical session-open.

## Scope

- `src/remoteGraphicalLiveBrokerReadiness.js`
- `test/remoteGraphicalLiveBrokerReadiness.test.js`
- `docs/concepts/drafts/remote_graphical_live_broker_readiness.md`
- `docs/concepts/drafts/remote_graphical_broker_boundary.md`
- `docs/concepts/drafts/remote_graphical_live_broker_activation_checklist.md`
- `docs/README.md`
- `ROADMAP.md`

## Summary

Soma now has a testable live broker readiness contract for the future Sunshine/Moonlight path. The
contract names the first required broker methods:

```text
status
describeActive
openSession
cleanupForGrant
```

The readiness evaluator distinguishes configured manifest metadata from live broker eligibility. It
rejects missing opt-in, unconfigured status, fixture brokers, missing manifest metadata, provider
drift, target-host drift, and incomplete broker method surfaces.

A complete method surface currently produces `candidate=true` but `ready=false` with
`readiness=activation_guard_disabled`.

## Boundary

This is a pure readiness scaffold. It does not change `POST /remote-graphical/sessions`, construct
a Sunshine/Moonlight broker, call a broker, pair, open sessions, observe video, capture screenshots,
dispatch input, record, stop provider sessions, append live provenance, write grants, or deliver
visual payloads to a model.

## Verification

- `node --test test/remoteGraphicalLiveBrokerReadiness.test.js test/remoteGraphicalBroker.test.js test/remoteGraphicalSessionOpenReview.test.js`

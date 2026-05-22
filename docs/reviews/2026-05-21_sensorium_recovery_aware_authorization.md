# Sensorium Recovery-Aware Authorization

Review after wiring the pure grant authorization helper into the Sensorium subscription path.

## Scope

- `src/app.js`
- `test/app.test.js`
- `src/grantAuthorization.js`
- `ROADMAP.md`

## Summary

`POST /sensorium/subscriptions` now authorizes through `authorizeGrantUse` for its active-grant
lookup. The route accepts an optional injected `grantRecoveryReport`; when a matching active grant
has non-authorizing recovery findings, the route fails closed before provider checks, topic checks,
constraint enforcement, or subscriber invocation.

New route behavior:

- no active grant still returns `sensorium_subscription_no_grant`
- degraded matching grant returns `sensorium_subscription_grant_recovery_required`
- response includes the recovery findings for operator-facing inspection
- the Sensorium subscriber is not invoked on degraded grants

## Boundary

This is a non-mutating runtime authorization seam only. It does not enable durable grant writes,
public grant mutation routes, CLI mutation commands, runtime writes, or provenance reconciliation.
The route deliberately keeps existing route-specific provider/topic/constraint checks after the
grant authorization helper so existing denial codes remain stable.

## Residual Risk

Absence of a recovery report remains compatible with the current in-memory session-grant path. Before
durable grants can authorize runtime behavior, durable store loading should pair the grant store with
a fresh recovery inspection report and make missing inspection state fail closed.

Verification: `node --test test/app.test.js test/grantAuthorization.test.js` passes.

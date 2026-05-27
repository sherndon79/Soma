# Remote Graphical Live Broker Manager Contract Error Mapping Review

Date: 2026-05-27

## Scope

- `src/remoteGraphicalLiveBrokerManager.js`
- `test/remoteGraphicalLiveBrokerManager.test.js`
- `docs/concepts/drafts/remote_graphical_live_broker_adapter_plan.md`
- `ROADMAP.md`

## Summary

This slice bounds the Node manager error surface for successful helper responses that fail result
validation. `status`, `describe_active`, and `cleanup_for_grant` validator failures now surface as
`remote_graphical_live_helper_contract_invalid` with:

- `code_name: helper_contract_invalid`
- the result kind being validated
- the original stable validation error code as `cause_code`
- optional validation details

The manager does not retain or expose the helper payload on these errors. Helper protocol errors
from the stub Rust helper, including `method_implementation_pending`, continue to pass through
unchanged.

## Boundary

Implemented:

- bounded manager-side wrapping for result validator failures
- tests proving over-disclosing synthetic helper results do not leak payloads
- tests proving validation details can survive without retaining the original result
- adapter-plan and roadmap updates

Not implemented:

- any Sunshine/Moonlight helper method implementation
- runtime manager construction or route invocation
- live session-open, pairing, video observation, input dispatch, recording, model delivery, durable
  grant writes, cleanup invocation, or live provenance append

## Verification

- `node --test test/remoteGraphicalLiveBrokerManager.test.js`
- `npm test`

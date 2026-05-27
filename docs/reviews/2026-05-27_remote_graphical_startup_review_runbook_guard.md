# Remote Graphical Startup Review Runbook Guard

Date: 2026-05-27

## Scope

- `test/remoteGraphicalStartupReviewRunbook.test.js`
- `ROADMAP.md`

## Summary

This slice adds focused guard coverage for the startup-review runbook. The test verifies that the
documented local commands, source guard refusals, expected text markers, and expected JSON false
flags stay synchronized with actual `soma remote-graphical startup-review` CLI output.

The test also proves the CLI path remains local and side-effect-free by injecting a request function
that would fail if the command tried to call the Soma service.

## Boundary

Implemented:

- runbook command/source-guard marker checks
- text marker checks against actual CLI output
- JSON false-flag checks against actual CLI output
- no-service-request assertion

Not implemented:

- runtime construction of `RemoteGraphicalLiveBrokerManager`
- helper startup or method implementation
- route invocation, session-open, pairing, video observation, input dispatch, recording, model
  delivery, durable grant writes, cleanup invocation, or live provenance append

## Verification

- `node --test test/remoteGraphicalStartupReviewRunbook.test.js`
- `npm test`

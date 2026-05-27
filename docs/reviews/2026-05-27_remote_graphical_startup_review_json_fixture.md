# Remote Graphical Startup Review JSON Fixture

Date: 2026-05-27

## Scope

- `docs/fixtures/remote-graphical-startup-review-output.example.json`
- `test/remoteGraphicalStartupReviewFixture.test.js`
- `docs/runbooks/remote_graphical_startup_review.md`
- `ROADMAP.md`

## Summary

This slice adds a portable example fixture for the machine-readable
`soma remote-graphical startup-review --json` output. The guard test compares the fixture against
current CLI output after normalizing the workspace-absolute helper binary path to a portable
`<repo-root>` marker.

The fixture is intended for future operator automation and documentation. It does not create a
runtime route, invoke a broker, start the helper, or change provider registry behavior.

## Boundary

Implemented:

- portable startup-review JSON example fixture
- parity test against current CLI output shape
- explicit guard that all activation flags remain false
- runbook reference to the fixture and path normalization

Not implemented:

- `/remote-graphical/startup-review` route
- runtime construction of `RemoteGraphicalLiveBrokerManager`
- helper startup, Sunshine/Moonlight pairing, video observation, input dispatch, recording, model
  delivery, durable grant writes, cleanup invocation, or live provenance append

## Verification

- `node --test test/remoteGraphicalStartupReviewFixture.test.js`
- `npm test`

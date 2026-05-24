# Remote Graphical Runtime Opt-In

Review after adding startup-visible remote graphical runtime posture without live transport.

## Scope

- `src/remoteGraphicalRuntime.js`
- `src/remoteGraphicalBroker.js`
- `src/server.js`
- `src/cli.js`
- `test/remoteGraphicalRuntime.test.js`
- `test/remoteGraphicalBroker.test.js`
- `test/app.test.js`
- `test/cli.test.js`
- `docs/operators.md`
- `docs/concepts/drafts/remote_graphical_session_open_activation_policy.md`
- `ROADMAP.md`

## Summary

Soma now recognizes `SOMA_REMOTE_GRAPHICAL_ENABLED=1` as an explicit remote graphical runtime
opt-in. The status surface reports three separate posture fields:

- `requested`: operator requested remote graphical runtime availability
- `enabled`: Soma has an enabled runtime path for the broker
- `configured`: a provider broker is configured

The current runtime intentionally sets only `requested=true` when the environment variable is
present. `enabled` and `configured` remain false because no Sunshine/Moonlight broker is configured
and no live transport is available.

## Boundary

This change does not enable broker session opening, Sunshine/Moonlight calls, pairing, credential
storage, video observation, screenshot capture, input dispatch, recording, durable grant writes, or
model-facing visual payload delivery.

`POST /remote-graphical/sessions` remains a default-off refusal path. The runtime opt-in is visible
for operator inspection only.

## Residual Risk

The next slice should add a provider-neutral configured broker fixture and stable refusal-code
branching. That work should still avoid live transport and should keep the default no-op broker as
the startup posture.

## Verification

- `node --test test/remoteGraphicalRuntime.test.js`
- `node --test test/remoteGraphicalBroker.test.js`
- `node --test test/app.test.js`
- `node --test test/cli.test.js`
- `npm test`
- `git diff --check`

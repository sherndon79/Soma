# Grant Preview Review Live Smoke

Review after running the guarded grant preview/review smoke against a local Soma service.

## Scope

- `npm run grant-preview:smoke -- --dry-run`
- `npm start`
- `SOMA_GRANT_PREVIEW_REVIEW_SMOKE=1 npm run grant-preview:smoke -- --url http://127.0.0.1:8765`
- `ROADMAP.md`

## Result

The dry-run plan printed the expected non-mutating command sequence without contacting the service.

A local Soma service was started with `npm start` and reported:

```text
Soma MVP service listening on http://127.0.0.1:8765
```

The guarded live smoke then passed against `http://127.0.0.1:8765`.

```text
Grant preview/review smoke passed.
```

## Boundary

The run exercised only status, grant list, grant recovery, dry-run preview creation, accepted
preview review formatting, refused preview review validation, and final grant-list comparison. It
did not enable runtime writes, invoke durable grant commit routes, activate capabilities, start
subscriptions, call desktop or Sensorium helpers, or deliver model-facing payloads.

## Residual Risk

This verifies the current local service path, not a concurrent multi-operator grant store. The smoke
intentionally fails if grants change during the run, so a shared service should be quiesced or run
against an isolated grant store before using this as a release check.

Verification: `npm run grant-preview:smoke -- --dry-run` and guarded live smoke both pass.

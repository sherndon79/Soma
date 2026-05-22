# Grant Mutation Preview Route Failures

Review after hardening route-level failure coverage for grant mutation previews.

## Scope

- `src/app.js`
- `test/app.test.js`
- `docs/operators.md`
- `docs/architecture/mvp_slice.md`
- `ROADMAP.md`

## Summary

`POST /grants/mutation-previews` now has route-level tests for unsupported mutation kinds and
malformed create inputs. These failures return bounded preview refusal payloads with
`dry_run: true`, `durable: false`, `grant_written: false`, `provenance_appended: false`, and
`activation_performed: false`.

The degraded-recovery refusal also reports the same non-writing and non-activation flags before
returning bounded recovery findings.

## Boundary

This slice does not add writable `POST /grants` behavior, CLI mutation commands, runtime write
enablement, recovery repair, durable provenance append, activation, subscriptions, or model-facing
payload delivery.

## Residual Risk

The preview route remains a dry-run route over the request-handler grant state. The future durable
mutation route must still reread and validate under the durable writer boundary before committing
anything.

Verification: `node --test test/app.test.js` passes.

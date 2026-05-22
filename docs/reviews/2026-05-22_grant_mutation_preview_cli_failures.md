# Grant Mutation Preview CLI Failures

Review after adding CLI coverage for dry-run grant mutation preview refusals.

## Scope

- `src/cli.js`
- `src/grantMutationPreviewReviewSurface.js`
- `test/cli.test.js`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

The CLI now treats non-2xx `/grants/mutation-previews` responses as renderable preview refusals
when the payload proves the dry-run, non-writing, non-activation boundary:

- `ok: false`
- `dry_run: true`
- `grant_written: false`
- `provenance_appended: false`
- `activation_performed: false`

Human output renders those refusals through the grant mutation preview review surface. `--json`
continues to preserve raw refusal payloads for operator inspection. Non-preview HTTP failures still
throw normally.

## Boundary

This slice does not add writable grant mutation commands, active route aliases, durable grant-store
writes, provenance append, runtime write enablement, activation, subscriptions, or model delivery.

## Residual Risk

The CLI still depends on the route to provide bounded refusal payloads. Future durable mutation CLI
commands must not inherit this dry-run exception automatically; they should have their own stricter
error handling once writable routes exist.

Verification: `node --test test/cli.test.js test/grantMutationPreviewReviewSurface.test.js` passes.

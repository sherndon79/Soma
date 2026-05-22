# Durable Mutation CLI Denial Stubs

Review after adding local CLI denials for reserved durable grant mutation commands.

## Scope

- `src/cli.js`
- `test/cli.test.js`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

Reserved CLI mutation commands now fail locally before any HTTP request is sent:

- `soma grants create`
- `soma grants revoke`
- `soma grants supersede`

The error code is `durable_grant_mutation_cli_not_enabled`. The message points operators to the
dry-run preview commands and the durable grant mutation activation policy.

## Boundary

This slice does not add durable grant mutation CLI commands, HTTP commit invocation, filesystem
writes, runtime write activation, recovery repair, provenance append, capability activation,
subscriptions, provider/helper invocation, or model delivery.

## Residual Risk

Future CLI mutation implementation must replace these local stubs only after durable HTTP commit
routes are enabled and tested. The CLI should remain an HTTP wrapper, not a second filesystem
mutation path.

Verification: `node --test test/cli.test.js` passes.

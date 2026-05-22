# Grant Mutation Preview Review CLI

Review after adding a CLI wrapper for grant mutation preview review formatting.

## Scope

- `src/cli.js`
- `test/cli.test.js`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

`soma grants review-preview` now calls `POST /grants/mutation-preview-review-text` to format an
existing grant mutation preview response. Operators can supply the preview through:

- `--preview-json json`
- `--stdin`

The CLI validates that the supplied JSON is valid and decodes to an object before any request is
sent. Human output prints the returned review text; `--json` preserves the route response.

## Boundary

This command is formatting-only. It does not call `/grants/mutation-previews`, create previews,
invoke durable grant mutation routes, write `config/grants.json`, append provenance, activate
capabilities, repair recovery findings, start or stop subscriptions, invoke providers/helpers, or
deliver model context.

## Residual Risk

Future CLI mutation commands should keep preview creation, review formatting, and durable commits as
separate commands. If file input is added later, it should remain a read-only local convenience and
should not introduce implicit preview generation or mutation.

Verification: `node --test test/cli.test.js` passes.

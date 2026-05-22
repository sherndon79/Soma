# Grant Recovery CLI

Review after adding a read-only CLI wrapper for grant recovery inspection.

## Scope

- `src/cli.js`
- `test/cli.test.js`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

`soma grants recovery` now calls `GET /grants/recovery` and prints a compact operator summary.
`--json` returns the route payload unchanged.

The human summary includes:

- inspection availability
- clean/degraded state
- grant and finding counts
- runtime write and activation flags
- bounded finding details such as grant id, capability, provider, scope, event type, field name, or
  provenance read failure class

The CLI does not print mismatch values or grant reason text in the human summary.

## Boundary

This is a read-only wrapper. It does not create, approve, revoke, repair, migrate, activate, or
write grants. It also does not read provenance directly; the HTTP route remains the authority
surface.

## Residual Risk

Future durable mutation commands should not reuse `grants recovery` output as proof of authority by
itself. Authorization still belongs in the policy gateway, using the recovery report supplied at
runtime.

Verification: `node --test test/cli.test.js` passes.

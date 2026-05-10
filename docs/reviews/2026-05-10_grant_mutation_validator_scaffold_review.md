# Grant Mutation Validator Scaffold Review

Date: 2026-05-10

Scope:

- `src/grants.js`
- `test/grants.test.js`
- read-only `GET /grants` boundary

## Finding

The grant mutation scaffold adds executable authority semantics without exposing writable grant
routes, CLI commands, or file writes. That matches the planned slice.

The implementation is deliberately pure:

- create validation checks catalog capability keys
- create validation checks provider support
- create validation requires an explicit user actor and approval provenance or direct user action
- malformed constraints fail before any grant record is produced
- revocation is idempotent for terminal grants
- supersession links an existing replacement grant
- expiration marks authority inactive without activation

## Boundary Check

No public mutation path was added. `GET /grants` still reports the file-backed store as
non-writable and non-activating.

The scaffold also leaves desktop traversal authority unchanged. It does not add desktop fields,
does not widen disclosure, and does not call the Rust helper.

## Actionable Follow-Up

The next safe implementation slice should add provenance event constructors for grant mutations,
still without writable routes or file writes.

Recommended tests:

- `grant.created` event contains grant id, capability, provider, scope, actor, reason, timestamp,
  and approval provenance id
- `grant.revoked` event contains revocation metadata and does not store capability payloads
- `grant.superseded` event links source and replacement grants
- `grant.expired` event records system expiration without implying user revocation
- event construction does not activate capabilities

After event construction is covered, Soma can design atomic persistence and recovery behavior.

## Residual Risk

The scaffold validates that constraints are objects and scopes are catalog-allowed, but it does not
yet validate capability-specific constraint schemas. That is acceptable before writes are exposed,
but it must be addressed before grant creation can become a runtime route.

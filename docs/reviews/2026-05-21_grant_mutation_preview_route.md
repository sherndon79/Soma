# Grant Mutation Preview Route

Review after adding a dry-run preview surface for future durable grant mutations.

## Scope

- `src/grantMutationPreview.js`
- `src/app.js`
- `test/grantMutationPreview.test.js`
- `test/app.test.js`
- `docs/operators.md`
- `docs/architecture/mvp_slice.md`
- `ROADMAP.md`

## Summary

`previewGrantMutation` now validates create/revoke mutations and returns a metadata-only event
preview, receipt preview, and next-store summary without calling the durable writer. The HTTP route
`POST /grants/mutation-previews` exposes that helper under an explicitly non-mutating path.

Route behavior:

- supports `grant.created` and `grant.revoked` previews only
- refuses degraded grant recovery before previewing authority changes
- returns `dry_run: true`
- returns `durable: false`, `grant_written: false`, `provenance_appended: false`, and
  `activation_performed: false`
- does not use the reserved active `POST /grants` route name

## Boundary

This is review-only. It does not write `config/grants.json`, append grant mutation provenance,
enable CLI mutation, repair degraded recovery, activate capabilities, start Sensorium
subscriptions, or deliver model-facing visual payloads.

## Residual Risk

The preview currently uses request-handler in-memory grant state. That is acceptable for the
non-mutating surface, but the eventual durable route must reread the grant store under lock and
revalidate before writing, regardless of any prior preview result.

Verification: `node --test test/app.test.js test/grantMutationPreview.test.js` passes.

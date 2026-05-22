# Unsupported Grant Schema Route Codes

Review after making unsupported grant-store schema denials explicit at grant-dependent runtime
authorization routes.

## Scope

- `src/app.js`
- `test/app.test.js`

## Summary

Grant-dependent runtime paths now fail closed with route-specific unsupported-schema errors when the
grant store declares a newer schema version than the current policy gateway supports.

Current explicit route behavior:

- model visual attach dry-run returns `model_visual_attach_grant_store_schema_unsupported`
- Sensorium subscription start returns `sensorium_subscription_grant_store_schema_unsupported`
- downstream invocation does not occur after unsupported-schema denial
- generic no-grant errors remain reserved for supported stores with no matching active grant

## Boundary

This is an error-surface clarification only. It does not add durable grant loading, public grant
mutation routes, CLI mutation commands, runtime writes, visual payload delivery, Sensorium delivery
expansion, or schema migration support.

## Residual Risk

Other future grant-dependent routes should use the same distinction: unsupported authority schema is
not equivalent to absent authority. Operators need the specific schema denial so they can migrate or
inspect the grant store instead of chasing missing-grant state.

Verification: `node --test test/app.test.js` and `npm test` pass.

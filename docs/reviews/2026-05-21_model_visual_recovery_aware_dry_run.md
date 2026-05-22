# Model Visual Recovery-Aware Dry Run

Review after adding recovery-aware grant gating to the model visual attach dry-run path.

## Scope

- `src/grantAuthorization.js`
- `src/app.js`
- `test/grantAuthorization.test.js`
- `test/app.test.js`
- `ROADMAP.md`

## Summary

`authorizeGrantUse` now accepts an optional `grantId` filter so callers with exact grant references
can avoid authorizing a different active grant with the same capability and scope. The model visual
attach dry-run route uses that exact grant-id gate before creating a future provenance preview.

New route behavior:

- matching degraded visual grant returns `model_visual_attach_grant_recovery_required`
- unsupported grant-store schema returns `model_visual_attach_grant_store_schema_unsupported`
- degraded grants are rejected before future provenance preview creation
- ordinary malformed request and missing-grant cases remain handled by the existing visual request
  validator

## Boundary

This remains a dry-run only path. It does not append provenance, deliver visual payloads, call a
model with visual context, write memory, mutate grants, or enable durable grant writes. Payload bytes
remain forbidden by the existing validator.

## Residual Risk

Absence of a recovery report remains compatible with the current in-memory test/session grant path.
Before durable visual attach grants authorize runtime behavior, durable grant loading should provide
a fresh recovery report and fail closed when inspection is unavailable.

Verification: `node --test test/grantAuthorization.test.js test/app.test.js test/modelVisualAttachRequest.test.js` passes.

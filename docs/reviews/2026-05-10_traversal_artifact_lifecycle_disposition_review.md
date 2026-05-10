# Traversal Artifact Lifecycle Disposition Review - 2026-05-10

**Date:** 2026-05-10
**Scope:** Per-artifact disposition for Future-prefixed traversal artifacts after endpoint activation
**Reviewer:** Codex
**Commit baseline:** `9a1ae51`

Related reviews:

- `docs/reviews/2026-05-10_traversal_endpoint_activation_review.md`
- `docs/reviews/2026-05-09_traversal_activation_thread_review.md`
- `docs/reviews/2026-05-09_traversal_activation_progress_review.md`

---

## Sources Reviewed

- `src/desktopTraversalRequest.js`
- `src/desktopTraversalOutput.js`
- `src/desktopTraversalProvenance.js`
- `src/desktopBroker.js`
- `src/desktopInspectionSchema.js`
- `docs/fixtures/desktop-traversal-endpoint-activation-cases.json`
- `docs/fixtures/future-traversal-output-validation-cases.json`
- `docs/fixtures/future-traversal-output-schema.json`
- `docs/fixtures/future-traversal-provenance-summary.json`
- `docs/schemas/future-desktop-inspection-result-with-traversal.schema.json`
- traversal-related tests

---

## Overall Assessment

The active traversal runtime no longer needs Future-prefixed names for its load-bearing APIs.

This slice adds stable active names and preserves Future-prefixed exports as compatibility delegates
where callers may still rely on them. Historical Future-prefixed schemas and fixtures remain in
place where they document migration context or continue to prove that the default desktop inspection
schema remains traversal-closed.

No category-level sweep was performed.

---

## Per-Artifact Disposition

### Active APIs Renamed With Compatibility Delegates

- `validateDesktopTraversalRequest` is the active request validator.
  `validateFutureDesktopTraversalRequest` remains as a compatibility delegate.
- `validateDesktopTraversalOutput` is the active traversal output validator.
  `validateFutureDesktopTraversalOutput` remains as a compatibility delegate.
- `assertDesktopTraversalHelperOutput` is the active helper-output assertion.
  `assertFutureDesktopTraversalHelperOutput` remains as a compatibility delegate.
- `createTraversalProvenanceSummary` is the active summary builder.
  `createFutureTraversalProvenanceSummary` remains as a compatibility delegate.
- `createValidatedTraversalProvenanceSummary` is the active validated summary builder.
  `createValidatedFutureTraversalProvenanceSummary` remains as a compatibility delegate.

Compatibility delegate tests were added so future cleanup cannot silently break older imports.

### Active Fixture Metadata Renamed

`docs/fixtures/desktop-traversal-endpoint-activation-cases.json` is now an active endpoint fixture.
Its assertion metadata was renamed from `future_expected_*` and `future_helper_output` to
`expected_*` and `helper_output`. Case names no longer carry the `future_` prefix.

### Historical Artifacts Preserved

These remain Future-prefixed intentionally:

- `docs/schemas/future-desktop-inspection-result-with-traversal.schema.json`
- `docs/fixtures/future-traversal-output-validation-cases.json`
- `docs/fixtures/future-traversal-output-schema.json`
- `docs/fixtures/future-traversal-provenance-summary.json`
- `docs/fixtures/future-desktop-ref-id-locations.json`
- `validateFutureDesktopInspectionResultWithTraversal`

The first four preserve migration context and continue supporting tests that prove the default
schema/runtime validator stays traversal-closed. `future-desktop-ref-id-locations.json` belongs to
root-ref exposure work that is not fully promoted. `validateFutureDesktopInspectionResultWithTraversal`
is already a thin compatibility delegate to `validateTraversalAuthorizedDesktopInspectionResult`.

---

## Disposition

Accept the lifecycle disposition.

Do not remove compatibility delegates until a broader draft-lifecycle policy exists and callers are
proven not to rely on the old names.

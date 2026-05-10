# Extended Traversal Endpoint Fixture Review - 2026-05-09

**Date:** 2026-05-09
**Scope:** Review of extended Node traversal endpoint activation fixture before endpoint enablement
**Reviewer:** Codex
**Commit range:** `6d61e28..80c3c0f`

Related reviews:

- `docs/reviews/2026-05-09_traversal_endpoint_activation_scaffold_review.md`
- `docs/reviews/2026-05-09_rust_traversal_helper_command_activation_review.md`
- `docs/reviews/2026-05-09_traversal_request_enablement_readiness_review.md`

---

## Sources Reviewed

- `ROADMAP.md`
- `docs/fixtures/desktop-traversal-endpoint-activation-cases.json`
- `docs/concepts/drafts/desktop_traversal_endpoint_enablement_readiness.md`
- `test/app.test.js`

---

## Overall Assessment

Accept the extended endpoint activation fixture.

The fixture now represents the full set of endpoint activation families named by the readiness
checklist:

- success
- unavailable
- authorization failures
- request validation failure
- helper-output validation failure
- narrowing/revoked-root failure

The public endpoint still hard-refuses every case with `desktop_traversal_not_implemented`, and the
shared app test still proves no authorization, registry writes, or traversal provenance happen while
the refusal is active.

---

## What Holds Up

### Helper-output failure is represented

`future_helper_output_rejected_before_provenance` includes invalid helper output with a protected
`name` field in a traversal node. That is the right failure shape for the future active endpoint test:
the helper output must be rejected before response attachment and before provenance append.

### Narrowing/revocation is represented

`future_module_narrowed_root_revoked` gives the endpoint activation suite a named revoked-root path
for module narrowing. The future active assertion should prove the helper is not invoked and no
traversal provenance is appended after a disclosed root has been revoked.

### Hard-refusal posture remains intact

The app-level fixture test still treats every activation case as refused today:

- status `403`
- error `desktop_traversal_not_implemented`
- no `authorizeRootRef` calls
- no disclosure registry writes
- no focused-inspection registry writes
- no traversal provenance entries

---

## Remaining Endpoint Activation Gaps

The remaining gap is no longer fixture coverage. It is active endpoint behavior.

Before or during endpoint enablement, convert fixture entries into active assertions for:

- success response shape and summary-only provenance
- unavailable response shape and summary-only provenance
- each authorization failure code before helper invocation
- helper-output validation failure before response/provenance
- narrowing/revoked-root failure before helper invocation/provenance
- default validator remaining closed outside the traversal-authorized response path

The activation commit should replace the hard-refusal assertion for these cases with path-specific
assertions in the same slice that replaces `rejectUnsupportedDesktopTraversal`.

---

## Disposition

Do not replace `desktop_traversal_not_implemented` in this slice.

Proceed to a final endpoint enablement review. That review should verify whether the endpoint
activation commit can safely combine:

- replacing the hard refusal with traversal request validation and `runInternalDesktopTraversalRequest`
- converting fixture cases into active endpoint assertions
- preserving default validator closure
- preserving summary-only provenance

---

## Next Review Trigger

Run a final review immediately before endpoint enablement, or after an implementation attempt that
replaces `desktop_traversal_not_implemented`.

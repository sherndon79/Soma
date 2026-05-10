# Traversal Endpoint Activation Review - 2026-05-10

**Date:** 2026-05-10
**Scope:** Review of public Node traversal endpoint activation
**Reviewer:** Codex
**Commit reviewed:** `9032652` (`Activate traversal endpoint`)

Related reviews:

- `docs/reviews/2026-05-09_final_traversal_endpoint_enablement_review.md`
- `docs/reviews/2026-05-09_extended_traversal_endpoint_fixture_review.md`
- `docs/reviews/2026-05-09_traversal_activation_thread_review.md`

---

## Sources Reviewed

- `src/app.js`
- `src/desktopTraversalPipeline.js`
- `src/desktopTraversalRequest.js`
- `test/app.test.js`
- `test/desktopTraversalRequest.test.js`
- `docs/fixtures/desktop-traversal-endpoint-activation-cases.json`
- `docs/concepts/drafts/desktop_traversal_endpoint_enablement_readiness.md`
- `docs/concepts/drafts/desktop_traversal_enablement_sequence.md`
- `ROADMAP.md`

---

## Overall Assessment

Accept the endpoint activation.

The activation replaced the public hard refusal with the intended traversal path while preserving the
load-bearing gates:

- traversal-shaped requests validate top-level and traversal fields before helper invocation
- root refs resolve through `DesktopDisclosureRegistry.authorizeRootRef` before helper invocation
- raw service/path roots remain rejected
- authorized traversal output attaches only through the traversal-authorized response schema
- helper-output validation failure returns before response attachment and before provenance append
- success and unavailable traversal append summary-only provenance
- denied or invalid traversal requests append no traversal provenance
- the default desktop inspection validator remains closed to traversal-bearing output
- the Rust malformed-args no-stdout behavior remains covered

---

## Activation Shape

The final route shape is slightly stricter than the pre-activation review proposed.

The pre-activation review described performing the base AT-SPI inspection first, then passing the
request into `runInternalDesktopTraversalRequest`. The implementation validates and authorizes the
traversal request first, then performs the base AT-SPI inspection only for authorized traversal
requests. This is the better gate ordering: invalid or unauthorized roots do not invoke either the
base inspection helper or the traversal helper.

To avoid double authorization, `runInternalDesktopTraversalRequest` now accepts an optional
`traversalRequest` that has already been validated by the route. Existing internal tests still cover
the pipeline's standalone validation behavior when no prevalidated request is supplied.

---

## Coverage Confirmed

`test/app.test.js` converts the endpoint activation fixture from hard-refusal assertions to active
endpoint assertions for:

- success
- unavailable
- root not disclosed
- expired root
- revoked root
- capability-inactive root
- raw root request validation failure
- helper-output validation failure before provenance
- module narrowing/revocation failure

The fixture-driven test also asserts helper command ordering:

- success/unavailable paths call `inspect-atspi`, then `inspect-atspi-traversal`
- helper-output failure calls both helpers, then fails before provenance
- request-validation and authorization failures call no desktop helper

This is stronger than the minimum gate because denied traversal requests now prove no helper command
is invoked at all.

---

## Residual Notes

The activation fixture names still carry `future_` prefixes even though the endpoint is now active.
That is acceptable for this slice because the naming-policy decision was explicitly deferred. Treat
renaming or retaining these names as part of the Future-prefix disposition or draft-lifecycle policy,
not as activation fallout.

The route currently performs a full base AT-SPI inspection before invoking traversal for authorized
requests. That preserves the attachment invariant: traversal output must match an object already in
the base inspection result. If future performance work tries to skip the base inspection, it needs a
separate design review because it would change the disclosure and attachment model.

---

## Disposition

No activation rollback or immediate code cleanup is required.

Proceed to the deferred Future-prefix/draft-lifecycle disposition work, or to the next capability
slice, after one more normal verification run.

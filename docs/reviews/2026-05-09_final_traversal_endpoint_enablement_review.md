# Final Traversal Endpoint Enablement Review - 2026-05-09

**Date:** 2026-05-09
**Scope:** Final review before replacing the public Node traversal hard refusal
**Reviewer:** Codex
**Commit range:** `80c3c0f..fdce8fa`

Related reviews:

- `docs/reviews/2026-05-09_traversal_endpoint_activation_scaffold_review.md`
- `docs/reviews/2026-05-09_extended_traversal_endpoint_fixture_review.md`
- `docs/reviews/2026-05-09_rust_traversal_helper_command_activation_review.md`

---

## Sources Reviewed

- `ROADMAP.md`
- `src/app.js`
- `src/desktopBroker.js`
- `src/desktopDisclosureRegistry.js`
- `src/desktopTraversalPipeline.js`
- `src/desktopTraversalRequest.js`
- `test/app.test.js`
- `test/desktopTraversalPipeline.test.js`
- `docs/fixtures/desktop-traversal-endpoint-activation-cases.json`

---

## Overall Assessment

The public Node endpoint is ready for a guarded activation attempt.

The remaining work is not more scaffolding. The pieces needed by the endpoint are present:

- traversal request validation rejects raw roots, non-AT-SPI mode, unknown traversal fields, and
  excessive limits
- disclosure-registry authorization maps root refs to stable success or denial results
- the Rust helper command is active behind `inspectDesktopTraversalWithRustHelper`
- helper output is validated before attachment and before provenance
- traversal attachment uses the traversal-authorized inspection schema instead of the default schema
- provenance records summary fields only and does not copy traversal tree details
- endpoint activation fixture covers success, unavailable, authorization failures, request
  validation failure, helper-output failure, and module narrowing/revocation

Keep `desktop_traversal_not_implemented` until the activation tests are converted in the same slice
that wires the endpoint to `runInternalDesktopTraversalRequest`.

---

## Activation Shape

The endpoint activation should be a single narrow slice:

1. Read and validate the existing AT-SPI inspection request enough to perform the base inspection.
2. If `body.traversal` is absent, preserve the current non-traversal endpoint path unchanged.
3. If `body.traversal` is present, perform the base AT-SPI inspection first, then pass the original
   body, inspection, disclosure registry, provenance log, and caller into
   `runInternalDesktopTraversalRequest`.
4. Return the traversal-authorized inspection and traversal provenance id from the internal pipeline.
5. Convert `docs/fixtures/desktop-traversal-endpoint-activation-cases.json` from hard-refusal
   assertions into active path assertions.

This keeps activation centered in the already-tested pipeline instead of spreading traversal policy
through the route handler.

---

## Must-Preserve Gates

The activation slice must continue to prove:

- malformed Rust traversal command args emit no stdout and do not query the helper boundary
- `validateDesktopInspectionResult` remains closed to traversal by default
- non-traversal endpoint responses still use the current default schema
- traversal responses pass only through the traversal-authorized schema
- unauthorized, expired, revoked, inactive, or raw roots fail before traversal helper invocation
- helper-output validation failures fail before response attachment and before provenance append
- module narrowing revokes disclosed roots and prevents later traversal
- traversal provenance stores summary counts, limits, root source metadata, and truncation only
- no text, names, descriptions, states, actions, screenshots, or actuation are introduced

---

## Test Conversion Checklist

Convert the fixture cases into endpoint assertions for:

- `future_success_authorized_root`: status `200`, traversal attached to the authorized root,
  summary-only traversal provenance appended, disclosure registry not expanded from traversal output
- `future_unavailable_authorized_root`: status `200`, unavailable traversal attached, zero-node
  summary-only provenance appended
- `future_root_not_disclosed`: stable `desktop_traversal_root_not_disclosed`, no traversal helper,
  no traversal provenance
- `future_root_expired`: stable `desktop_traversal_root_expired`, no traversal helper, no traversal
  provenance
- `future_root_revoked`: stable `desktop_traversal_root_revoked`, no traversal helper, no traversal
  provenance
- `future_root_capability_inactive`: stable `desktop_traversal_root_capability_inactive`, no
  traversal helper, no traversal provenance
- `future_raw_root_rejected`: stable `desktop_traversal_request_invalid`, no authorization, no
  traversal helper, no traversal provenance
- `future_helper_output_rejected_before_provenance`: stable
  `desktop_traversal_helper_output_invalid`, no traversal response body, no traversal provenance
- `future_module_narrowed_root_revoked`: stable `desktop_traversal_root_revoked`, no traversal
  helper, no traversal provenance after narrowing

---

## Non-Blockers

The endpoint currently lacks a traversal-specific route-handler injection point. That is not a
blocker because endpoint tests can use the existing fake helper path and dispatch on helper command
arguments. If the activation tests become too cumbersome, add a small dependency injection seam to
`createRequestHandler`, but keep it test-only in effect and avoid changing runtime behavior.

The `Future` naming remains acceptable for schemas, fixtures, and compatibility delegates until the
draft-lifecycle policy is settled. Do not perform a naming sweep as part of endpoint activation.

---

## Disposition

Proceed with the endpoint activation implementation.

The activation commit should replace `rejectUnsupportedDesktopTraversal` only when the endpoint
fixture assertions are converted to the active behavior in the same commit. If the implementation
cannot preserve the gates above, restore the hard refusal and document the failed activation gap.

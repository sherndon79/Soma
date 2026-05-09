# Traversal Request Enablement Readiness Review — 2026-05-09

**Date:** 2026-05-09
**Scope:** Review of traversal request/root authorization/helper/provenance gates before replacing
`desktop_traversal_not_implemented`
**Reviewer:** Codex
**Commit range:** `12c232a..fb5ee86`

Related reviews:

- `docs/reviews/2026-05-09_traversal_activation_gates_review.md`
- `docs/reviews/2026-05-09_traversal_activation_progress_review.md`

---

## Sources Reviewed

- `ROADMAP.md`
- `docs/concepts/drafts/desktop_traversal_enablement_sequence.md`
- `docs/concepts/drafts/desktop_traversal_request_validation.md`
- `docs/concepts/drafts/traversal_root_authorization.md`
- `docs/concepts/drafts/desktop_traversal_provenance.md`
- `src/app.js`
- `src/desktopBroker.js`
- `src/desktopDisclosureRegistry.js`
- `src/desktopInspectionSchema.js`
- `src/desktopTraversalRequest.js`
- `src/desktopTraversalProvenance.js`
- `test/app.test.js`
- `test/desktopBroker.test.js`
- `test/desktopDisclosureRegistry.test.js`
- `test/desktopTraversalRequest.test.js`
- `test/desktopTraversalProvenance.test.js`
- traversal-related Rust tests

---

## Overall Assessment

Do not replace `desktop_traversal_not_implemented` yet.

The individual gates are in good condition: request validation is root-ref-only, disclosure registry
authorization has stable denial modes, helper args derive concrete service/path from authorized roots,
helper output validation is available, traversal-authorized runtime validation is named, provenance
summary builders are bounded, and public traversal-shaped requests still fail before helper invocation,
registry authorization, disclosure registry writes, or provenance append.

The remaining gap is integration. There is no single internal Node path that composes:

1. `validateFutureDesktopTraversalRequest`
2. disclosure registry root authorization
3. `inspectDesktopTraversalWithRustHelper`
4. `attachTraversalToDesktopInspectionResult`
5. validated traversal provenance summary creation
6. provenance append after successful validation

Until that orchestration seam exists and is tested behind the still-disabled endpoint, replacing the
hard refusal would make the activation step too large.

---

## What Holds Up

### Public endpoint still fails closed

`src/app.js` still rejects any `traversal` request before normal request validation, helper invocation,
root authorization, disclosure writes, or provenance. The latest app tests also verify no helper marker,
no `authorizeRootRef` calls, no disclosure writes, and no provenance entries for traversal-shaped
requests.

### Root authorization shape is correct

`src/desktopTraversalRequest.js` accepts `root_ref`, rejects raw service/path roots, validates bounded
limits, and maps disclosure registry failures to stable traversal root errors. The disclosure registry
tests cover not-disclosed, expired, revoked, and inactive-capability refs.

### Helper invocation boundary is narrow

`desktopTraversalHelperArgs` receives an authorized concrete root plus numeric limits. It does not pass
raw `root_ref` to Rust. Helper output is validated before the internal helper path returns traversal
data.

### Output validation remains split from default validation

Traversal-bearing inspection output flows through
`assertTraversalAuthorizedDesktopInspectionResult`. The default `assertDesktopInspectionResult` still
rejects traversal-shaped output.

### Provenance summary discipline is present

The future provenance summary builder stores counts, limits, root-source metadata, truncation, and
unavailable reason. It does not copy traversal node ids, service/path lists, roles, child edges, or
protected fields.

---

## Identified Gaps

### No integrated traversal request pipeline yet

The current pieces are tested independently, but activation needs one internal function or adapter that
proves the complete successful path in the correct order before the public endpoint changes behavior.

Recommended next slice:

- add an internal Node traversal request pipeline function or adapter
- keep `rejectUnsupportedDesktopTraversal` in the public endpoint
- test the successful root-ref path through fake helper output and fake prior disclosure
- test that authorization failure and helper-output validation failure append no provenance
- test that provenance summary append happens only after traversal output validation succeeds

### Public Rust command remains disabled

This is currently correct, but it means a public endpoint activation cannot be treated as a small change.
Before the endpoint calls traversal in runtime, the public `inspect-atspi-traversal` command must stop
returning not implemented and keep the protected-field omission guarantees at query and output
boundaries.

No change recommended in this review slice.

### Provenance append is not yet wired

The summary builder and validated adapter are present, but active endpoint provenance does not yet append
traversal summary fields. This should be introduced only in the internal pipeline test path first.

Do not add traversal fields to current shallow inspection provenance.

---

## Activation Disposition

The request enablement gate is not ready for public activation, but it is ready for an internal
composition slice.

The next safe step is to create the integrated Node orchestration seam under test while preserving all
current refusal behavior. After that seam exists, run another short review before activating the Rust
command or replacing the endpoint refusal.

---

## Next Review Trigger

Run another review after the internal traversal request pipeline exists and passes tests, or immediately
before either of these behavior changes:

- public `inspect-atspi-traversal` stops returning not implemented
- `/desktop/inspect/accessibility-tree` replaces `desktop_traversal_not_implemented`

# Traversal Pipeline Activation Readiness Review — 2026-05-09

**Date:** 2026-05-09
**Scope:** Review of the internal traversal pipeline before activating the public Rust traversal
command or endpoint traversal behavior
**Reviewer:** Codex
**Commit range:** `a6c35ab..15c9dbe`

Related reviews:

- `docs/reviews/2026-05-09_traversal_activation_gates_review.md`
- `docs/reviews/2026-05-09_traversal_activation_progress_review.md`
- `docs/reviews/2026-05-09_traversal_request_enablement_readiness_review.md`

---

## Sources Reviewed

- `ROADMAP.md`
- `docs/concepts/drafts/desktop_traversal_enablement_sequence.md`
- `docs/concepts/drafts/desktop_traversal_helper_contract.md`
- `docs/concepts/drafts/desktop_traversal_rust_implementation_plan.md`
- `src/desktopTraversalPipeline.js`
- `src/desktopTraversalOutput.js`
- `src/desktopTraversalProvenance.js`
- `src/desktopBroker.js`
- `crates/soma-desktop-broker/src/main.rs`
- `crates/soma-desktop-broker/tests/traversal_command.rs`
- `test/desktopTraversalPipeline.test.js`
- traversal-related Node and Rust tests

---

## Overall Assessment

Do not activate the public Rust traversal command yet.

The internal Node traversal pipeline is the right shape and should remain. It composes root-ref request
validation, disclosure-registry authorization, helper invocation, traversal attachment, traversal-aware
runtime validation, and summary-only provenance. Its tests prove the successful path and the two main
rejection paths: unauthorized root before helper/provenance, and helper-output validation failure before
provenance.

The blocker is the unavailable-output contract. `inspect-atspi-traversal` can only safely become public
when every post-argument failure either:

- returns schema-valid traversal JSON that Node can validate and summarize, or
- fails in a way Node intentionally treats as unavailable without trying to attach invalid traversal.

Today, `src/desktopTraversalOutput.js` accepts only a successful traversal object with `root`, `nodes`,
`limits`, `truncated`, `text_content_included=false`, and `withheld_fields`. It does not accept a stable
unavailable traversal object. Meanwhile, the Rust implementation plan says environment failures should
prefer a valid unavailable result once the active schema can represent one. That representation does
not exist yet.

---

## What Holds Up

### Internal pipeline ordering is correct

`runInternalDesktopTraversalRequest` validates and authorizes `root_ref` before helper invocation,
passes only concrete authorized service/path plus bounded limits to the helper, attaches traversal only
after helper output validation, and appends provenance only after successful attachment and validated
summary creation.

### Endpoint refusal remains intact

The public `/desktop/inspect/accessibility-tree` path still calls `rejectUnsupportedDesktopTraversal`
before shallow request validation or helper invocation. The internal pipeline is not reachable from the
endpoint.

### Public Rust command remains disabled

`inspect-atspi-traversal` still parses valid-looking args, returns exit code `2`, writes no stdout, and
prints `inspect-atspi-traversal is not implemented`. That is still the correct behavior until the
unavailable-output gap is resolved.

### Rust bounded traversal internals are mature enough for the next preparatory slice

The Rust helper already has parser tests, output-builder tests, protected-field omission tests,
breadth-first traversal tests, limit/truncation tests, child-id consistency tests, and query-boundary
tests. The next blocker is not traversal algorithm coverage; it is command-level failure semantics and
Node schema acceptance for unavailable traversal.

---

## Identified Gaps

### Traversal unavailable output is not represented in the Node validator

The future provenance summary builder can store `traversal_unavailable_reason`, but the traversal output
validator rejects any `unavailable_reason` field and does not define a valid zero-node unavailable shape.

Recommended next slice:

- define a stable unavailable traversal output shape
- update traversal output validator tests for the unavailable shape
- update traversal-specific schema artifacts to match
- ensure provenance summary accepts the unavailable shape without storing service/path/node details
- keep the default desktop inspection validator traversal-closed
- keep the endpoint refusal and public Rust command disabled during this slice

### Public command activation needs command-level success and unavailable tests

Before changing `inspect-atspi-traversal` from disabled to active, add command integration tests for:

- successful traversal command emits JSON accepted by the Node traversal-output validator, using a
  testable fake or controlled query path
- AT-SPI bus unavailable emits the agreed unavailable shape or otherwise has an explicitly documented
  non-JSON failure mode that Node handles
- malformed args still fail before AT-SPI queries and emit no JSON
- protected fields remain omitted in command stdout

Do not activate the command in the same slice as defining the unavailable shape.

### Internal pipeline should learn the unavailable branch after the shape exists

Once unavailable traversal output is valid, `runInternalDesktopTraversalRequest` should have explicit
tests proving it can create summary-only unavailable provenance without trying to attach traversal nodes
to an inspection root.

---

## Activation Disposition

The internal Node pipeline is accepted as the correct composition seam, but public Rust command
activation should wait.

The next safe slice is traversal unavailable-output contract work in Node schemas, validator, provenance
tests, and docs. After that, run a narrower review focused on whether `inspect-atspi-traversal` can stop
returning not implemented while the endpoint remains refused.

---

## Next Review Trigger

Run another review after the unavailable traversal output contract exists and passes tests, or
immediately before changing either of these behaviors:

- public `inspect-atspi-traversal` stops returning not implemented
- `/desktop/inspect/accessibility-tree` replaces `desktop_traversal_not_implemented`

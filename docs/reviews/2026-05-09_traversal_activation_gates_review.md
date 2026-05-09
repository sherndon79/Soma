# Traversal Activation Gates Review — 2026-05-09

**Date:** 2026-05-09
**Scope:** Review of bounded AT-SPI traversal scaffolds before replacing
`desktop_traversal_not_implemented`
**Reviewer:** Codex

---

## Sources Reviewed

- `ROADMAP.md`
- `docs/concepts/drafts/desktop_traversal_enablement_sequence.md`
- `docs/concepts/drafts/desktop_traversal_schema_activation_decision.md`
- `docs/concepts/drafts/desktop_traversal_helper_contract.md`
- `docs/concepts/drafts/desktop_traversal_provenance.md`
- `docs/concepts/drafts/desktop_traversal_request_validation.md`
- `src/app.js`
- `src/desktopBroker.js`
- `src/desktopInspectionSchema.js`
- `src/desktopTraversalRequest.js`
- `src/desktopTraversalOutput.js`
- `src/desktopTraversalProvenance.js`
- `crates/soma-desktop-broker/src/main.rs`
- traversal-related Node and Rust tests

---

## Overall Assessment

The traversal scaffolding is aligned enough to continue toward activation, but it is not ready for
public activation. The current state is healthy: request validation, output validation, helper
argument derivation, Rust traversal internals, Node helper invocation, and provenance summaries
exist as future or internal paths, while the public endpoint, active runtime schema, active JSON
schema, and public helper command still fail closed.

The next work should prepare the active traversal-specific schema artifact and runtime adapter
without changing the default shallow inspection contract.

---

## What Holds Up

### Default runtime remains closed

`rejectUnsupportedDesktopTraversal` still rejects any request containing `traversal` before helper
invocation, root authorization, registry mutation, or provenance append. The active schema and
`validateDesktopInspectionResult` still reject `root_object.traversal` by default.

### Request authorization is shaped correctly

`validateFutureDesktopTraversalRequest` accepts `root_ref`, rejects raw service/path traversal
roots, applies bounded limits, and asks the disclosure registry to authorize the root before
returning an internal traversal request.

### Helper authority boundary is preserved

Node derives concrete helper args through `desktopTraversalHelperArgs`. The helper receives an
authorized service/path plus limits, not a Node-local `root_ref`. Rust has a private traversal bridge
from validated args into bounded traversal assembly, but `inspect-atspi-traversal` still returns not
implemented.

### Output and provenance gates are in the right order

Traversal helper output is validated through the future traversal-output validator before the
internal Node helper path returns it. The provenance adapter validates traversal output before
creating summary-only fields, and current endpoint tests still prove schema-rejected traversal
payloads write no provenance.

---

## Identified Gaps

### Active traversal schema artifact is not yet promoted

The future traversal schema exists only as
`docs/schemas/future-desktop-inspection-result-with-traversal.schema.json`. The schema activation
decision says traversal should use a traversal-specific active schema, not replace the default
desktop inspection schema. That active schema artifact does not yet exist.

Recommended next slice:

- create `docs/schemas/desktop-inspection-result-with-traversal.schema.json` from the future draft
- keep `docs/schemas/desktop-inspection-result.schema.json` unchanged
- add tests proving both schemas coexist and the default schema still excludes traversal
- do not change endpoint behavior

### Runtime adapter is internal but not yet named as an activation surface

`validateFutureDesktopInspectionResultWithTraversal` exists, but activation will need a clearly named
runtime path for traversal-authorized results. That path should remain separate from
`validateDesktopInspectionResult` default behavior.

Recommended follow-up after schema promotion:

- add an explicitly named traversal-authorized validator/assertion wrapper
- keep the default assertion rejecting traversal
- test that traversal-authorized validation accepts only bounded traversal output

### Public command is intentionally still disabled

Rust can build traversal internally, but the command still returns not implemented. That is correct
until Node can authorize, invoke, validate, and record provenance in one activation path.

No change recommended until schema/runtime and endpoint wiring are ready.

### Endpoint activation remains the largest remaining risk

Replacing `desktop_traversal_not_implemented` is the real authority expansion. It should be delayed
until the active traversal schema, traversal-authorized runtime validator, helper invocation, root
authorization, and summary-only provenance are wired together in one narrow path.

---

## Activation Checklist

Before replacing `desktop_traversal_not_implemented`, require:

- active traversal-specific schema exists and is tested
- default schema and default runtime validator still reject traversal
- traversal-authorized runtime validator is named and tested
- request validation rejects raw service/path roots
- root authorization resolves through the disclosure registry before helper invocation
- Node helper invocation receives only authorized service/path plus bounded limits
- Rust command activation keeps protected fields omitted at query and output boundaries
- helper output validation runs before response and provenance
- traversal provenance stores summary fields only
- rejected traversal requests and rejected helper output append no provenance
- module narrowing still revokes roots and blocks traversal

---

## Closing

Continue, but do not activate yet. The next safe slice is schema artifact promotion under a
traversal-specific name while leaving every public refusal and default validator unchanged.

---

## Next Review Trigger

Run another activation-gate review after the traversal-specific active schema and runtime adapter
exist, or immediately before replacing `desktop_traversal_not_implemented`.


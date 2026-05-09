# Traversal Unavailable Output Contract Review — 2026-05-09

**Date:** 2026-05-09
**Scope:** Review of unavailable traversal output contract before public Rust traversal command
activation
**Reviewer:** Codex
**Commit range:** `9b1ae0e..5a05704`

Related reviews:

- `docs/reviews/2026-05-09_traversal_pipeline_activation_readiness_review.md`
- `docs/reviews/2026-05-09_traversal_request_enablement_readiness_review.md`
- `docs/reviews/2026-05-09_traversal_activation_progress_review.md`

---

## Sources Reviewed

- `ROADMAP.md`
- `docs/concepts/drafts/desktop_traversal_enablement_sequence.md`
- `docs/concepts/drafts/desktop_traversal_helper_contract.md`
- `docs/concepts/drafts/bounded_recursive_atspi_traversal.md`
- `docs/fixtures/future-traversal-output-validation-cases.json`
- `docs/schemas/desktop-inspection-result-with-traversal.schema.json`
- `docs/schemas/future-desktop-inspection-result-with-traversal.schema.json`
- `src/desktopTraversalOutput.js`
- `src/desktopTraversalPipeline.js`
- `src/desktopTraversalProvenance.js`
- `test/desktopTraversalOutput.test.js`
- `test/desktopTraversalPipeline.test.js`
- `test/desktopTraversalProvenance.test.js`
- `test/schema.test.js`
- `crates/soma-desktop-broker/src/main.rs`
- `crates/soma-desktop-broker/tests/traversal_command.rs`

---

## Overall Assessment

The unavailable traversal output contract is now coherent enough for the next Rust preparatory slice,
but not for public command activation in the same step.

The Node-side contract now defines a stable unavailable traversal object: authorized root echo, zero
nodes, limits, `truncated=false`, `unavailable_reason`, `text_content_included=false`, and required
withheld fields. Validator tests, traversal-authorized runtime tests, schema artifacts, fixtures,
pipeline tests, and provenance tests now agree on that shape.

The public endpoint and public Rust traversal command still correctly fail closed.

---

## What Holds Up

### Validator and schema are aligned

`src/desktopTraversalOutput.js` accepts `unavailable_reason` and requires zero nodes when it is present.
Both traversal-specific schema artifacts now allow the field. The default desktop inspection validator
still rejects `root_object.traversal`.

### Provenance remains summary-only

The new provenance tests prove unavailable traversal records node count `0`, max returned depth `0`,
`traversal_truncated=false`, and the stable unavailable reason without copying service/path or node ids
into provenance.

### Internal pipeline has the unavailable branch

`runInternalDesktopTraversalRequest` now has explicit test coverage for validator-approved unavailable
traversal output flowing to traversal-authorized inspection output and summary-only provenance.

### Public behavior is unchanged

`/desktop/inspect/accessibility-tree` still rejects traversal requests before helper invocation.
`inspect-atspi-traversal` still returns not implemented with no stdout for valid-looking args.

---

## Identified Gaps

### Rust output model does not yet emit the unavailable shape

The Node contract is ready, but Rust still has only the successful `AtspiTraversalResult` JSON path.
Before public command activation, Rust needs an internal unavailable traversal result builder matching
the Node validator.

Recommended next slice:

- add Rust internal unavailable traversal result/output builder
- test `atspi_bus_address_unavailable` emits the agreed zero-node shape
- test unavailable JSON omits protected fields and includes the normal withheld field list
- keep `inspect-atspi-traversal` returning not implemented
- keep the Node endpoint traversal refusal active

### Public command activation tests still need a controlled command path

Before the command stops returning not implemented, add command-level integration tests that prove:

- valid args can emit traversal JSON accepted by the Node traversal-output validator
- bus unavailable emits the agreed unavailable JSON shape
- malformed args still fail before AT-SPI queries and emit no JSON
- stdout never includes protected fields

Those tests should land with or immediately before the command activation commit, not in the current
contract-review slice.

---

## Activation Disposition

Accept the unavailable traversal output contract.

Do not activate the public Rust command yet. The next safe work is Rust-side internal unavailable output
modeling and tests while preserving the disabled public command and disabled endpoint.

---

## Next Review Trigger

Run another review after Rust can internally build the unavailable traversal output shape, or
immediately before `inspect-atspi-traversal` stops returning not implemented.

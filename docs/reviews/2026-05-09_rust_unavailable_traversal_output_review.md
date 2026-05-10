# Rust Unavailable Traversal Output Review — 2026-05-09

**Date:** 2026-05-09
**Scope:** Review of Rust unavailable traversal output before command-level activation tests
**Reviewer:** Codex
**Commit range:** `ab00207..1d516fa`

Related reviews:

- `docs/reviews/2026-05-09_traversal_unavailable_output_contract_review.md`
- `docs/reviews/2026-05-09_traversal_pipeline_activation_readiness_review.md`

---

## Sources Reviewed

- `ROADMAP.md`
- `docs/concepts/drafts/desktop_traversal_enablement_sequence.md`
- `docs/concepts/drafts/desktop_traversal_rust_implementation_plan.md`
- `docs/concepts/drafts/desktop_traversal_helper_contract.md`
- `src/desktopTraversalOutput.js`
- `test/desktopTraversalOutput.test.js`
- `crates/soma-desktop-broker/src/main.rs`
- `crates/soma-desktop-broker/tests/traversal_command.rs`

---

## Overall Assessment

The Rust unavailable traversal output model is in the right shape, but public command activation should
still wait.

Rust now has an internal `AtspiTraversalResult::unavailable` builder that emits the agreed zero-node
shape: authorized root echo, `nodes: []`, limits, `truncated: false`, `unavailable_reason`,
`text_content_included: false`, and the normal withheld-field list. Tests also prove protected fields are
not emitted in unavailable output. The public command remains disabled.

The remaining gap is cross-contract verification. Rust tests currently assert output by substring, while
Node validates its own fixture. Before command behavior changes, the Rust-emitted JSON should be checked
against the Node traversal-output validator or a shared fixture so the two sides cannot drift.

---

## What Holds Up

### Public behavior remains closed

`inspect-atspi-traversal` still returns not implemented with no stdout for valid-looking traversal args.
The Node endpoint still rejects traversal requests before helper invocation.

### Rust unavailable shape matches the intended fields

The builder emits zero nodes and a stable unavailable reason, includes effective traversal limits, keeps
`text_content_included=false`, and includes the required withheld fields.

### Successful output behavior is unchanged

The existing successful traversal output tests still pass, including bounded shape, JSON escaping, and
protected-field omission.

---

## Identified Gaps

### No machine-checked Rust-to-Node output contract yet

The next activation step needs a test that takes traversal JSON shaped like Rust output and runs it
through `validateFutureDesktopTraversalOutput`. This can be done with a shared fixture or a small
command/test fixture path, but should land before public command activation.

Recommended next slice:

- add a Rust/Node contract fixture for successful and unavailable traversal helper output
- validate that fixture through `validateFutureDesktopTraversalOutput`
- keep Rust unit tests for output assembly
- keep `inspect-atspi-traversal` returning not implemented
- keep endpoint traversal refusal active

### Command activation still needs command-level tests

After cross-contract fixture coverage exists, the command activation slice should add integration tests
for:

- successful command stdout validates as traversal output
- AT-SPI bus unavailable command stdout validates as unavailable traversal output
- malformed args fail before AT-SPI queries and emit no JSON
- stdout omits protected fields

That should be a separate behavior-changing slice.

---

## Activation Disposition

Accept the internal Rust unavailable traversal output model.

Do not activate `inspect-atspi-traversal` yet. The next safe slice is cross-contract traversal helper
output fixtures/tests that prove Rust-shaped output is accepted by Node validation while public runtime
behavior remains disabled.

---

## Next Review Trigger

Run another review after cross-contract traversal output fixtures pass, or immediately before changing
`inspect-atspi-traversal` from disabled to active.

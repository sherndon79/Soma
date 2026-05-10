# Traversal Helper Output Contract Review — 2026-05-09

**Date:** 2026-05-09
**Scope:** Review of Rust-shaped traversal helper output fixtures before command activation
**Reviewer:** Codex
**Commit range:** `bb53b07..e6d3882`

Related reviews:

- `docs/reviews/2026-05-09_rust_unavailable_traversal_output_review.md`
- `docs/reviews/2026-05-09_traversal_unavailable_output_contract_review.md`

---

## Sources Reviewed

- `ROADMAP.md`
- `docs/concepts/drafts/desktop_traversal_enablement_sequence.md`
- `docs/fixtures/rust-shaped-traversal-helper-output.json`
- `src/desktopTraversalOutput.js`
- `test/desktopTraversalOutput.test.js`
- `crates/soma-desktop-broker/src/main.rs`
- `crates/soma-desktop-broker/tests/traversal_command.rs`

---

## Overall Assessment

The cross-contract fixture gate is satisfied.

`docs/fixtures/rust-shaped-traversal-helper-output.json` contains both successful bounded traversal output
and zero-node unavailable traversal output in the Rust helper shape. `test/desktopTraversalOutput.test.js`
validates both through `validateFutureDesktopTraversalOutput`, so Node now has machine-checked coverage
that it accepts the helper-shaped JSON it expects Rust to emit after activation.

Public behavior remains closed: `inspect-atspi-traversal` still returns not implemented, and the Node
endpoint still rejects traversal requests.

---

## What Holds Up

### Cross-contract output is pinned

The fixture covers both helper branches that matter before command activation:

- successful traversal with local node ids, roles, child counts, depth, children, limits, truncation,
  `text_content_included=false`, and withheld fields
- unavailable traversal with authorized root echo, zero nodes, limits, `truncated=false`,
  `unavailable_reason`, `text_content_included=false`, and withheld fields

### Node remains the accepting authority

The fixture does not relax Rust behavior by itself. It only proves Node accepts the shape through the same
validator that the internal helper invocation path uses.

### Public command is still disabled

The current Rust integration test still verifies valid-looking traversal args return exit code `2`,
empty stdout, and `inspect-atspi-traversal is not implemented`.

---

## Identified Gaps

### Command-level activation tests are still missing

The next safe slice should add command-level tests that describe the future active behavior without
changing the command yet, or add a test-only command/query seam that can validate stdout before activation.

Required coverage before activation:

- successful command stdout validates as traversal output
- AT-SPI bus unavailable command stdout validates as unavailable traversal output
- malformed args still fail before AT-SPI queries and emit no JSON
- stdout omits protected fields
- Node endpoint traversal refusal remains active

### Live AT-SPI dependency needs a test seam

Command activation tests should not require a live desktop session. The implementation likely needs a
small injectable query boundary, fixture mode, or unit-level command runner so tests can exercise success
and unavailable command behavior deterministically.

---

## Activation Disposition

Accept the cross-contract traversal helper output fixtures.

Do not activate `inspect-atspi-traversal` in the next step unless the command-level test seam lands in
the same slice and keeps malformed-arg/no-JSON behavior pinned. The safer next slice is command-level
activation test scaffolding with the public command still disabled.

---

## Next Review Trigger

Run another review after command-level activation tests exist, or immediately before
`inspect-atspi-traversal` stops returning not implemented.

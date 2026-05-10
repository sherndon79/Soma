# Traversal Command Activation Scaffold Review - 2026-05-09

**Date:** 2026-05-09
**Scope:** Review of the internal Rust command-output scaffold before public traversal command activation
**Reviewer:** Codex
**Commit range:** `5d215c8..79edd6b`

Related reviews:

- `docs/reviews/2026-05-09_traversal_helper_output_contract_review.md`
- `docs/reviews/2026-05-09_rust_unavailable_traversal_output_review.md`
- `docs/reviews/2026-05-09_traversal_pipeline_activation_readiness_review.md`

---

## Sources Reviewed

- `ROADMAP.md`
- `docs/concepts/drafts/desktop_traversal_enablement_sequence.md`
- `docs/concepts/drafts/desktop_traversal_rust_implementation_plan.md`
- `crates/soma-desktop-broker/src/main.rs`
- `crates/soma-desktop-broker/tests/traversal_command.rs`
- `test/desktopBroker.test.js`
- `test/desktopTraversalOutput.test.js`

---

## Overall Assessment

Accept the internal command-output scaffold as a useful pre-activation seam.

The scaffold now lets Rust produce the future traversal stdout shape from injected address/query
providers without exposing that behavior through `inspect-atspi-traversal`. This is the right
direction: success and unavailable command-output behavior can be tested deterministically without a
live AT-SPI session, while the public command still returns not implemented.

Do not activate the public command yet. The remaining gap is not traversal shape or internal output
assembly. The remaining gap is deterministic command-dispatch integration coverage for the exact
public command path after it stops returning not implemented.

---

## What Holds Up

### Future stdout path is testable without live AT-SPI

`build_atspi_traversal_command_output` accepts injected providers for:

- AT-SPI bus address lookup
- bounded node observation query

This makes both success and unavailable output deterministic in Rust unit tests. The tests prove the
future stdout path can emit:

- successful traversal JSON from an injected address and fake node observations
- unavailable traversal JSON when the address provider returns unavailable

### Public command behavior remains closed

`inspect-atspi-traversal` still parses valid-looking arguments and returns:

- exit code `2`
- empty stdout
- `inspect-atspi-traversal is not implemented`

The new malformed-argument integration test also verifies unknown `root_ref`-style input emits no
stdout JSON and fails before any future traversal behavior could run.

### Protected fields remain omitted

The scaffold tests continue the existing invariant that traversal output omits names, descriptions,
text, states, and actions. The broader Rust test suite also keeps screenshots, pointer state, keyboard
state, values, and `desktop_ref_id` out of traversal output.

### Node authority is unchanged

Node still derives concrete helper args only from an authorized root shape, and the public endpoint
still rejects traversal requests before helper invocation. Default runtime validation remains closed
to traversal-bearing inspection results.

---

## Remaining Gaps

### Public command-dispatch activation needs deterministic integration coverage

The internal seam is not the same as an integration test of the activated command. Once `main` routes
valid `inspect-atspi-traversal` args into traversal output, tests need a deterministic way to cover the
public command path without depending on the host desktop session.

Before activation, add or choose a controlled command-dispatch strategy for at least:

- valid args produce stdout JSON that validates against the traversal helper contract
- unavailable AT-SPI address produces the stable zero-node unavailable shape
- malformed args still return non-zero and no stdout JSON
- protected fields remain absent from public command stdout

### Live environment must not decide test outcomes

`get_atspi_bus_address` currently shells out to `busctl --user call org.a11y.Bus ... GetAddress`.
That is appropriate for runtime behavior, but tests should not depend on whether the developer or CI
environment happens to expose an AT-SPI bus.

Reasonable next designs include:

- integration tests that place a controlled fake `busctl` earlier in `PATH`
- a command-runner abstraction that can be exercised directly from integration tests
- a narrow test-only fixture mode that cannot be mistaken for normal runtime behavior

The activation slice should pick one of these explicitly before changing public command behavior.

---

## Activation Disposition

Do not activate `inspect-atspi-traversal` yet.

The next safe slice is deterministic public command activation harness work. It should preserve the
current public disabled-command test until the same slice replaces it with activated-command tests.
The Node endpoint should remain refused throughout that work.

---

## Next Review Trigger

Run another review after command-dispatch activation tests exist, or immediately before
`inspect-atspi-traversal` starts emitting traversal JSON from the public command path.

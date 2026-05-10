# Fake Busctl Traversal Harness Review - 2026-05-09

**Date:** 2026-05-09
**Scope:** Review of fake-`busctl` public traversal command activation harness
**Reviewer:** Codex
**Commit range:** `7c5ddd3..b57b0d5`

Related reviews:

- `docs/reviews/2026-05-09_traversal_command_activation_scaffold_review.md`
- `docs/reviews/2026-05-09_traversal_helper_output_contract_review.md`

---

## Sources Reviewed

- `ROADMAP.md`
- `docs/concepts/drafts/desktop_traversal_command_activation_harness.md`
- `docs/concepts/drafts/desktop_traversal_enablement_sequence.md`
- `crates/soma-desktop-broker/tests/traversal_command.rs`
- `crates/soma-desktop-broker/src/main.rs`

---

## Overall Assessment

Accept the fake-`busctl` harness scaffold.

The integration helper is sufficient to support deterministic public command activation tests for
both success and unavailable traversal output. It exercises the real compiled helper binary through
`PATH` injection rather than adding production fixture modes. The current disabled-command guard also
uses `poison` mode and proves valid traversal args still return not implemented without invoking
`busctl`.

Do not enable the Node endpoint in the next slice. The next safe step is Rust helper command
activation only: route valid `inspect-atspi-traversal` args to bounded traversal output, replace the
valid-args disabled assertion with fake-`busctl` success/unavailable command tests, and keep
`/desktop/inspect/accessibility-tree` returning `desktop_traversal_not_implemented`.

---

## What Holds Up

### Real-binary command path can be tested deterministically

`FakeBusctl::prepend_to_path` modifies only the child process environment. That lets integration
tests run the real `soma-desktop-broker` binary while controlling the AT-SPI command responses.

### The fake covers the calls activation needs

The fake handles the traversal command's expected `busctl` calls:

- `GetAddress`
- `GetRoleName`
- `ChildCount`
- `GetChildren`

It returns busctl-shaped output already accepted by the existing parsers.

### Disabled behavior remains pinned

The current valid-args integration test keeps `inspect-atspi-traversal` closed:

- exit code `2`
- empty stdout
- `inspect-atspi-traversal is not implemented`
- fake `busctl` is not invoked

Malformed args also continue to fail with empty stdout.

### No production fixture mode was introduced

The fake helper lives in integration tests. Production command code still discovers `busctl` through
normal `PATH` lookup at runtime, and there is no test-only flag in the command surface.

---

## Remaining Activation Requirements

Before or during Rust command activation, replace the disabled valid-args guard with public command
tests proving:

- success mode exits `0`, emits traversal JSON on stdout, and leaves stderr empty
- unavailable mode exits `0`, emits zero-node unavailable traversal JSON, and leaves stderr empty
- protected fields remain absent from public stdout
- malformed args still return exit code `2` and empty stdout

The activation slice should also keep Node endpoint traversal refusal and default runtime traversal
rejection unchanged.

---

## Activation Disposition

Proceed to Rust helper command activation in the next slice.

Scope that activation narrowly:

- change only `inspect-atspi-traversal` command dispatch
- add or update Rust integration tests using fake `busctl`
- keep Node endpoint traversal refusal active
- keep default Node schema/runtime traversal rejection active
- do not add text, names, descriptions, states, actions, screenshots, or actuation

---

## Next Review Trigger

Run another review after the Rust command starts emitting traversal JSON, before replacing
`desktop_traversal_not_implemented` in the Node endpoint.

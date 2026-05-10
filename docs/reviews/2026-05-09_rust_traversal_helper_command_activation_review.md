# Rust Traversal Helper Command Activation Review - 2026-05-09

**Date:** 2026-05-09
**Scope:** Review of activated Rust `inspect-atspi-traversal` helper command before Node endpoint enablement
**Reviewer:** Codex
**Commit range:** `a2968db..0173550`

Related reviews:

- `docs/reviews/2026-05-09_fake_busctl_traversal_harness_review.md`
- `docs/reviews/2026-05-09_traversal_command_activation_scaffold_review.md`
- `docs/reviews/2026-05-09_traversal_request_enablement_readiness_review.md`

---

## Sources Reviewed

- `ROADMAP.md`
- `crates/soma-desktop-broker/src/main.rs`
- `crates/soma-desktop-broker/tests/traversal_command.rs`
- `docs/concepts/drafts/desktop_traversal_command_activation_harness.md`
- `docs/concepts/drafts/desktop_traversal_enablement_sequence.md`
- `docs/concepts/drafts/desktop_traversal_rust_implementation_plan.md`
- `src/app.js`
- `test/app.test.js`
- `test/desktopBroker.test.js`
- `test/desktopTraversalOutput.test.js`

---

## Overall Assessment

Accept the Rust helper command activation.

`inspect-atspi-traversal` now routes valid parsed helper args into the existing bounded traversal
output path. Fake-`busctl` integration tests cover successful traversal output, unavailable traversal
output, and malformed-argument no-stdout behavior without relying on a live AT-SPI session.

Do not enable the Node endpoint yet. The Node endpoint still rejects traversal requests with
`desktop_traversal_not_implemented` before helper invocation, authorization, registry writes, or
provenance append. That is still the right public behavior until endpoint integration tests prove the
active path preserves authorization and provenance constraints.

---

## What Holds Up

### Activated Rust command emits the expected helper shapes

The public Rust command now emits:

- bounded success traversal JSON for valid args and fake AT-SPI observations
- stable zero-node unavailable traversal JSON when AT-SPI address lookup is unavailable
- no stdout and exit code `2` for malformed args

The success/unavailable shapes match the existing Rust-shaped fixture that Node validates through
`validateFutureDesktopTraversalOutput`.

### Protected fields remain omitted

Rust command tests assert names, descriptions, text, states, and actions are absent from public stdout.
The Rust unit suite also keeps values, screenshots, pointer state, keyboard state, and `desktop_ref_id`
out of traversal output.

### Node endpoint refusal remains active

`rejectUnsupportedDesktopTraversal` still rejects any `traversal` request with
`desktop_traversal_not_implemented`. Existing endpoint tests prove this happens before:

- helper invocation
- registry root authorization
- disclosure registry writes
- traversal provenance append

### Default Node runtime validation remains traversal-closed

`attachTraversalToDesktopInspectionResult` still requires the traversal-authorized assertion path.
The default inspection assertion still rejects traversal-bearing inspection results.

---

## Remaining Endpoint Enablement Gaps

Before replacing `desktop_traversal_not_implemented`, add or confirm endpoint-level tests that prove:

- `root_ref` traversal succeeds only after disclosure-registry authorization
- unknown, expired, revoked, or inactive roots fail before helper invocation
- helper output is validated before response attachment
- helper-output validation failure appends no provenance
- success provenance remains summary-only
- unavailable provenance remains summary-only with zero node count and stable reason
- default validator remains closed while the explicit traversal-authorized path is used only for this
  endpoint response
- module narrowing still blocks traversal roots after revocation

The internal pipeline tests cover much of this behavior, but the public endpoint has not yet replaced
the hard traversal refusal.

---

## Activation Disposition

Proceed to a Node endpoint enablement readiness slice, not direct endpoint enablement.

That slice should inventory which endpoint tests already exist, which internal pipeline tests can be
promoted to endpoint coverage, and which gaps must be closed before `/desktop/inspect/accessibility-tree`
can call the active Rust helper.

---

## Next Review Trigger

Run another review after the endpoint readiness checklist is updated, or immediately before replacing
`desktop_traversal_not_implemented`.

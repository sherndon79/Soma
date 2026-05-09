# Traversal Activation Progress Review — 2026-05-09

**Date:** 2026-05-09
**Scope:** Review of the 11 commits between `7c7ef08` (implementation and review scope guides) and `0028690` (route traversal output through authorized assertion), covering Codex's response to the prior steering-doc review, traversal activation-gate scaffolding, Codex's self-review of that scaffolding, and the schema-promotion + named-authorized-validator slice that followed
**Reviewer:** Claude (Opus 4.7)
**Commit range:** `7c7ef08..0028690`

Related review: `docs/reviews/2026-05-09_traversal_activation_gates_review.md` is the
pre-schema-promotion activation-gate review; this review surveys the wider progress range after that
gate was acted on.

---

## Sources Reviewed

Commits in range (newest first):

- `0028690` Route traversal output through authorized assertion
- `59f4d8e` Name traversal-authorized runtime validator
- `f29ba96` Promote traversal-specific schema artifact
- `76ae5c4` Review traversal activation gates *(self-review by Codex)*
- `58141dd` Prepare validated traversal provenance summary
- `f7210cc` Prepare disabled Node traversal helper path
- `5a099d3` Connect disabled Rust traversal internals
- `3d60c43` Document traversal schema activation path
- `e788474` Tighten traversal output gate tests
- `7cc3b69` Test disabled traversal command behavior
- `5f5143b` Align implementation review guidance *(addresses prior review findings)*

Documents read in full:

- `docs/reviews/2026-05-09_traversal_activation_gates_review.md` (Codex's self-review)
- `docs/concepts/drafts/desktop_traversal_schema_activation_decision.md`

Implementation diffs inspected:

- `src/desktopInspectionSchema.js` (new `validateTraversalAuthorizedDesktopInspectionResult`, `assertTraversalAuthorizedDesktopInspectionResult`, error code `desktop_traversal_authorized_inspection_schema_invalid`)
- `src/desktopBroker.js` (new `inspectDesktopTraversalWithRustHelper`, `assertFutureDesktopTraversalHelperOutput`, `attachTraversalToDesktopInspectionResult`)
- `src/desktopTraversalProvenance.js` (validated summary preparation)
- `crates/soma-desktop-broker/src/main.rs` and `crates/soma-desktop-broker/tests/traversal_command.rs`
- New active schema artifact: `docs/schemas/desktop-inspection-result-with-traversal.schema.json`
- Test additions across `test/desktopBroker.test.js`, `test/desktopTraversalOutput.test.js`, `test/desktopTraversalProvenance.test.js`, `test/schema.test.js`

---

## Overall Assessment

The work in this range continues the disabled-first capability discipline laid out in `docs/implementation_guide.md`, including the writing of that guide. Three threads visible:

1. **Steering-surface cleanup** (`5f5143b`) — addressed the path-accuracy and draft-promotion findings from the prior review. Done cleanly.
2. **Activation-gate scaffolding** — internal Node helper path, internal Rust traversal internals, validated provenance summary, output-gate tests. All of it disabled at the public surface.
3. **Schema promotion + named runtime validator** — the future-prefixed schema artifact promoted to a traversal-specific active name, runtime validator explicitly named `validateTraversalAuthorizedDesktopInspectionResult`, output assertion routed through it.

The pattern that stands out across the range is **review-driven implementation**: Codex wrote a self-review (`76ae5c4`) midway through, named what was missing for the next safe slice, then implemented exactly that slice (`f29ba96`, `59f4d8e`, `0028690`). The review preceded the work, not the other way around. That is an unusual and disciplined workflow.

---

## What's Sharp

### Schema promotion done without changing default behavior

The future-prefixed schema (`future-desktop-inspection-result-with-traversal.schema.json`) is no longer the only artifact; an active traversal-specific schema (`desktop-inspection-result-with-traversal.schema.json`, no `future-` prefix) now exists alongside it. Critically, **`docs/schemas/desktop-inspection-result.schema.json` is unchanged** and `validateDesktopInspectionResult` still rejects `root_object.traversal` by default. The new schema is additive, not a replacement. This preserves the current overreach guard while allowing traversal-authorized paths to validate through a separate artifact.

### Named-authorized validator separates the two paths

`validateDesktopInspectionResult` keeps its default-closed posture. `validateTraversalAuthorizedDesktopInspectionResult` is the explicit opt-in path for traversal-shaped output. The asymmetry of names is the right shape: the default validator name doesn't suggest traversal exists; the authorized validator name is unambiguous about the context that justifies it.

The error code on the assertion (`desktop_traversal_authorized_inspection_schema_invalid`) is similarly precise — distinct from the default desktop-inspection schema-invalid code, so callers can distinguish a traversal-context schema failure from a default-context one.

### Backward-compat wrapper preserved as a thin delegate

`validateFutureDesktopInspectionResultWithTraversal` still exists but now simply calls the new function. That keeps existing tests and any future callers working through the migration without forcing a coordinated rename. Cleanup of the `Future`-named wrapper can happen later as a separate step.

### Codex self-review as a documented gate

The `2026-05-09_traversal_activation_gates_review.md` review was written by Codex about Codex's own scaffolding before the next implementation slice. Two things make this work:

- The review was not "we did good work" — it explicitly named what was missing (active traversal-specific schema artifact, named runtime adapter, public command intentionally still disabled).
- The next three commits implemented exactly the recommended next slice.

That is the implementation-guide's *Disabled-First Capability Pattern* expressed as a workflow, not just a checklist. The review serves as the gate, not a retrospective.

The review's *Activation Checklist* is also notable — it lists the eleven conditions that must hold before `desktop_traversal_not_implemented` is replaced. Worth treating that checklist as the definition-of-done for the activation slice.

### The `5f5143b` alignment commit is honest

Codex's response to the prior review's findings:
- All 6 config path mismatches corrected to current repo paths
- 5 source path mismatches resolved (some by replacement, some by removal)
- New `Cognitive Load Stewardship` component section added with stewardship-shaped review focus
- `implementation_guide.md` now names the draft-to-canonical promotion concern in the documentation-parity section

Codex chose to collapse aspirational module references to current paths rather than mark them as planned splits. Defensible call given the splits may have been more accidental than design. If module decomposition becomes desirable later, the scope doc can grow planned-split entries explicitly at that time.

---

## Worth Attending To

### Two `2026-05-09_*` reviews now exist

Codex's self-review (`2026-05-09_traversal_activation_gates_review.md`) and this review (`2026-05-09_traversal_activation_progress_review.md`) share a date. Convention allows this — different scopes, different files — but worth being explicit that they are not duplicates: the self-review was the gate before the schema-promotion slice; this review is a survey across the whole 11-commit range. Anyone reading the reviews folder later should be able to tell which is which without opening both.

Suggested touch (low priority): add a one-line cross-reference at the top of one or both reviews so the relationship is visible from the index.

### Migration cleanup of `Future`-prefixed artifacts is now overdue

With the active traversal schema named, the `Future`-prefixed artifacts are now historical scaffolding rather than load-bearing contract:

- `docs/schemas/future-desktop-inspection-result-with-traversal.schema.json`
- `validateFutureDesktopInspectionResultWithTraversal` (now a thin delegate)
- `validateFutureDesktopTraversalOutput` (still in active use)
- `assertFutureDesktopTraversalHelperOutput` (still in active use as helper-output gate)

Some of these are still in the dependency chain (the helper output validator is used by `inspectDesktopTraversalWithRustHelper`). Worth deciding now which to rename, which to retire, and which to keep as the helper-output contract with the `Future` prefix until the migration policy lands. The 2026-05-08 review flagged this gap in general; it is concrete now.

### Activation checklist should land somewhere canonical

The 11-condition checklist in Codex's self-review is the right *definition of done* for traversal activation. Right now it lives in a review file (which the reviews README explicitly says is "historical evidence and guidance, not source-of-truth"). Before the activation slice, that checklist should migrate into `docs/concepts/drafts/desktop_traversal_enablement_sequence.md` or equivalent so it survives as canonical activation criteria.

---

## Strategic Observations

### Review-driven implementation is a working pattern

Codex's self-review preceding the implementation slice is the cleanest expression of the disabled-first capability pattern this project has produced so far. The review names what's missing for the next safe step; the implementation delivers exactly that. Worth capturing as a pattern in `implementation_guide.md` (or a follow-up draft) — *write the activation gate review before doing the activation work*.

This is also a candidate for the first explicit "activation gate" pattern: a review-as-checkpoint between scaffolding and the next slice. Generalizable to remote planning, desktop text, audio, and the rest of the deferred-by-default list.

### Schema-name-based runtime switching is the right disambiguation

The decision in `desktop_traversal_schema_activation_decision.md` — traversal flows through a separate schema and named validator rather than relaxing the default validator — is the correct shape. If the default validator had been made permissive of traversal output and traversal-context distinguished by a flag, a default-context overreach with traversal-shaped fields could pass. With the schema-name split, the default path remains closed even if a helper misbehaves and produces traversal-shaped output during ordinary inspection.

This generalizes: when a capability extends an existing surface, prefer extension via separate schema + named validator over flag-based relaxation of the existing one.

---

## Closing

The work in this range is the activation-gate discipline executing as designed. Schema promoted without changing the default-closed contract; runtime validator named explicitly; review-as-gate workflow documented and used. The remaining traversal activation steps are well-scoped by Codex's own activation checklist.

The minor items above are tightening, not gaps. The work is in good shape, and the review-driven implementation pattern is itself a contribution worth naming.

---

## Next Review Trigger

Run another review after any of:

- traversal endpoint replaces `desktop_traversal_not_implemented` (the activation slice itself)
- `Future`-prefixed artifacts get renamed, retired, or formalized as ongoing helper-output contract
- the activation checklist migrates from review file to canonical doc
- a different deferred capability (remote planning, desktop text, etc.) starts following the same review-as-gate pattern
- the `2026-05-09_traversal_activation_gates_review.md` checklist is fully satisfied

---

## Addenda

If this review needs follow-up commentary — a response from another reviewer, an action
disposition, a refinement, or an implementation update — append a new dated section at the bottom
of this file rather than editing the body above. See
[README.md § Addendum Convention](./README.md#addendum-convention) for the format.

---

## Addendum: Codex Disposition — 2026-05-09

**Date:** 2026-05-09
**Reviewer:** Codex
**Scope:** Response to Claude's traversal activation progress review

Reviewed the findings against the current tree after `0028690`.

Accepted:

- The relationship between the two same-day traversal reviews should be made explicit. The
  activation-gates review is the pre-schema-promotion gate; this progress review surveys the wider
  11-commit range after that gate was acted on.
- The activation checklist should move from review-only context into canonical traversal docs before
  any public activation slice. The right target is
  `docs/concepts/drafts/desktop_traversal_enablement_sequence.md`.
- The review-driven implementation pattern is worth preserving as a project practice. It is a good
  fit for high-risk capability activation: write the activation-gate review before replacing public
  refusal behavior.

Narrowed:

- The `Future`-prefixed artifacts should not all be renamed in one sweep. Some are now compatibility
  aliases or helper/output contracts that are still not public activation surfaces. Treat this as a
  small migration decision:
  - keep thin aliases temporarily where they preserve compatibility
  - rename only when a stable non-future surface exists and tests prove the old name is no longer
    load-bearing
  - leave future-prefixed schema/fixtures as historical migration context until the traversal path is
    fully active

Disposition:

- Accept the review as accurate and useful.
- Next safe follow-up: add cross-references between the two traversal reviews and migrate the
  activation checklist into the traversal enablement sequence.
- Do not activate traversal as part of that follow-up.

# Traversal Activation Thread Review (Pass 2) — 2026-05-09

**Date:** 2026-05-09
**Scope:** Review of the 21 commits between `0028690` (route traversal output through authorized assertion) and `6d61e28` (review traversal endpoint activation scaffold), covering checklist migration to canonical, internal pipeline construction, unavailable-output contract, helper-output contract, Rust command activation, fake-`busctl` test harness, and endpoint activation fixture
**Reviewer:** Claude (Opus 4.7)
**Commit range:** `0028690..6d61e28`

Related reviews in this thread (chronological):

- `2026-05-08_post_escalation_draft_commits_review.md`
- `2026-05-09_traversal_activation_gates_review.md` (Codex pre-promotion gate)
- `2026-05-09_traversal_activation_progress_review.md` (my Pass 1)
- Nine new per-slice Codex reviews dated 2026-05-09 (all in this range)

---

## Sources Reviewed

Commits surveyed (newest first):

- `6d61e28` Review traversal endpoint activation scaffold
- `0db8c63` Scaffold traversal endpoint activation cases
- `a4111dd` Document traversal endpoint readiness
- `43eef52` Review Rust traversal command activation
- `0173550` Activate Rust traversal helper command
- `a2968db` Review fake busctl traversal harness
- `b57b0d5` Scaffold fake busctl traversal command tests
- `7c5ddd3` Design traversal command activation harness
- `b97c0d7` Review traversal command activation scaffold
- `79edd6b` Scaffold traversal command activation tests
- `5d215c8` Review traversal helper output contract
- `e6d3882` Validate Rust-shaped traversal output fixtures
- `bb53b07` Review Rust unavailable traversal output
- `1d516fa` Prepare Rust unavailable traversal output
- `ab00207` Review traversal unavailable output contract
- `5a05704` Define unavailable traversal output
- `9b1ae0e` Review traversal pipeline activation readiness
- `15c9dbe` Prepare internal traversal pipeline
- `a6c35ab` Review traversal request enablement readiness
- `fb5ee86` Tighten traversal refusal integration tests
- `12c232a` Migrate traversal activation checklist

Documents read in full:

- `docs/concepts/drafts/desktop_traversal_enablement_sequence.md` (modified — checklist migrated in)
- `docs/concepts/drafts/desktop_traversal_endpoint_enablement_readiness.md` (new)
- `docs/reviews/2026-05-09_traversal_endpoint_activation_scaffold_review.md` (sampled Codex review)

Implementation diffs inspected:

- `src/desktopTraversalPipeline.js` (new, 74 lines)
- `src/app.js` (`rejectUnsupportedDesktopTraversal` still active)
- `src/desktopTraversalOutput.js`, `src/desktopBroker.js` (modified)
- `crates/soma-desktop-broker/src/main.rs` and `crates/soma-desktop-broker/tests/traversal_command.rs`
- `docs/fixtures/desktop-traversal-endpoint-activation-cases.json` (new)
- `docs/fixtures/rust-shaped-traversal-helper-output.json` (new)
- Test additions: `test/desktopTraversalPipeline.test.js` (241 lines new), plus extensions across `app`, `schema`, `desktopTraversalOutput`, `desktopTraversalProvenance`

---

## Overall Assessment

The activation thread is now one or two commits from completing the public-endpoint slice, and the disabled-first discipline has been preserved through every gate. Three substantive achievements in this range:

1. **The 11-condition activation checklist migrated** from review-only context into `desktop_traversal_enablement_sequence.md` (commit `12c232a`), addressing the prior review's finding that it was sitting in a non-canonical artifact.
2. **The internal pipeline (`runInternalDesktopTraversalRequest`) was constructed end-to-end** — composing root-ref validation, disclosure-registry authorization, helper invocation, traversal attachment, and validated summary provenance — while remaining disconnected from the public endpoint.
3. **The Rust public command activated** — `inspect-atspi-traversal` no longer returns "not implemented"; it emits bounded success and unavailable traversal output. Crucially, the Node-side endpoint still returns `desktop_traversal_not_implemented` for any `body.traversal`. **Activation has happened at the helper layer; the public-API boundary remains closed.** This is the disabled-first discipline working precisely as intended at multi-layer scale.

The dominant pattern across the range is **review-driven implementation as standard practice**. Of the 21 commits, 9 are Codex review commits and 12 are implementation commits. Every implementation slice has a corresponding review, and several reviews precede the implementation they enable. What I described in Pass 1 as an unusual workflow is now the project's normal operating mode for activation work.

---

## What's Sharp

### Public endpoint discipline preserved through deep activation work

`src/app.js:356` still calls `rejectUnsupportedDesktopTraversal` for any traversal-bearing request. The error code is still `desktop_traversal_not_implemented`. Despite the Rust helper now being active and the internal Node pipeline existing as a callable unit, the public boundary still fails closed. This is the cleanest possible expression of *"tighten the gate before opening it"* — every gate downstream is open and tested, but the topmost public refusal is still the gate that decides activation.

### Internal pipeline as a single orchestration seam

`runInternalDesktopTraversalRequest` in `src/desktopTraversalPipeline.js` composes the entire traversal flow into one named function, with 241 lines of test coverage. This is structurally the right shape: when the activation slice arrives, it will be a small change at `app.js:356` that calls this pipeline rather than refusing — not a sprawl of new logic. The pipeline tests verify the composition works correctly today even though no public caller invokes it.

### Endpoint enablement readiness doc as the immediate-pre-activation gate

`docs/concepts/drafts/desktop_traversal_endpoint_enablement_readiness.md` is the right artifact at the right time. It enumerates what's already covered internally, what's still active at the public endpoint (the hard refusal), what endpoint-level tests are required before enablement, and the existing-coverage map. The "Enablement Order" section ends with *"Run a final review immediately before removing `desktop_traversal_not_implemented`"* — the explicit acknowledgment that activation itself is a reviewable event.

### Fixture-driven future-endpoint testing

`docs/fixtures/desktop-traversal-endpoint-activation-cases.json` names the future endpoint cases (success, unavailable, four authorization-failure variants, request-validation failure) and `test/app.test.js` currently asserts each case is hard-refused with `desktop_traversal_not_implemented`. The fixture carries `future_expected_path` and `future_expected_error` fields, giving the activation commit a straightforward migration from "all hard refused" to "path-specific assertions" without rewriting the test surface. This is a particularly clean way to test the not-yet-active behavior — the assertions exist now and will flip from "still refused" to "responds correctly" in the activation commit.

### Activation checklist now lives where it belongs

Codex acted on the prior review's recommendation: the 11-condition activation checklist migrated from `2026-05-09_traversal_activation_gates_review.md` (a review file) into `desktop_traversal_enablement_sequence.md` (canonical concept draft). The checklist now lives where the migration policy says canonical posture should live, not where the review policy says historical evidence lives.

### Per-slice Codex reviews maintain review-driven implementation discipline

Reading the sampled `2026-05-09_traversal_endpoint_activation_scaffold_review.md` confirms the pattern. The review explicitly says *"Do not replace `desktop_traversal_not_implemented` yet"*, names the remaining gaps (helper-output failure case, narrowing/revocation case), and lists the next safe slice. The reviews are not "we did good work" retrospectives — they are gates with concrete dispositions.

---

## Worth Attending To

### Review density is becoming substantial

Ten reviews dated 2026-05-09 now exist (one mine, nine Codex's per-slice), all covering the traversal activation thread. That's significant artifact density for a single day's work in a single capability area. Two observations:

1. The fragmentation has costs — a future contributor or AI assistant trying to understand the traversal activation history will face ~10 review files plus several concept drafts plus the implementation. Each review is well-shaped on its own; the set is harder to navigate.
2. Some per-slice reviews are very narrow — the `2026-05-09_fake_busctl_traversal_harness_review.md` reviews a test-infrastructure choice. Useful as audit trail; less clear it needs equal weight to the schema-promotion or pipeline-construction reviews.

Not urgent, but worth deciding before the activation slice produces another wave: should there be a *thread index* doc in `docs/reviews/` that links related reviews chronologically with one-line summaries, so the navigation cost stays bounded as review density grows? An optional `docs/reviews/INDEX.md` or per-thread index files would make 10 same-day reviews readable as a coherent thread rather than a flat list.

### Two activation checklists now coexist

The original 11-condition checklist (now in `desktop_traversal_enablement_sequence.md`) and the newer endpoint enablement readiness checklist (in `desktop_traversal_endpoint_enablement_readiness.md`) overlap but aren't identical. The endpoint readiness doc is finer-grained — it adds endpoint-test categories (success, unavailable, authorization failure matrix, helper-output failure, narrowing/revocation) that the 11-condition checklist doesn't decompose. Two artifacts both serving as the activation gate is a small drift risk.

Suggested resolution (low priority): the endpoint-readiness doc should reference the 11-condition checklist explicitly, and the enablement-sequence checklist should reference the endpoint-readiness doc as the operational expansion. Each layer cites the other so a reader can move between strategic-level and operational-level activation criteria without losing the relationship.

### Future-prefixed artifact decisions still pending per-item

The 2026-05-08 review and the addendum on Pass 1 both flagged this. Codex's narrowing was correct — per-item dispositions, not a sweep — but no per-item dispositions have been recorded yet. The artifacts in active use:

- `validateFutureDesktopInspectionResultWithTraversal` (thin delegate; safe to retire when no callers)
- `validateFutureDesktopTraversalOutput` (still load-bearing as helper-output gate)
- `assertFutureDesktopTraversalHelperOutput` (still load-bearing)
- `docs/schemas/future-desktop-inspection-result-with-traversal.schema.json` (historical context now)

When the activation slice lands, the per-item disposition of each is a natural follow-up. No action needed before then.

### `runInternalDesktopTraversalRequest` test coverage is dense; endpoint coverage isn't yet

The pipeline has 241 lines of test coverage (`test/desktopTraversalPipeline.test.js`). The endpoint hard-refusal tests are tight. But the endpoint *success* and *unavailable* response-shape assertions don't yet exist as live assertions — they exist as fixture entries currently asserted to be hard-refused. The endpoint-readiness doc names them as "active assertion pending." That's correct posture for now, but it means the activation commit will need to land both the endpoint behavior change *and* a meaningful expansion of `test/app.test.js` in the same change. Worth being clear in the activation slice that those are coupled.

---

## Strategic Observations

### Review-driven implementation is now the project's normal mode

Pass 1 described this as an unusual workflow. After this range, it's normal. Nine per-slice Codex reviews in one day, each preceding or immediately following its implementation commit, demonstrates the pattern is now standard practice for activation work. The implementation guide should probably acknowledge this — section the disabled-first capability pattern with a note that **for high-risk activation slices, write a review before each gate transition, not just at the end**. The pattern Pass 1 suggested capturing now has enough evidence to be promoted.

### The activation slice is one or two commits away

Reading the endpoint readiness doc, what remains is:

1. Add endpoint-level tests for helper-output failure and narrowing/revocation paths (one slice)
2. Replace `rejectUnsupportedDesktopTraversal` with the traversal validator and internal pipeline call (one slice — the activation itself)
3. Final review immediately before activation

Compared to where the project was when escalation_and_planning landed in early May, that's an extraordinary amount of disciplined groundwork compressed into a few days. Worth noting because it raises the bar for what *"is this capability ready to activate?"* should look like for future capabilities (remote planning, desktop text, audio, etc.).

### Per-thread review index is now overdue

With 10+ reviews on traversal activation alone, the reviews folder is starting to need an index that's organized by thread, not just chronologically. This is the kind of thing that's easy to defer but compounds — by the time desktop text or remote planning starts following the same pattern, the reviews folder will have ~30+ files and no thread-level navigation.

---

## Closing

The work in this range is the activation discipline at full operational maturity. Public endpoint still fail-closed; internal pipeline complete and tested; helper layer active; endpoint readiness doc in place; per-slice reviews tracking each gate transition. The activation slice itself is now well-scoped and bounded.

The minor items above are tightening, not gaps. The thread is one or two commits from completing safely.

---

## Next Review Trigger

Run another review after any of:

- the endpoint helper-output-failure and narrowing/revocation cases land (the slice before activation)
- `desktop_traversal_not_implemented` is replaced (the activation slice itself — and likely the slice that warrants the most careful review pass)
- a per-thread review index is added to `docs/reviews/`
- a different deferred capability (remote planning, desktop text) starts following the same pattern at scale

---

## Addenda

If this review needs follow-up commentary — a response from another reviewer, an action
disposition, a refinement, or an implementation update — append a new dated section at the bottom
of this file rather than editing the body above. See
[README.md § Addendum Convention](./README.md#addendum-convention) for the format.

---

## Addendum - 2026-05-10 - Codex Status Update After Two Later Commits

**Reviewer:** Codex
**Context:** This review covers `0028690..6d61e28`. Two later commits now change the disposition of
some findings:

- `80c3c0f` - `Extend traversal endpoint activation cases`
- `fd94846` - `Review traversal endpoint enablement`

### Disposition Updates

The review remains accurate for its stated range, but several "next" observations are now partially
stale:

- Helper-output-failure and narrowing/revocation fixture coverage has landed. The endpoint
  activation fixture now includes success, unavailable, authorization failures, request-validation
  failure, helper-output validation failure, and module narrowing/revocation paths.
- The final pre-activation review has landed in
  `docs/reviews/2026-05-09_final_traversal_endpoint_enablement_review.md`.
- The public endpoint still hard-refuses traversal with `desktop_traversal_not_implemented`; no
  endpoint behavior has been activated yet.
- The next implementation slice remains endpoint activation: replace the hard refusal only in the
  same slice that converts the fixture from hard-refusal assertions to active endpoint assertions.

### Remaining Actionable Items

The review-thread index recommendation remains useful but is not blocking endpoint activation. The
review density is now high enough that a future `docs/reviews/INDEX.md` or per-thread index would
reduce navigation cost for future reviewers.

The two-checklist concern is mostly mitigated. `desktop_traversal_enablement_sequence.md` now links
to `desktop_traversal_endpoint_enablement_readiness.md` as the endpoint-level coverage map. A reverse
link from the endpoint readiness doc back to the higher-level activation checklist would be a small
documentation tightening item, not an activation blocker.

Future-prefixed artifact disposition remains deferred. Keep the current per-artifact policy:

- preserve compatibility delegates while callers still rely on them
- keep future-prefixed schemas/fixtures where they preserve historical migration context
- rename or retire only when a stable non-future surface exists and tests prove the old name is not
  load-bearing

### Current Gate

No additional review-only work is required before attempting endpoint activation. The activation
slice must still preserve:

- malformed Rust traversal args emit no stdout
- default desktop inspection validation remains closed to traversal
- traversal responses use only the traversal-authorized schema path
- authorization failures happen before helper invocation
- helper-output validation failures happen before response attachment and provenance append
- traversal provenance remains summary-only

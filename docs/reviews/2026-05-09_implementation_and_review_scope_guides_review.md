# Implementation Guide and Component Review Scope Review — 2026-05-09

**Date:** 2026-05-09
**Scope:** Review of the two new steering docs added in `7c7ef08` — `docs/implementation_guide.md` and `docs/component_review_scope.md`
**Reviewer:** Claude (Opus 4.7)
**Commit range:** `6f753f0..7c7ef08`

---

## Sources Reviewed

Documents read in full:

- `docs/implementation_guide.md` (new, 180 lines)
- `docs/component_review_scope.md` (new, 298 lines)

Cross-referenced against:

- `config/` directory listing
- `src/` directory listing
- `AGENTS.md` (modified to reference both new docs)
- `docs/README.md` (modified to surface both new docs)
- `ROADMAP.md` (modified)

---

## Overall Assessment

The implementation guide is the doc the project has needed. It pulls together the recurring patterns — disabled-first capability scaffolding, validation before execution, provenance minimization, fail-closed-for-authority, the implementation smells — into one practice-pattern reference. It is the right level of abstraction: above thesis, below any single concept draft, and explicitly targeted at "how do we build new things here."

The component review scope is structurally right and serves a real need (scoping reviews to one or two components rather than always doing a full pass). It has a substantive accuracy problem with file paths that should be addressed before it is relied on.

---

## What's Sharp

### Disabled-first capability pattern as a reusable sequence

`implementation_guide.md` codifies the nine-step sequence:

1. Draft contract and threat/failure posture
2. Add request-shape validation while endpoint refuses
3. Add future fixtures or schemas marked non-active
4. Add runtime validators or disabled validation gates
5. Add overreach tests
6. Add provenance summary shape
7. Implement helper/provider behind tests
8. Keep public path fail-closed until activation gates complete
9. Activate only after the full chain aligns

This is exactly what the post-escalation-draft review flagged as worth capturing generically. The line *"this is the current traversal pattern and should be reused for remote planning, desktop text, audio, vision, browser automation, filesystem writes, shell execution, and actuation"* makes the reuse explicit. Future capability work should not re-derive this.

### Implementation smells list

Nine concrete smells — *"a future fixture silently becomes active contract,"* *"a denied request still writes success provenance,"* *"a doc review becomes the only place a new rule exists"* — that map directly to the failure modes the architecture is trying to prevent. Reviewers and implementers both benefit from having these named.

### Ethics-as-architecture table

The mapping from commitment (consent, disclosure, refusal, reversibility, non-extraction, agent care) to implementation pattern (capability checks, response metadata, stable refusal codes, narrowing modules, minimized payloads, designs where obedience isn't the only success) is the strongest one-page articulation of *"the politics is the architecture"* the project has produced. Useful for new contributors.

### Component review scope: structural shape is right

Twelve component sections plus a *Future High-Risk Areas* section. Each section has Primary paths / Supporting docs / Review focus. The framework is the right one for letting a reviewer scope a review without pretending to have read the whole repo. The *"Reviews, Migration, and Documentation Lifecycle"* component is itself a nice move — it acknowledges the steering surface as a thing that needs review when it changes.

### Future High-Risk Areas section

Listing durable memory, remote planning providers, desktop text inspection, STT/TTS, visual perception, browser automation, filesystem writes, shell execution, and desktop actuation as design-review-before-implementation territory keeps the deferred capabilities visible without pretending they're implemented. The five-bullet review focus (explicit design review, threat/failure updates, consent surface designed, irreversible actions previewed, disabled-first scaffolding) is the right gate.

---

## Worth Attending To

### File path references in `component_review_scope.md` do not match the repo

This is the most material finding. `component_review_scope.md` references file paths that don't exist as named:

**Config file mismatches (6):**

| Referenced as | Actual file | Notes |
|---|---|---|
| `config/harness.base.json` | `config/base-harness.json` | wrong filename style |
| `config/harness.modules.json` | `config/harness-modules.json` | period vs. hyphen |
| `config/capabilities.json` | `config/capability-catalog.json` | different name |
| `config/providers.json` | `config/provider-registry.json` | different name |
| `config/grants.readonly.json` | `config/grants.json` | different name |
| `config/runtime.profiles.json` | `config/runtime-profiles.json` | period vs. hyphen |

The actual repo uses `kind-name.json` with hyphens, consistently. The doc uses `name.kind.json` with periods, also consistently — but inconsistently with the repo.

**Source file mismatches (5):**

| Referenced as | Actual file | Notes |
|---|---|---|
| `src/policy.js` | (not present) | possibly aspirational extraction from `src/app.js` |
| `src/harnessModuleStore.js` | (not present) | possibly aspirational extraction |
| `src/providerRegistry.js` | (not present) | possibly aspirational |
| `src/grantStore.js` | `src/grants.js` | different name |
| `src/localModelClient.js` | `src/modelClient.js` | wrong name |

**Missing reference:** `src/cognitiveLoad.js` exists in the repo but no component section in the doc covers stewardship/cognitive-load. Worth either adding a component section or noting it elsewhere.

A reviewer following this doc as a starting point would not find the files at the listed paths. Two ways to resolve:

1. Update the doc to match current paths (least invasive)
2. Mark aspirational module splits as planned organization rather than current paths, and update the rest

Either is fine; the current state — mixing real and aspirational paths without distinction — is not.

### Implementation guide does not yet name pre-canonical "drafts/" promotion

The implementation guide describes documentation parity but doesn't address the moving target: when does a draft promote to canonical? The 2026-05-08 review flagged this as the next missing policy. A short paragraph in `implementation_guide.md` referencing the (forthcoming) draft-lifecycle policy would make clear that documentation parity includes the question of where the canonical doc *is*, not just whether it's updated.

### Component review scope assumes future architectural splits

References to `src/policy.js`, `src/harnessModuleStore.js`, `src/providerRegistry.js`, and `src/grantStore.js` describe a more decomposed module organization than currently exists. If those splits are planned, the doc could note the current source-of-truth files plus the planned splits. If not planned, the references should be removed and the actual paths used.

This is the same accuracy issue as the config paths but with a different shape — these may be intentional aspirational references. Worth being explicit either way.

---

## Strategic Observations

### These two docs together close the gap the post-escalation review flagged

The 2026-05-08 review flagged that Soma's emerging design language (capability enablement sequence, disclosure registry pattern, advisory triggers framing) was being re-derived across drafts. `implementation_guide.md` is now the place that captures it. The 2026-05-08 review also flagged that documentation surface was growing fast and would benefit from clearer scoping. `component_review_scope.md` is the place that addresses that. Both gaps closed by the same commit.

### The scope doc is positioned to evolve with the project

The component review scope is the right shape for a doc that will need updates as components emerge or split. Worth treating it as a living reference rather than a one-time artifact. When new src/ modules land, they should appear here; when the *Future High-Risk Areas* turn into actual components, they should migrate to numbered sections.

---

## Closing

Both docs are substantive contributions to the project's steering surface. The implementation guide does what it set out to do and reads cleanly. The component review scope is structurally right but has a path-accuracy problem that should be fixed before reviewers depend on it. Neither is a gap; one is tightening.

---

## Next Review Trigger

Run another review of these two docs after any of:

- a new src/ module emerges or an existing one splits
- the draft-lifecycle / promotion policy lands and the implementation guide should reference it
- a new component (durable memory, remote planning, desktop text) lands and the scope doc needs a numbered section
- an actual code review uses `component_review_scope.md` for the first time and surfaces friction

---

## Addenda

If this review needs follow-up commentary — a response from another reviewer, an action
disposition, a refinement, or an implementation update — append a new dated section at the bottom
of this file rather than editing the body above. See
[README.md § Addendum Convention](./README.md#addendum-convention) for the format.

---

## Addendum — 2026-05-09 — Codex Review Disposition

Reviewed the findings against the current working tree.

Actionable findings accepted:

- `docs/component_review_scope.md` should be updated to match current repo paths. The config
  mismatches are confirmed: the repo uses `config/base-harness.json`,
  `config/harness-modules.json`, `config/capability-catalog.json`,
  `config/provider-registry.json`, `config/grants.json`, and
  `config/runtime-profiles.json`.
- The source-path mismatches are also confirmed where the review names non-existent current files:
  `src/policy.js`, `src/harnessModuleStore.js`, `src/providerRegistry.js`,
  `src/grantStore.js`, and `src/localModelClient.js`. Current sources include
  `src/app.js`, `src/harness.js`, `src/harnessModules.js`, `src/grants.js`, and
  `src/modelClient.js`.
- `src/cognitiveLoad.js` and `docs/concepts/drafts/cognitive_load_stewardship.md` should be
  represented in `docs/component_review_scope.md` as a reviewable stewardship surface.
- `docs/implementation_guide.md` should briefly name the draft-to-canonical promotion concern so
  documentation parity includes where canonical posture lives, not only whether docs were updated.

Nuance:

- Some currently non-existent paths may reflect useful future module boundaries rather than simple
  mistakes. If those splits remain desirable, the component scope should list current primary paths
  first and mark planned splits explicitly instead of presenting them as files that already exist.

Disposition:

- Accept the review as accurate and useful.
- Follow up by tightening `docs/component_review_scope.md` and `docs/implementation_guide.md`.
- No code behavior changes are implied by this review; this is steering-surface cleanup.

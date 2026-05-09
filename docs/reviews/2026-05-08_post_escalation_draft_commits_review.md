# Post-Escalation-Draft Commits Review — 2026-05-08

**Date:** 2026-05-08
**Scope:** Review of the 53 commits between `6d6b3a0` (escalation and planning concept draft) and `ea931ec` (Rust traversal query boundary), covering remote planning Phase 1, bounded AT-SPI traversal preparation, desktop disclosure registry, desktop helper contracts, and overreach defense
**Reviewer:** Claude (Opus 4.7)

---

## Sources Reviewed

Commit range: `6d6b3a0..ea931ec` (53 commits, 52 files changed, 6987 insertions, 106 deletions).

Documents read in full:

- `docs/concepts/drafts/bounded_recursive_atspi_traversal.md` (new)
- `docs/concepts/drafts/desktop_disclosure_registry.md` (new)
- `docs/concepts/drafts/traversal_root_authorization.md` (new)
- `docs/concepts/drafts/escalation_and_planning.md` (modified — now Phase 1 partially implemented)
- `docs/security/threat_model.md` (modified — remote planning section)
- `docs/failure_modes.md` (modified — remote planning unsupported/invalid section)

Documents inspected by diff:

- `docs/concepts/drafts/desktop_helper_limit_contract.md` (new)
- `docs/concepts/drafts/desktop_helper_transport.md` (new)
- `docs/concepts/drafts/desktop_inspection_schema_validation.md` (new)
- `docs/concepts/drafts/desktop_request_contract_baseline.md` (new)
- `docs/concepts/drafts/desktop_root_ref_exposure.md` (new)
- `docs/concepts/drafts/desktop_traversal_enablement_sequence.md` (new)
- `docs/concepts/drafts/desktop_traversal_helper_contract.md` (new)
- `docs/concepts/drafts/desktop_traversal_provenance.md` (new)
- `docs/concepts/drafts/desktop_traversal_request_validation.md` (new)
- `docs/concepts/drafts/desktop_traversal_rust_implementation_plan.md` (new)
- `docs/concepts/drafts/desktop_capability_broker.md` (modified)
- `docs/concepts/drafts/focused_desktop_inspection.md` (modified)
- `docs/concepts/drafts/model_capability_evaluations.md` (modified)
- `docs/architecture/mvp_slice.md` (modified)
- `docs/operators.md` (modified)
- `docs/README.md` (modified — added new drafts to listing)
- New schema and fixtures under `docs/schemas/` and `docs/fixtures/`

Implementation files inspected by diff: `src/app.js`, `src/desktopBroker.js`, `src/desktopInspectionSchema.js`, `src/escalationTriggers.js`, `src/desktopDisclosureRegistry.js`, `src/desktopTraversalOutput.js`, `src/desktopTraversalProvenance.js`, `src/desktopTraversalRequest.js`, `src/cli.js`, `src/capabilityEval.js`, plus matching tests.

---

## Overall Assessment

The work in this range is rigorously disciplined and aligned with the project's stated principles. Two major threads (remote planning Phase 1 and bounded AT-SPI traversal preparation) advanced concurrently, both following the same pattern: design and document the contract first, build the validators, write the tests, then enable behavior behind those gates. The implementation order has been load-bearing throughout — schema and validator before helper changes, request validation before runtime, overreach rejection before any traversal output is accepted.

Three contributions stand out as genuinely original to Soma rather than borrowed from broader literature:

1. **The desktop disclosure registry** — a novel mechanism for bounding traversal roots to objects Soma already disclosed in the current process. This addresses a real attack surface that mainstream agent harnesses do not address.
2. **The traversal-shaped helper-overreach defense** — Soma rejects traversal output now even though traversal is not implemented, so a misbehaving helper cannot smuggle in expanded fields under a future-shaped envelope.
3. **The escalation-trigger families as advisory metadata, not decisions** — a careful epistemic posture given how poorly small-model self-confidence is calibrated.

---

## What's Genuinely Sharp

### Implementation order discipline

The traversal work follows an explicit ordering:

1. Add request validation while keeping traversal disabled.
2. Extend the JSON schema with future traversal definitions.
3. Extend the runtime validator to accept only the bounded traversal shape.
4. Add passing and failing validator fixtures.
5. Add provenance summary fields without storing traversal trees.
6. Implement the helper traversal path behind the already-tested contract.

Looking at the commit sequence, this ordering was followed faithfully. Helper-side Rust changes (`Add Rust traversal query boundary`, `Add Rust in-memory traversal builder`, `Add Rust traversal output builder`) come *after* the Node-side validator, schema, and overreach tests. That's the discipline that makes the trust boundary stable: Node learns to reject malformed traversal output before any helper produces it.

### Disclosure registry as the answer to model-supplied root paths

The mechanism is conceptually clean:

- **Problem:** A bounded inspection that accepts arbitrary `service`/`path` from a model becomes an ambient desktop graph access surface.
- **Solution:** A traversal root must resolve to an object already disclosed in the current Soma process, identified by an opaque `root_ref` rather than raw paths.
- **Implementation boundary:** Node owns the registry. The Rust helper does not read or write registry state. MCP adapters cannot bypass it.

This is the same architectural shape as capability-bounded delegation: *we will not expand from what we already authorized*. Applied to AT-SPI roots instead of plan steps, but the same insight. It is also genuinely novel — not present in the desktop-automation literature this reviewer has surveyed.

### Threat model and failure modes updates

The threat model now explicitly names planner-influenced execution paths, planner over-broad context, and planner-generated disabled-capability requests. The current-controls list accurately reflects what has been implemented (base harness disables `model.remote.plan`; no provider registered, so the capability is unsupported rather than requestable; capability evals cover the unsupported posture). The residual-risk list is honest about what remains: no payload minimizer, no plan validator, no provenance event set yet.

The failure-modes addition is similarly precise: do not route when unsupported, do not convert unsupported claims into proposals, do not auto-retry, treat any boundary crossing as irreversible.

These updates are exactly the discipline AGENTS.md asks for ("Update threat model and failure modes" in the Add A Capability checklist). The capability addition came with the threat-model update in the same commit range.

### Phase 1 escalation triggers

The Phase 1 work surfaces triggers from local-only assessment (uncertainty, complexity, capability_gap, capability_validation_failure) without remote routing, grant creation, or activation. The doc explicitly names trigger heuristic limits: *"`uncertainty` is triggered by explicit uncertainty phrases. It will miss confident wrong answers and may over-trigger on harmless hedging."* That epistemic honesty is the right posture for a system that will eventually be making escalation decisions on real tasks. Calling triggers "advisory metadata, not decisions" preserves the principle.

### Overreach rejection before opening

The validator rejects traversal-shaped payloads that include names, descriptions, text, states, actions, screenshots, image references, pointer state, or keyboard state — *while traversal is still disabled*. A future helper that tries to smuggle expanded fields under a traversal envelope will fail closed before any provenance is recorded. This is the right ordering: tighten the gate before opening it.

### Documentation density of fixtures and schemas

`docs/fixtures/future-*` and `docs/schemas/future-*` is a clean naming convention for design artifacts that exist for testing and contract specification but are explicitly not active. The runtime validator rejects them; the disabled traversal-aware gate accepts the valid case for tests. This separation is well-handled.

---

## Worth Attending To

### Documentation surface is growing fast

Twelve new draft docs in this range plus modifications to several existing ones. Several are very granular:

- `desktop_helper_limit_contract.md`
- `desktop_helper_transport.md`
- `desktop_request_contract_baseline.md`
- `desktop_traversal_enablement_sequence.md`
- `desktop_traversal_helper_contract.md`
- `desktop_traversal_provenance.md`
- `desktop_traversal_request_validation.md`
- `desktop_traversal_rust_implementation_plan.md`

Each has a discrete purpose, but the cross-reference density is high. When traversal lands and these drafts converge, several may need to be retired or merged into canonical docs. Worth being explicit about retirement policy: which of these should disappear when their content is folded into `desktop_capability_broker.md` or `bounded_recursive_atspi_traversal.md`, which should be promoted to canonical, and which are scaffolding that becomes obsolete.

### User-facing surface for escalation triggers is implicit

`escalation_and_planning.md` says Phase 1 "surface escalation triggers" but the implementation in this range stops at metadata-only provenance recording. There is no user-facing path that says *"Soma considered escalation here but had nowhere to go."* The CLI exposes `--assess-escalation`, which is operator-facing, not participant-facing.

When a participant asks the local model something the model is uncertain about, do they see the trigger? Or only an operator who runs the right CLI command? Worth deciding before Phase 2, because the participant-facing surface is where the discipline of "do not escalate silently" actually lives.

### TTL choice on the disclosure registry

The registry's 10-minute TTL is documented but unjustified. AT-SPI references can become stale as applications change, which argues for short TTL. Long sessions where a participant returns to the same task argue for longer. Worth either citing the basis for 10 minutes or noting it as "MVP default; revisit after first traversal slice."

### Granular drafts vs. canonical promotion

Several of the new drafts are tightly coupled and read together. The set covering desktop helper transport, request contract baseline, helper limit contract, and request validation could plausibly be one operationally-coherent doc rather than four. Splitting now is fine for working through design; before promotion to canonical, consider whether the audience (future contributors and AI assistants) is better served by one consolidated `desktop_capability_broker_contracts.md` than by four separate references.

### "Future" naming and post-implementation cleanup

The `future-*` fixtures and schemas are clearly named. The implicit policy is that they get renamed (or removed) once traversal lands. Worth making that policy explicit somewhere — probably in `migration.md` or a small note in `bounded_recursive_atspi_traversal.md`. Otherwise these artifacts may accumulate as historical scaffolding.

---

## Strategic Observations

### The pattern is generalizable

The two-thread discipline observed here — design contract → write validators → reject overreach → enable carefully — is repeating from desktop inspection through traversal. It will repeat again for `desktop.inspect.text`, eventually for actuation, and for remote planning. Worth capturing the pattern itself somewhere as a generic *capability enablement sequence* rather than re-deriving it for each capability area. The traversal enablement sequence draft is one instance; the generalized form would prevent each new capability from rediscovering the order.

### Soma's contributions to the literature are accruing

Three from this range alone — the disclosure registry, the traversal-shaped overreach defense, and the advisory-not-decision framing for escalation triggers — are not in the agent-harness literature this reviewer has surveyed. None is paper-length on its own, but the set is starting to form a coherent design language. At some point the team may want to consolidate these into a position paper or capability-enablement pattern document that future contributors can reference as a single artifact rather than reconstructing across drafts.

### The Phase 1 escalation work means the draft can graduate

`escalation_and_planning.md` was a draft. Phase 1 has now partially landed in implementation, with tests, provenance, capability eval coverage, threat model and failure-modes updates. The draft is no longer purely speculative for its first phase. Worth considering whether the Phase 1 portion should be promoted out of `drafts/` into a canonical concept doc, with the still-undelivered phases (Phase 2 catalog vocabulary already done; Phase 3 remote bridge; Phase 4 scope expansion) remaining draft. The migration policy from drafts to canonical is not yet documented; this would be a useful first case.

---

## Closing

This range is the kind of work that justifies the documentation investment. Each new capability area extends Soma's stated discipline rather than carving exceptions to it. The novel contributions (disclosure registry, traversal-shaped overreach defense) are coherent expressions of the architecture's central commitment: *we will not expand from what we already authorized; the gateway, not the helper or the model, is the authority boundary.*

The minor items above are tightening, not gaps. The work is in good shape.

---

## Next Review Trigger

Run another review after any of:

- bounded AT-SPI traversal opens (traversal request validator no longer returns `desktop_traversal_not_implemented`)
- a `model.remote.plan` provider is registered
- the first capability migrates from `drafts/` to canonical `concepts/`
- `desktop.inspect.text` design starts
- the disclosure registry policy needs revision based on real traversal use
- the documentation surface reaches a point where consolidation becomes necessary

---

## Addendum: Action Disposition — 2026-05-09

Follow-up review by Codex identified two findings that should be narrowed rather than accepted as
written, and several findings that are directly actionable.

### Actionable Items

1. **Draft consolidation and retirement policy**

   Accept. The desktop draft surface is intentionally granular while traversal is being designed,
   but the project needs a rule for what happens when a draft becomes implemented behavior. Add a
   migration or documentation-lifecycle policy before promoting traversal or escalation docs to
   canonical status.

   Rationale: without a retirement policy, future contributors and agents may treat superseded
   scaffolding as active contract.

2. **Future fixture/schema cleanup policy**

   Accept. `future-*` fixtures and schemas are useful while a capability is disabled, but they need
   an explicit transition path once that capability opens.

   Rationale: future artifacts should either become active contract fixtures, remain historical
   design records, or be removed. Leaving the status implicit creates avoidable ambiguity.

3. **General capability enablement sequence**

   Accept. The traversal sequence captures a reusable pattern:

   ```text
   design contract -> validators -> overreach rejection -> provenance shape -> implementation -> activation
   ```

   Rationale: remote planning, desktop text inspection, and eventual actuation should not
   rediscover this sequence independently.

4. **Canonical promotion candidate for escalation Phase 1**

   Accept with sequencing. Phase 1 has implementation, tests, provenance, and threat/failure-mode
   coverage, so it is a reasonable first candidate for draft-to-canonical promotion after a
   migration policy exists.

   Rationale: promotion should not precede the policy that explains how draft material is split,
   retired, or preserved.

### Findings To Refine

1. **Escalation trigger user-facing surface**

   Refine, do not accept as written. The review says there is no user-facing path, but `POST /chat`
   returns `escalation_assessment` when `assess_escalation=true`, and the CLI exposes
   `--assess-escalation`. Tests cover this path.

   The actionable version is narrower: escalation assessment is opt-in and not yet part of the
   default participant-facing flow. Before Phase 2, decide whether and when local chat should
   surface escalation triggers without requiring a separate operator-style flag.

   Rationale: the current implementation does surface the information, but the default interaction
   design is unresolved.

2. **Disclosure registry TTL**

   Refine, do not accept as written. The review says the 10-minute TTL is unjustified. The
   rationale class is documented in `desktop_disclosure_registry.md`: AT-SPI references can become
   stale as applications change. What remains unjustified is the exact 10-minute value.

   The actionable version is: keep 10 minutes as an MVP default for now, but document it as a
   tunable policy and revisit after the first real traversal use.

   Rationale: the current value is defensible as a conservative starting point, but not yet
   evidence-based.

### Findings To Disregard

None of the review findings should be fully disregarded. Two should be narrowed as above; the
remaining findings are valid follow-up work.

# Escalation And Planning

Status: draft concept, Phase 1 partially implemented

Soma should remain useful as tasks scale beyond a small local model's capability without surrendering local sovereignty in the process. This draft names the pattern Soma should follow for that escalation: a local-first model handles what it can, escalates to a remote planner only when the task exceeds local capability, and executes the planner's plan only through the user's active harness.

The pattern combines two existing research traditions — confidence-based cascade routing and hierarchical orchestrator-worker delegation — and adds a Soma-specific constraint: **the planner can propose; only the harness can grant authority**. The planner's plan is bounded by the active harness; activation still goes through Soma's policy gateway.

## Core Rule

**A planner may propose actions against the active harness. A planner may not escalate the harness.**

A remote planner may receive a task, the active harness manifest, and the local model's preliminary attempt. It may return a structured plan describing actions and the order to take them. Each step in that plan must be validated against the active harness before execution. Steps that fail validation are elided, not escalated; the user sees them as elided, with reasoning if available.

## Why This Pattern

A pure local-only posture breaks down on hard tasks. Small models can fail silently or produce confidently wrong answers, and the user has no path to a more capable model under bounded conditions.

A pure remote-everything posture breaks Soma's local-first commitments and routes intimate context to providers Soma cannot bound.

This pattern preserves local sovereignty in the common case (the local model handles it), opens explicit escalation only when the task genuinely exceeds local capability, and bounds remote influence through the harness rather than through trust in the remote service.

It also reflects a current empirical finding: rigid orchestration scaffolding (LangGraph, CrewAI, Google ADK, OpenAI Agents SDK and similar) tends to underperform single-context in-context prompting for procedural tasks. See *In-Context Prompting Obsoletes Agent Orchestration for Procedural Tasks* (Dennis, Diamond, Patil, Shabahang, and Guo, 2026; [arXiv:2604.27891](https://arxiv.org/abs/2604.27891)). The cost of forcing a model through a framework's vocabulary and pre-decomposed structure often exceeds the benefit of the framework's coordination. Soma should learn from this: the orchestration layer Soma cares about is *security and consent*, not *workflow*.

## Scaffold The Boundary, Not The Reasoning

Soma should not become a workflow engine that forces models to coordinate through framework-shaped scaffolding. Soma should be a policy and capability layer that the model executes within.

In practice:

- The local model receives the user's request and the active harness manifest.
- The local model reasons in one continuous working context.
- Each capability action it proposes goes through Soma's policy gateway.
- The gateway approves, denies, or elevates to a user proposal.
- Soma does not inject framework vocabulary ("you are a planning agent in a multi-agent system...") into the model's context.
- Soma does not pre-decompose the task into framework-shaped subtasks.

When escalation to a remote planner is required, the planner sees the user's task and the active harness, and returns a plan. The plan is constrained to the harness; the local model executes the validated steps. The planner does not coordinate the local model's reasoning; the planner constrains the local model's options through its bounded plan.

## Escalation Triggers

Escalation should not rely on a single signal. Model self-confidence is poorly calibrated, and a
threshold over self-reported confidence alone tends to escalate confidently-wrong answers and
under-escalate genuinely hard tasks. Escalation should instead be considered when any combination
of the following is true:

- the user explicitly requests a more capable model
- the local model surfaces an uncertainty or "I am out of depth" signal in its output
- the local model's proposed action fails capability validation in a way that suggests the
  approach itself is wrong, not just disallowed
- the task requires a capability the active harness does not currently support, even with a
  proposal flow
- task-complexity heuristics flag the task as outside the local model's reliable range (length,
  ambiguity, multi-step structural requirements, domain mismatch)
- an eval-backed threshold for the task class indicates likely local failure (where such evals
  exist)

Each of these signals on its own is weak. The combination is the trigger. Soma should also default
to *not* escalating silently: when a trigger fires, the user is shown the choice rather than
having the escalation happen automatically.

Current scaffold:

- `POST /chat` accepts `assess_escalation=true`.
- `npm run cli -- chat "..." --assess-escalation --json` exposes the same path.
- Soma performs a local-only assessment using the user message, model response, and capability
  view.
- Current trigger families are `uncertainty`, `complexity`, and `capability_gap`.
- If triggers fire, Soma records a metadata-only `model.local.escalation_proposed` provenance
  event.
- No remote routing, provider registration, grant creation, capability activation, durable memory
  export, or raw task payload provenance is performed.

## The Pattern

```text
user request
  -> local model attempts task with harness as context
      -> local model produces answer plus signals (uncertainty, capability gaps,
         complexity flags)
  -> Soma evaluates escalation triggers
  -> if no triggers fire: return answer
  -> if any triggers fire: surface escalation choice to user
      -> escalation requires `model.remote.plan` to be active, or requestable
         through a registered provider and then explicitly approved
      -> escalation requires explicit per-task user consent
      -> user-approved escalation sends to remote planner:
          - user task (minimized)
          - active harness manifest
          - local model's attempt and signals
      -> remote planner returns structured plan
      -> Soma validates each plan step against active harness
      -> validated steps queued for local execution
      -> elided steps shown to user with reason
      -> local model executes validated steps under capability gates
  -> result returned with disclosure of escalation, plan summary, elisions
```

## What The Planner Receives

The planner should receive enough context to plan against the harness, and no more.

Required:

- the user's task (minimized; sensitive context elided unless explicitly granted)
- the active harness manifest (so the planner knows what is allowed)
- the local model's attempt and uncertainty signal (so the planner can build on it rather than start from scratch)

Excluded by default:

- raw user history
- durable memory contents
- desktop-inspection results unless the task requires them and the user has granted the relevant capability
- file contents unless explicitly part of the task
- session conversation outside the current task

The minimization principle applies: the planner sees what is necessary to plan, no more. Information sent across the local/remote boundary is a form of disclosure and should be tracked as such.

## Plan Validation Contract

Every step the planner returns must be validated before local execution.

Each plan step should declare:

- intended capability key (must reference an exact catalog entry)
- intended scope
- inputs and arguments
- expected outputs
- reversibility class
- fallback if denied

Validation checks:

- capability key exists in the catalog
- capability is currently active in the harness, or eligible for proposal
- inputs and outputs match capability schema
- scope is within allowed range for the active harness
- reversibility class matches the actual capability
- the plan does not chain through capabilities the harness has disabled

Failed validation results in elision, not silent failure. The user sees what was elided, the reason, and can choose to grant a missing capability through the existing capability proposal flow.

## Provenance

Escalation should produce a tightly coupled set of provenance events:

- `model.local.escalation_proposed` — local model surfaced low-confidence answer; escalation considered
- `model.local.escalated_to_remote` — user approved escalation; task and harness sent to planner
- `model.remote.plan.received` — planner returned a structured plan
- `model.remote.plan.steps.elided` — steps removed during validation; reasons recorded
- `model.local.executed_under_plan` — each plan step executed locally
- `model.remote.plan.completed` — plan execution concluded

Provenance should record metadata (capability keys, decision points, counts, identifiers) but should not duplicate plan contents or task payloads verbatim. Sensitive context should be referenced by id where possible.

## Capability Vocabulary

Proposed addition:

- `model.remote.plan` — escalate a task to a remote model for structured planning; the plan is validated against the active harness before any step executes. This capability is distinct from `model.remote.chat` because the planner influences local execution paths, not only the user-facing response. It is disabled by default and requires explicit grant.

A future `model.local.escalation_proposal` capability could gate whether the local model is allowed to *surface* an escalation request in its output. Worth considering only if the broader pattern lands and unguarded escalation prompts cause prompt-fatigue or unwanted normalization. For now, escalation prompts are governed by the gateway around `model.remote.plan` itself.

**Provider registry note.** The capability is cataloged as disabled but has no provider registry entry yet, because no remote-planner provider exists in Soma. Until a provider is registered (under a `soma.model.remote.plan.v1` contract), the capability view will classify `model.remote.plan` as *unsupported* rather than *requestable*. That is the correct posture for now — proposals against an unsupported capability should be stored as design input, not as live escalation paths. Adding a provider entry should be deliberate and accompanied by a threat-model update covering the chosen remote endpoint.

## Interaction With Existing Concepts

- **Capability Proposals** (`capability_proposals.md`): a remote planner's plan step that requires a disabled capability should be surfaced as a capability proposal, not silently denied or auto-elevated. Approval still requires a separate decision.
- **Capability Catalog and Providers** (`capability_catalog_and_providers.md`): the planner's plan must reference exact capability keys. Symbolic or category-level requests are not validatable.
- **Memory Control Surface** (`memory_control_surface.md`): the planner does not receive durable memory unless the task explicitly authorizes it; session context is minimized.
- **Cognitive Load Stewardship** (`cognitive_load_stewardship.md`): escalation should not happen silently when the participant appears overloaded. Soma should defer or summarize the escalation choice rather than proceeding to remote routing under pressure.
- **Delegated Choice and Deliberation** (`delegated_choice_and_deliberation.md`): escalation is not a delegated choice. It is always at least Tier 2 (recommend, require confirmation), because remote disclosure is a point of no return for what the planner now knows.
- **Reversibility and Disclosure** (`reversibility_and_disclosure.md`): once context crosses the local/remote boundary, the disclosure cannot be reversed. Escalation should require heightened consent and minimization.

## Phased Implementation

Phase 0 (current): no escalation. Local model only.

Phase 1: surface escalation triggers from local model output and Soma-side heuristics — uncertainty
signals, capability-validation failures, missing-capability flags, complexity flags. No remote
routing yet. Define the `model.local.escalation_proposed` provenance type. Add a user-facing
surface that shows when triggers fired so the user can decide whether to invoke a more capable
model out-of-band. Treat model self-confidence as one signal among several rather than the sole
trigger.

Current Phase 1 implementation supports opt-in chat escalation assessment with local heuristic
trigger families and metadata-only provenance. Capability-validation-failure triggers and richer
task-class thresholds are not implemented yet.

Phase 2: capability vocabulary added in disabled state. `model.remote.plan` and related provenance types defined in the catalog. No remote bridge yet.

Phase 3: remote bridge implementation under explicit grant, with plan validation. First implementation should use a single approved remote endpoint, require per-task user consent, and run end-to-end against a small synthetic plan before any plan derived from real user context.

Phase 4: scope expansion (additional remote endpoints, longer scopes, integration with public-utility AI bridges as those become real) under explicit design review.

## Non-Goals

- no remote routing without explicit per-task user consent
- no capability widening through approved plans
- no execution of plan steps that fail validation
- no opaque plan execution (all steps should be inspectable)
- no orchestration framework dependencies
- no scaffolding-mediated reasoning (the model reasons; Soma gates)
- no inferred escalation from conversation context alone
- no use of durable memory in remote planning without explicit grant
- no automatic re-escalation if a plan step is denied; the user remains in the loop

## Principle

Trust the model to plan. Do not trust it to enforce.

Soma's job is the second half. The harness governs outputs and capability use, not the model's reasoning process. Constrain what is *allowed*, not how the model *thinks*.

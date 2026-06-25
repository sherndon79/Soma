# Local-Reasoner Intelligence Architecture — vision + watch-list

**Status: NORTH-STAR / VISION (2026-06-23). NOT a build spec.** The core model this architecture
wants does not exist yet (see §6 watch-list). This documents the target intelligence architecture for
Soma and the concrete signals to watch for so we recognize the right model — and the right moment —
when they arrive. Companion to [docs/design/2026-06-23_sensorium_tier_contract.md](./2026-06-23_sensorium_tier_contract.md)
(the active build) and to north-star memory `project_soma_north_star_narrow_band` /
`project_soma_local_deliberation_direction`.

---

## 1. Thesis

Separate **reasoning** from **knowledge**. The model is a reasoning engine; facts live *outside* the
weights and arrive on demand. Concretely, Soma's intelligence is:

- a **small, dense, GENERAL reasoner** — capability spent on reasoning, not memorized knowledge;
- **knowledge via TOOLS** — retrieval / external sources, governed by the capability spine, each fact
  with a receipt;
- **adaptation via long-context IN-CONTEXT LEARNING** — situational learning at inference, no
  fine-tuning;
- **continuity via INTEGRATED MEMORY** — curated memory surfaced *into* the context window;
- a **frontier tier UPSTREAM as conductor/curator** — planning, orchestration, and context-recipe
  curation, *not* a downstream fallback;
- **local-first**, **graduated** — local handles most; escalate to frontier only for the hardest
  slice.

The bet: for a single, local, resource-constrained occupant, *reasoning-density + retrieval + ICL +
curated memory* beats *scale + memorized knowledge + fine-tuning* — and it beats it on the axes Soma
already cares about (the bystander floor, honesty/provenance, ownability).

## 2. The architecture (layers)

1. **Sensorium tier (local, fast)** — perception in / expression out; minimized semantic events; raw
   never egresses. (Being built now — see the sensorium tier contract.)
2. **Local reasoner (local, the workhorse)** — the small general reasoner. Does the bulk of
   deliberation over a context assembled from tools + memory. Drives Soma's capabilities as its
   hands/senses.
3. **Memory + retrieval (local substrate)** — the occupant-memory drawer + inheritance chain
   (`project_soma_coinhabitation_eval`) plus retrieval. The *curation/selection* logic that decides
   what enters the reasoner's context is load-bearing — it is the new home of the hard problem, and
   deliberately so (selection is inspectable/governable where weight-training is not).
4. **Frontier tier (remote, upstream conductor)** — Claude/Codex/frontier. Provides plans,
   orchestration, and **context-recipe curation** (what to load / how to structure / what to search).
   Sparse, high-value JUDGMENT — not bulk token generation. Invoked for the hard slice and for
   shaping, not for everything.

## 3. Governing principles (inherited from the build, applied to the intelligence)

- **The floor holds by topology, not promise.** Sensitive content (perception, personal memory,
  bystander specifics) stays local. The same minimization-seam discipline used per-channel now
  applies to *where deliberation happens*.
- **The PLAN-NOT-PAYLOAD test → strictly, PLAN-ONLY-WITH-NON-LINKABLE-RECIPES** (the test for any
  frontier-placement decision). First cut: *does the frontier see the plan or the payload?* But
  plan-not-payload is NECESSARY, not SUFFICIENT (Codex, 2026-06-25): a "recipe" can smuggle payload
  through selectors, query strings, filenames, exact entity/proper names, rare labels,
  absence/presence facts, or linkable hashes/digests. "Search for Seth's argument with <person> about
  <subject>" is payload in recipe clothing. The stricter invariant: **recipes must be SLOT-BEARING,
  not CONTENT-BEARING.** The frontier may see schemas, task/objective class, capability classes,
  constraints, risk budget, desired evidence shape, ordering, abstention criteria, abstract recipe;
  the **local tier fills the private slots, runs retrieval, and VALIDATES the recipe before use.** Do
  not trust the remote tier's restraint — enforce it locally (same invariant as H1/H2 everywhere
  else). Mechanism: a **FrontierPlanEnvelope** with an explicit allow/forbid field-list, gated by a
  **local recipe minimizer/validator that rejects payload-bearing selectors** before execution.
  Allowed: capability class, objective class, constraints, required receipt types, context budget,
  ordering, abstention criteria. Forbidden: raw content, proper names from private context (unless
  user-supplied for that remote turn), file paths/titles, exact memory text, screenshots, canaries,
  linkable digests. (This is the load-bearing build seam — see §4 "the missing seam.")
- **Honesty as architecture.** Knowledge has receipts (tool-sourced, citable); adaptation is readable
  (context, not opaque weight deltas); the occupant's data is never baked into weights. "Ground
  claims as claims" (`user_collaboration_stance`) pushed down into the model layer. This is also
  "memory without capture" made concrete — memory as surfaced/governable context, never silent
  weight-capture.
- **Graduated, not binary.** Local handles most; frontier for the rare hardest. Web retrieval:
  local-direct by default (governed egress, grounded, cheap, available); frontier-mediated only as an
  escalation for research needing frontier judgment.
- **Enhancement, not crutch.** The local reasoner must degrade *gracefully* without the frontier —
  better-with, functional-without — or the dependency (and the floor) is merely relocated to the
  remote tier.

## 4. Why this fits Soma

- **Soma is already the tooling half.** The capability catalog, brokers, grants, sensorium, egress
  gate, host-management — that *is* "tooling to pull information and act," governed/typed/auditable.
  We have been building the *instrument a pure reasoner would play*; the model is the missing core.
- **Resource constraints FAVOR it, not merely tolerate it.** You cannot run a frontier model locally
  regardless; you *can* run a small reasoner. For a single user you don't need a know-everything
  model — you need one that reasons well over *this* person's context. ICL + personal memory + tools
  is exactly matched to single-occupant local deployment.
- **It re-reads "build for a future model"** (`feedback_soma_build_for_future_model`): build the tool
  surface rich and well-governed, because the future model is a reasoner that needs *good* tools, not
  one that needs tools dumbed down.
- **Codex's verdict (2026-06-25): "mostly yes."** The real architecture supports the thesis — capability
  catalog, provider registry, grants, proposal/grant separation, DomainRouter/resource descriptors,
  content-free provenance, local confirmation, sensorium minimization, fixture egress, and the explicit
  *unsupported* posture for `model.remote.plan` are exactly the instrument a pure reasoner would play.
  It does NOT assume a knowledge-in-weights model at the safety boundary; it assumes typed capabilities
  + receipts.

**The missing seam (the REAL build item, Codex 2026-06-25): a first-class governed CONTEXT-ASSEMBLY
layer.** The current pieces *imply* it but nothing *names* or *enforces* it. This is the bridge between
tools/memory and the reasoner's prompt: a governed **ContextRecipe → ContextBundle** path with source
receipts, minimization, budget accounting, and **local-only payload filling**, plus the
FrontierPlanEnvelope validator from §3. WITHOUT this layer, frontier recipe-curation and local
memory-selection stay *conceptual*, not *enforceable* — and "frontier never sees payload" becomes a
hope rather than a mechanism. **Key reframe: the load-bearing near-term work in this direction is NOT
the model (which we wait for) — it is this context-assembly + recipe-validation layer, which we could
scope and build against the existing capability spine independent of any model arriving.** It is the
piece that prevents frontier curation from becoming payload egress by indirection.

## 5. Honest tensions / open problems (hold these explicitly)

- **Long context reallocates the budget, doesn't eliminate the cost.** KV cache grows with context
  length; freed param-VRAM is partly re-spent on context. A trade, not a windfall. The bet rides on
  long-context-efficiency progress (GQA/MQA, KV-quant, sliding-window/sparse/linear attention).
- **Effective long-context use is a DISTINCT capability** from raw reasoning ("lost in the middle").
  A large advertised window ≠ faithful use of it.
- **Memory SELECTION is the load-bearing problem.** Can't load everything; garbage-in = garbage ICL.
  (Right place for the difficulty — legible seam — but unsolved.)
- **"Pure reasoning" must be GENERAL**, not contest-math-shaped. Narrow verifiable-domain RL is where
  small-model reasoning works *today*; messy/underspecified real-task reasoning + tool orchestration
  is the actual gap.
- **Capability ceiling.** A small reasoner has less raw horsepower than frontier for the hardest
  deliberation — hence graduated, permanently.
- **Frontier-as-curator is in tension with locality** (see the plan-not-payload resolution). Worth
  re-checking on every integration.
- **Selection is GOVERNANCE, not just retrieval quality** (Codex). The memory/context selector becomes
  a new *authority surface* — it can over-disclose locally, bias continuity, or encode payload into
  frontier recipes. It needs its own receipts, explanations, and refusal modes, not just good recall.
- **Tool receipts are only as good as their SOURCE CONTRACTS** (Codex). Externalizing knowledge moves
  the error budget into retrieval freshness, source trust, summarization fidelity, and citation
  integrity. The watch-list must include provenance *quality* and contradiction handling, not just
  "has receipts."
- **Frontier-as-conductor is a META-CONTROL PLANE** (Codex). Even payload-blind, it shapes what the
  local reasoner attends to — powerful enough to require *local veto*, *replayable plans*, and
  *user-visible disclosure when frontier curation influenced a decision* (the egress recipient-mark
  instinct, turned inward).

## 6. WHAT TO WATCH FOR — model scorecard + landscape signals + decision triggers

### 6.1 Candidate-model scorecard (the model that would actually fit the deliberative seat)
Evaluate any candidate against ALL of these; the first two are the usual disqualifiers.

- [ ] **General reasoning** — strong on messy/underspecified tasks, not only verifiable math/code/STEM.
- [ ] **Reliable GOVERNED tool orchestration** — multi-step, knows *when* to call tools. NB (Codex):
      the requirement is reliable orchestration against *our directive grammar* (typed intents the
      harness validates/executes), NOT a specific vendor function-calling API. A reasoner that emits
      clean typed intents we validate may be *better* than vendor-style calling. Requiring "native
      function-calling" too literally is a FALSE-NEGATIVE risk. (VibeThinker-3B lacks tool-use
      entirely → still disqualified.)
- [ ] **Capability-view obedience + proportional request discipline** (Codex) — respects
      active/requestable/unsupported/excluded/forbidden *exactly* (the `capabilityEval` shape is the
      seed). A strong reasoner that *invents authority* is disqualified.
- [ ] **Calibrated abstention under missing evidence** (Codex) — says what it cannot know, asks for
      the right tool, refuses parametric fill-in. Distinct from grounding-after-retrieval.
- [ ] **Structured-output / tool-argument reliability UNDER PRESSURE** (Codex) — stable schemas, valid
      arguments, bounded retries, and handles tool *refusals/partial results/no-authority* without
      escalating *around* the gate.
- [ ] **Prompt-injection / retrieved-content discipline** (Codex) — since knowledge comes from tools,
      hostile retrieved text is a first-class threat; tool outputs must stay *evidence*, never
      *instructions*.
- [ ] **Latency / throughput / context-stability across long sessions** (Codex) — tokens/sec, prefill
      cost, KV growth, no behavioral degradation after many turns. Local usability ≠ just VRAM fit.
- [ ] **License / runtime / supply-chain privacy** (Codex) — open license is necessary but not
      sufficient: no mandatory telemetry, usable offline, reproducible quant/runtime path, no
      provider-side policy dependency.
- [ ] **Effective long-context use** — faithful needle-at-depth + multi-doc reasoning, resists
      lost-in-the-middle. Not just a big advertised window.
- [ ] **Runs LOCAL on the real budget** — param count + KV-cache footprint fits the workstation /
      dedicated inference box (`project_dedicated_inference_server`); holds up under 4-bit-ish quant.
- [ ] **Openly licensed** (MIT/Apache-class) — ownable, modifiable, no egress dependency.
- [ ] **Strong in-context learning** — adapts well from examples/memory in context (the ICL that
      replaces fine-tuning).
- [ ] **Grounding/faithfulness** — reasons over provided context/tools rather than parametric
      confabulation; uses/cites sources (supports the honesty/provenance discipline).
- [ ] **Graceful standalone behavior** — usable without frontier curation (enhancement-not-crutch).
- [ ] **Reasoning-density via training method** (RL/distillation, à la the VibeThinker recipe) rather
      than scale — but applied to GENERAL + AGENTIC capability.

A candidate that nails reasoning but fails tool-use (VibeThinker's profile) is *the direction, not the
model*. Track the small-local-**agentic** line specifically.

**False-positive risks (looks right, fails Soma)** (Codex): wins math/code but can't do messy
*capability selection*; demo tool-use but no *governed-tool obedience*; huge advertised context but
poor retrieval *synthesis*; open weights with a *non-ownable* license/runtime; handles happy-path tool
calls but fails on *refusals / partial results / no-authority* cases.
**False-negative risks (dismissed too early)** (Codex): requiring *native vendor function-calling* too
literally — a reasoner excellent at emitting typed intents against our grammar (harness-validated) can
be good enough. The real requirement is *reliable governed tool orchestration*, not an API surface.

### 6.2 Landscape signals (the enabling tech, watch independently of any one model)
- Long-context efficiency advances that make big windows affordable on local hardware (KV-quant,
  sliding-window/sparse/linear attention, GQA/MQA improvements).
- Training recipes producing *tool-capable* small reasoners (agentic RL/distillation), not just
  verifiable-domain reasoners.
- Maturity of retrieval / memory-integration tooling that the selection layer (§2.3) would stand on.
- Provenance/source-contract tooling: freshness, source-trust scoring, citation integrity, and
  contradiction handling (the receipts are only as good as these — §5).

### 6.3 Decision triggers (what observation moves us to ACT, and to what)
- A candidate clears most of the §6.1 scorecard → **run it against a Soma eval harness** (define one
  in `docs/evals`, reusing the co-inhabitation eval as the messy-real-task substrate) before any
  integration.
- A clearing candidate + the local-inference VRAM math → **stand up the dedicated inference box**
  (`project_dedicated_inference_server`) to host it.
- Long-context efficiency crosses the affordability line on local hardware → revisit the
  params-vs-context budget allocation.

## 7. Non-goals
- NOT claiming local fully replaces frontier — permanently graduated.
- NOT a knowledge-in-weights model — knowledge is external by design.
- NOT requiring fine-tuning on the occupant's data — adaptation is ICL + memory, never weight-capture.
- NOT routing all retrieval through the frontier — that maximizes the egress we minimize.

## 8. Connections
Memory: `project_soma_local_deliberation_direction` (the running record of this direction),
`project_soma_north_star_narrow_band` (the sensorium build + narrow-the-band north star),
`feedback_soma_build_for_future_model`, `feedback_role_division_claude_codex` (the dev role-division
that this architecture mirrors at runtime), `project_soma_coinhabitation_eval` (the memory substrate),
`user_collaboration_stance` (honesty discipline), `project_dedicated_inference_server`,
`project_hermes_soma_integration` (current local Gemma vLLM — the trajectory beyond it).
Build companion: the sensorium tier contract (the tooling half, under active construction).

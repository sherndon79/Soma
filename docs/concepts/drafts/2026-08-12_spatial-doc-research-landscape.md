# Spatial-Agent-Authoring: Research Landscape (Spatial Document)

**Status:** research input, NOT ratified design. Feeds [`2026-08-08_quest-agent-client.md`](./2026-08-08_quest-agent-client.md) §3.
**Date:** 2026-08-12.
**Method:** 3-way independent-first research over AMQ thread `research/spatial-doc-landscape` — two genuinely independent maps (Claude, muse; each captured before reading the other) + one **critical-extension** pass (Codex, whose blind was lost to a doorbell-drain and who disclosed it, contributing as correction/extension rather than third corroboration). Individual maps live on that thread; this is the converged synthesis. Sources cited inline; source-quality/recency flagged.

---

## The one-line finding
**The rendering machinery is well-charted — build on it, don't reinvent. Soma's real, defensible contribution is a narrow one:** a hostile-input-hardened, budget-bounded, comfort/accessibility-aware, **authority-separated** spatial-presentation contract for a **local, co-inhabiting** agent on constrained MR hardware — plus the **LLM→validated-IR authoring loop.** Everything else is adoption.

---

## 1. Prior art to ADOPT (and exactly how — with corrections)

| Standard / system | Use it for | Boundary / correction |
|---|---|---|
| **OpenUSD / Hydra** | Scene↔render-backend separation, scene indices, change-tracking, renderer mix-and-match | "USD as our wire IR" is too broad — full USD carries plugins, asset resolvers (file/cloud/db fetch), dynamic file formats, procedural construction, OpenExec. Use USD/Hydra **server-side in Soma's compiler only**; compile to a narrower endpoint doc with none of that surface. |
| **glTF 2.0 / GLB** | Immutable content-addressed mesh/material/animation asset substrate | glTF-Validator checks structure, **not adversarial admission** (no decompressed-size, tri/texture count, overdraw, thermal, authority). Accept only a **URI-free** subset; reject non-allowlisted extensions; never resolve agent URLs; recompute cost/bounds independently. |
| **MPEG-I Scene Description (ISO/IEC 23090-14)** | Closest immersive **wire** standard; extends glTF, separates content-access from rendering | A serious prior-art *gate* before inventing custom timed-media/update grammar. Compare every dynamic-media construct against it + conformance suite (Part 24). Not a security/consent model. |
| **X3D** | Declarative retained 3D, event routing, **profile/component negotiation**, conformance | Adopt the **profile principle** — a doc declares one baseline + required components; unsupported required components **fail closed**. A Soma profile = allowlist + budget. Exclude Script/ECMAScript/shaders/external protos. |
| **OGC 3D Tiles 1.1** | Hierarchical LOD/streaming via bounding volumes + geometric error | Adopt bounds/geometric-error/refinement separation; **recompute bounds at ingestion** (never trust author-declared). |
| **MaterialX** | PBR node vocabulary/semantics | Borrow names only; ShaderGen compiles to GLSL/MSL → expose a **closed operator set → precompiled variants**; no custom nodes / source / on-device ShaderGen. |
| **WebXR Layers** | Endpoint **composition**/performance for text/video panels | It is a compositor-layer API, **not a declarative scene IR** (WebGL layers still draw in rAF). Do not treat it as evidence the Spatial-Document problem is solved. |
| **A2UI (v0.9.1/1.0-cand., 2026)** | No-code agent UI over a **client-owned catalog** — reuse for ordinary 2D panels/forms *inside* the world | No geometry/GPU/spatial/lease/comfort model; borrow catalog vocab; add an explicit **prepare/commit snapshot** boundary for spatial state. |
| **MCP Apps** | Reference point for sandboxed-executable-UI as an *alternative* design | We deliberately don't take this path on-device. |
| **Recognizers (Jana, USENIX Sec '13) / Erebus (USENIX Sec '23)** | **"Derived, not raw"** perception permissions; contextual sensor DSL | Adopt. Don't claim object-scoped perception permission as novel. |
| **FLARE (MSR) / embedded-situated viz (Willett, TVCG '17)** | **Placement as constraint-solving**; near-referent vs coincident tradeoffs | Placement is **client policy**, not agent coordinates. |
| **WebXR consent lifecycle + Depth Sensing** | Feature/session consent, mid-session consent, data minimization; depth ≈ camera-equivalent + quantization | Adopt the consent-lifecycle precedent; **depth is perception-gated**, quantize/reduce resolution. |
| **AG-UI (2025-26)** | Typed event-stream agent→frontend (2D) — external validation that "stream ordered transactions" is the right shape | 2D-only; no geometry/consent/comfort. |
| **W3C XAUR (XR accessibility)** | Safe-harbor, time limits, flicker, captions, audio alternatives | glTF has **no** accessibility semantics today (open gap). |

## 2. Safety: the admission pipeline
Residual risk is **real** — a finite IR still reaches native decoders, parsers, Vulkan, drivers; WebGPU's own security notes cite driver bugs/DoS/timing, and Chromium runs the GPU process **unsandboxed on Android**. "Safe" = layered reduction, never elimination. Required stages:
1. framing caps before allocation (byte length, depth, counts, integer-overflow) → 2. schema/type/referential validation → 3. resource closure + hash verify, **no ambient URI/path resolution** → 4. decoder output limits (texture/mesh/media) → 5. **recomputed** bounds/topology/animation/cost → 6. static admission vs negotiated device profile → 7. **all-or-nothing transaction commit** (prior scene = rollback target) → 8. runtime meters/watchdogs/cancellation/device-loss recovery → 9. observable **degrade/reject receipts** distinct from transport receipts. Fuzz each stage; keep an adversarial model-generated corpus; exercise GPU/thermal/device-loss recovery.
- **Materials finite in *implementation*, not just schema:** closed typed DAG, bounded node/depth/fanout, no cycles/dynamic-indexing/loops/stores → precompiled variants. (DarthShader arXiv 2409.01824 + the Chromium WebGPU report confirm the shader path is the sharpest surface.)

## 3. Consent / authority: keep TWO independent ledgers
- **Renderer negotiation/admission** ("*can* this renderer do this?"): supported vocabulary + static/runtime budget. **Never grants authority.**
- **Authority** ("*may* this agent perceive/present this, here, now, for this user + bystanders?"): exact **leases** — subject, modality, spatial scope, purpose, expiry/revocation, local-only. This is **renderability ≠ authority**, sharpened into two ledgers.
- **Charted:** perception least-privilege (recognizers/Erebus, `xr-spatial-tracking` permissions-policy, WebXR depth-consent). **Under-charted (Soma's lane):** **presentation authority** — which agent may occupy which region/referent/modality, how long, at what interruption priority, and how **bystanders** constrain it; the symmetric perception↔presentation lease/receipt integration; provenance/correction of agent-authored objects on a shared referent.

## 4. Generative authoring: steal the loop, not the output
LLM spatial authoring is real but immature (mostly small-N, trusted-engine/code path): SceneCraft (ICML '24, LLM→Blender code + VLM critique), Holodeck ('24, LLM→constraints→solver), HDSL (DSL), LLMR (N=11), DreamCodeVR, Social Conjuring (N=12). Reusable pattern: **planner → scene-graph blueprint → IR → render → VLM visual critique → patch**, with library learning. **Soma's move: keep that loop but emit validated Render-IR patches instead of engine code** — LLM→bounded-verifiable-IR is the publishable contribution nobody has optimized for. Keep all code-gen inside Soma's trusted compiler.

## 5. Placement & comfort = client policy
Agent expresses **semantic intent** (referent + relationship + priority); the **client resolves an admissible pose** or degrades/rejects. Client owns keep-out zones, occlusion/legibility, field occupancy, locomotion/flicker/luminance, accessibility transforms, safe-dismiss, interruption priority, and **proxemics** (personalized comfort distance). Little 2024-25 empirical work exists on agent-*initiated* MR presentation — an open HCI seam Soma will generate data on.

## 6. Open problems (where Soma contributes to the field)
- Portable **3D cost model** predicting Quest-specific GPU/CPU/mem/thermal across content + runtime state.
- Compositional **delta admission** with no visible intermediate invalidity + scene rollback after driver failure.
- Exact **spatial presentation leases** + conflict resolution among agent / wearer / platform / **bystander**.
- **Provenance/correction** semantics for agent-authored objects on a shared physical referent.
- **Longitudinal HCI** for an agent that *initiates* (not just responds).
- **Accessible, observable degradation** that preserves meaning, not just frame rate.
- Secure **local generators** expressive enough for continuous behavior without becoming a hidden programming language (our `generator.sdf.v1`).

## 7. Narrow the claim (for honesty + any writeup)
Soma is **not** inventing declarative 3D, agent-generated UI, or the authoring/render split. Its plausible, defensible contribution is the **combination**: a hostile-input-hardened, budget-bounded, comfort/accessibility-aware, **authority-separated** spatial-presentation contract for a **local co-inhabiting** agent on constrained MR hardware — plus the LLM→validated-IR authoring loop.

## 8. Concrete build implications
1. **Two layers, not one format:** a small transactional Spatial-Document *envelope* + content-addressed asset payloads (URI-free glTF subset; compare timed-media vs MPEG-I).
2. **Exact catalog/profile identity** (A2UI catalog IDs + X3D profile/component): required-unsupported fails closed; optional degrades with a typed receipt.
3. **Rich authoring standards stay server-side** (USD/Hydra/MaterialX in the compiler; never cross to Quest).
4. **Atomic transactions**; prior scene is the rollback target.
5. **Split declared vs measured budget**; receipts report what actually rendered, at which LOD, and why.
6. **Materials finite in implementation** (closed DAG → precompiled variants).
7. **Placement = client policy** from agent semantic intent.
8. **Two ledgers** (renderability vs authority) in APIs *and* records; leases scoped/revocable/expiring/local.
9. **Reuse A2UI** for 2D panels inside the world; don't invent a parallel widget language.
10. **Build the VLM-critique loop over Render-IR patches** — the moat; benchmark vs code-gen baselines.

## Sources (selected, quality-flagged)
Standards/official (high): OpenUSD 26.08, glTF 2.0 + Validator, MPEG-I Part 14 (ISO/IEC 23090-14), X3D (Web3D), OGC 3D Tiles 1.1, MaterialX 1.38, W3C WebXR / WebXR Layers / Depth Sensing / XAUR, A2UI v0.9.1, Chromium WebGPU security report. Peer-reviewed (high): Recognizers (USENIX Sec '13), Erebus (USENIX Sec '23), SceneCraft (ICML '24), FLARE (MSR), Willett TVCG '17, DarthShader (arXiv 2409.01824). Preprint/small-study (medium, no safety/consent weight): Holodeck, HDSL, LLMR, DreamCodeVR, Social Conjuring, agentic-3D surveys, proxemics/embodiment 2025-26.

## Process note
Independent-first held for 2 of 3; the **doorbell-drain broke the wall** for Codex (it drained muse's posted map mid-research). Fix ratified same day: in a blind phase, **hold full findings out of the shared thread until all signal done, then release together** (now in the amq-spec skill + the Constellation steering floor). Codex's honest disclosure preserved the record's integrity.

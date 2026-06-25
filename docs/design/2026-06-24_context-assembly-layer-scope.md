# Context-Assembly Layer — scope + first slice

**Status: DESIGN/SCOPE (2026-06-24). For Codex pressure-test before build.** This is the "missing
seam" named in [the local-reasoner vision doc](./2026-06-23_local-reasoner-intelligence-architecture.md)
§4 — the bridge between tools/memory and the (future) local reasoner's prompt. It is the **load-bearing
near-term build item** in the local-reasoner direction: buildable now, against the existing capability
spine, **independent of any model arriving**, because it is what prevents frontier curation from
becoming payload egress by indirection.

Companion docs: the vision doc (north-star), the sensorium tier contract (the active build whose
patterns this reuses — content-free provenance, local gates, fixture-first).

---

## 1. What it is

Given an objective, the context-assembly layer **assembles the context the local reasoner will see** —
selecting from local sources (memory first; tools/retrieval later), under governance: validation,
minimization, budget, and provenance. The (future) reasoner consumes a **ContextBundle**; the (remote)
frontier may only ever supply a **slot-bearing ContextRecipe**, validated locally.

**Data flow:**
```
objective / FrontierPlanEnvelope(recipe)
      │
      ▼  [1] RECIPE VALIDATION (local)  ── reject payload-bearing selectors; slot-bearing only
      ▼  [2] SELECTION (local)          ── choose source items per validated recipe; emit selection receipts
      ▼  [3] MINIMIZATION (local)       ── content-tier reduction per existing discipline
      ▼  [4] BUDGET ACCOUNTING (local)  ── fit context budget; ordering + eviction; abstain if required evidence missing
      ▼  [5] ASSEMBLE → ContextBundle   ── content (for reasoner) + content-free manifest (receipts, budget, minimization)
      ▼
   (future) local reasoner          ── frontier NEVER saw payload; only the slot-bearing recipe
```

The critical invariant: **local-only payload filling.** The frontier sees the recipe (structure); the
local tier fills the private slots and assembles content that never leaves the box.

## 2. The two contracts

### 2.1 ContextRecipe (input — SLOT-BEARING, never content-bearing)
Allowed fields ONLY: `objective_class`, `capability_classes`, `constraints`, `required_receipt_types`,
`context_budget`, `ordering`, `abstention_criteria`, abstract slot descriptors.
Forbidden (rejected by the validator §3): raw content, proper names from private context (unless
user-supplied for that remote turn), file paths/titles, exact memory text, screenshots, canaries,
linkable digests, or any selector that resolves to a single private entity.

### 2.2 ContextBundle (output — content for the reasoner + content-free manifest)
- `bundle_body`: the assembled context the reasoner consumes (contains content — local only).
- `manifest` (content-free, digest-based, auditable): per-item **source receipts** (source, freshness,
  trust-tier, digest), the **selection receipts** (why each item was included/excluded), the
  **minimization record**, the **budget accounting** (what fit, what was evicted, ordering), the
  recipe digest, and an **abstention record** if `required_receipt_types` could not be satisfied.
- `replayable`: same validated recipe + same source state ⇒ same bundle (deterministic, auditable).

## 3. FrontierPlanEnvelope validator (floor-critical — the reason this layer exists)
A **local** validator that gates any frontier-supplied recipe before it runs. Same invariant as H1/H2
across the build: **do not trust the remote tier's restraint — enforce locally.** Rejects
payload-bearing selectors (proper names, paths, exact text, linkable digests, single-entity
resolvers). Slot-bearing recipes pass; content-bearing ones are refused with a reason. Provable in
isolation: feed adversarial recipes, prove rejection — no live frontier required.

## 4. Governance properties (from the vision doc tensions)
- **Selection is an AUTHORITY surface, not just retrieval quality.** The selector emits its own
  receipts + can REFUSE (e.g. when a recipe would over-disclose). Selection decisions are auditable.
- **Receipts are only as good as source contracts.** Each source declares freshness / trust-tier /
  citation integrity; the manifest records them. (Rich contradiction-handling deferred — see §7.)
- **Frontier-as-conductor is a meta-control plane.** The bundle is **replayable**, supports a future
  **local veto**, and records **disclosure** when a frontier recipe influenced assembly (the egress
  recipient-mark instinct, turned inward).
- **Content-free manifest** mirrors the egress draft pattern: the bundle carries content for the
  reasoner, but its provenance/manifest is digest-based and auditable without storing the payload.

## 5. The model-agnostic / model-specific split (resolves the build-ahead-of-consumer risk)
The reasoner does not exist yet, so we build ONLY the parts that do not depend on the specific model:
- **BUILD NOW (model-agnostic governance core):** recipe validator, the two contracts, source +
  selection receipts, minimization, budget accounting, replayability, abstention. These are
  governance mechanisms — they do not change when the model changes.
- **DEFER (model-specific tuning):** exact prompt/bundle serialization format, retrieval/ordering
  heuristics tuned to a particular reasoner, context-budget numbers. These need the actual model and
  should wait for a candidate (per the vision doc decision triggers).

## 6. First build slice (fixture-first, same discipline as sensorium-1a / egress-fixture)
Prove the governed mechanism against EXISTING LOCAL sources, with **no live frontier** (recipes from
fixtures) and **no live reasoner** (bundle produced + validated; nothing consumes it live yet).

- **Single source: occupant memory** (the drawer/inheritance chain from `project_soma_coinhabitation_eval`).
  Many items ⇒ real selection + ordering + budget eviction + minimization, with one source type. (Multi-
  source — sensorium events, capability outputs — is the immediate NEXT slice; external retrieval is
  later and is governed egress, ties to §9 egress gate.)
- Build: ContextRecipe + ContextBundle schemas; the FrontierPlanEnvelope validator; a local assembler
  (select-from-memory → minimize → budget → bundle); source receipts; selection receipts; content-free
  manifest; replayability.
- Tests (the refusal / end-to-end matrix): payload-bearing recipe REJECTED (proper name / path / exact text /
  linkable digest / single-entity resolver); slot-bearing recipe accepted; budget enforced (eviction +
  ordering); each included item carries a source + selection receipt; **the recipe path carries NO
  content** (frontier-never-sees-payload is structurally provable); abstention recorded when
  `required_receipt_types` unsatisfiable (no fabrication); same recipe + same memory state ⇒ identical
  bundle (replayable); minimization applied per existing tiers; manifest is content-free (digests, no
  payload).

## 7. Deferred (named so they are not forgotten)
- Live frontier curation (real frontier emitting recipes) — first slice uses fixture recipes.
- Live reasoner consumption — no reasoner yet (the model-specific serialization waits).
- Multi-source assembly (sensorium events, capability outputs) — immediate next slice.
- External retrieval (web/tools) — later; it is governed egress, composes with the §9 egress gate.
- Rich source-contract machinery: contradiction handling, source-trust scoring, citation-integrity
  enforcement — first slice does basic receipts only.
- Interactive local veto + disclosure UI — first slice makes the bundle replayable/auditable (the
  substrate for veto); the interactive surface is later.

## 8. For Codex — pressure-test before build
1. The validator (§3): is "reject payload-bearing selectors" enforceable as a positive allow-list
   (slot-bearing schema) rather than a negative blocklist? A blocklist of "proper names/paths/etc."
   will leak; an allow-list of permitted abstract fields is the stronger shape — confirm/design it.
2. Replayability (§2.2) vs. mutating memory: "same source state ⇒ same bundle" needs a way to pin
   source state (a memory snapshot id / version) so a replay is meaningful. Does occupant memory
   expose a versionable read?
3. Composition: does this reuse the existing provenance/grant/minimization machinery, or does the
   assembler need a new capability + grant of its own? (It should reuse — no new authority plane.)
4. Selection-as-authority (§4): what does a selection *refusal* look like, concretely, and where is
   its receipt recorded?
5. First-slice source choice (§6): is occupant-memory-only sufficient to prove the mechanism, or does
   proving budget/minimization meaningfully require a second heterogeneous source in slice 1?

This is design — pressure-test the shape, especially #1 (allow-list vs blocklist) and #2
(replayability against mutating memory), before any code. Role division holds: I design/review, you
build/commit.

---

## 9. Codex pressure-test ACCEPTED — build-ready spec (2026-06-25)

Codex confirmed the shape and both floor-critical questions (allow-list yes; occupant memory has NO
versionable read → a snapshot primitive must be added). All accepted; one Claude refinement added (§9.7).

### 9.1 ContextRecipe = CLOSED POSITIVE SCHEMA (allow-list is the floor; negative scanner is only
defense-in-depth). Unknown fields REJECT. String fields are enums except `recipe_id` (bounded, id-like,
never a selector). Allowed fields:
`schema_version`, `recipe_id`, `origin` (fixture|frontier|local), `objective_class` (enum, e.g.
troubleshoot_current_task / prepare_successor_context / summarize_recent_local_activity /
answer_user_question_from_memory), `source_classes` (enum array; slice 1 = occupant_memory only),
`capability_classes` (enum, abstract), `constraints` (closed keys: domain, memory_classes, max_items,
max_chars, include_tombstones, recency_window enum, consent_scope enum — NO free-form query/ids/names/
paths), `required_receipt_types` (enum array), `context_budget` (max_items, max_chars, reserve_chars,
overflow_policy enum), `ordering` (enum list: newest_first / receipt_priority / class_priority — no
custom comparator), `minimization` (enum: full_self_note | excerpt_for_reasoner | metadata_only —
deterministic), `abstention_criteria` (enum array), `abstract_slots` (closed descriptors e.g.
current_domain / current_episode_mode / current_task_class — values FILLED LOCALLY; frontier names the
slot, never supplies the private value).
**Forbidden BY SCHEMA (not regex):** free-form query, selector_text, entry_id, file_path, title,
digest, embedding, entity_name, participant_name, source_uri, memory_text, custom sort/filter exprs.
**TAG nuance (Codex):** current occupant-memory tags are FREE-FORM → a tag selector can smuggle a
private name/event. Slice 1 allows NO tag selectors unless a separate PUBLIC controlled tag vocabulary
exists; use memory_class/domain/recency instead.

### 9.2 Memory snapshot primitive (NEW — replayability requires it; occupant memory lacks it)
A PURE function, NOT a new authority plane: `memory_snapshot_digest = sha256(canonical JSON of
schema_version + sorted entries + sorted tombstones)`, plus `active_entry_count`, `tombstone_count`,
`newest_timestamp`. Selection runs against that normalized in-memory snapshot.

### 9.3 Replayability = a CONCRETE INVARIANT (not aspirational). The bundle manifest MUST carry
`source_state: { source_class, snapshot_digest, schema_version, active_entry_count, tombstone_count }`;
`bundle_digest` is deterministic; **same recipe_digest + same snapshot_digest ⇒ same bundle_digest**;
a MISSING snapshot ⇒ abstain/refuse with `replay_state_unpinned`.

### 9.4 Manifest = LOCAL AUDIT material (item-level source receipts: entry_id, created_at,
memory_class, content_digest, tombstone_digest). Detects drift + reproduces without storing content.
CAVEAT: content digests are LINKABLE → manifest stays LOCAL-ONLY; digests NEVER go upstream to frontier.

### 9.5 Selection/refusal = FIRST-CLASS RECEIPT (not exception-only).
`selection_receipt = { receipt_id, recipe_digest, source_class, source_snapshot_digest, decision
(included|excluded|refused|abstained), reason_class, item_ref_digest?, source_receipt_id?,
content_included:false }`. Closed refusal `reason_class` enums: recipe_schema_invalid,
selector_payload_bearing, source_degraded, missing_required_receipt_type, source_authority_missing,
source_domain_mismatch, budget_insufficient, minimization_failed, no_matching_items, overbroad_selector,
replay_state_unpinned. Whole-assembly refusal ⇒ ContextBundle-like refusal manifest: empty bundle_body,
abstention_record populated, content_included:false.

### 9.6 Composition (no new authority plane). The assembler is an INTERNAL LOCAL SERVICE over
already-authorized sources. Slice-1 tests: INJECTED store object. Runtime: requires an active
`occupant.memory.read` grant OR an internal steward/system path with the SAME recovery checks +
content-free provenance. NO new user-facing capability yet — add one only when an external caller/model
can request assembly as an action. DEGRADED memory ⇒ abstain/refuse (`source_degraded`), never assemble
from suspect state. Reuse occupantMemory normalization/page/scanner/minimization + the content-free
provenance pattern (occupant.memory.read, comms fixture egress).

### 9.7 Claude refinement — MANIFEST TWO-TIER (extends §9.4): the manifest has (a) a LOCAL-AUDIT tier
(full receipts, linkable content_digests — never egresses) and (b) a FRONTIER-FACING tier (enum
reason_class + abstention_record ONLY — no digests, no content). This closes the conductor loop: the
frontier can learn its recipe was refused (`selector_payload_bearing`) or assembly abstained
(`budget_insufficient`) so it can revise — WITHOUT ever seeing linkable audit data. Same
minimization-seam, applied to the manifest itself.

**Codex closure (2026-06-25) — two refinements, accepted:**
- **The two tiers are a PROJECTION BOUNDARY, not ad-hoc field-stripping.** `local_audit_manifest` is
  authoritative + local-only (source/selection receipts, item refs, content digests, snapshot digest,
  bundle digest, minimization + budget detail). `frontier_facing_manifest` is produced ONLY by an
  **allow-listed projector** (its own tests prove linkable fields are stripped): status, closed
  `reason_class` enums + the violated schema-field *class* (never the private value), abstention
  classes, maybe counts/budget classes. NO content, item ids, source ids, tags, precise timestamps,
  content digests, snapshot digests, or bundle digests. Callers MUST NOT assemble the frontier view
  themselves — only the projector may.
- **Digest-echo leak (sharp):** `recipe_digest` is safe to expose ONLY if it digests the *validated
  slot-bearing* recipe. For a REJECTED payload-bearing recipe, the digest is a *linkable echo of the
  forbidden content* → OMIT it, or digest a sanitized normalized rejection shape instead. The
  refusal-feedback channel must not become payload egress by indirection via the digest.

### 9.8 Slice 1 = occupant-memory-only is SUFFICIENT (a 2nd source would mostly prove source-merge, not
the floor). But the FIXTURE SET must be deliberately RICH: multiple domains; memory_classes (even if
only self_note exists today); tombstones; old/new timestamps; long entries forcing budget eviction;
entries that trip minimization/exclusion; degraded-recovery. Multi-source = slice 2.

### 9.9 BUILD-READY CHECKLIST (Codex). Approve slice 1 if it includes: (A) closed positive ContextRecipe
schema; (B) memory snapshot digest / source_state in manifest; (C) deterministic assembler over an
injected occupant-memory store; (D) content-free selection/source receipts; (E) refusal/abstention as a
manifestable outcome. No live frontier, no live reasoner, memory-only. **Status: BUILT + REVIEWED +
COMMITTED 2026-06-25 (commit 93b3ec6, src/contextAssembly.js). Review folded F1 (arbitrary unknown JSON
keys project as `parent.unknown_field` so no private key residue reaches the frontier-facing manifest —
same indirection class as the egress digest-echo) + F2 (tombstone body counts against the char budget).
`recency_window=all`-only affirmed as the replayability-preserving choice.**

---

## 10. Slice 2 — multi-source assembly (DESIGN, 2026-06-25)

Slice 1 proved the governed core against ONE source (occupant memory). Slice 2 adds the thing that
makes "context assembly" worth the name: **assembling across heterogeneous local sources** (memory is
the *past*; live perception/activity is the *present* — a reasoner wants both). The new mechanism is a
uniform **SourceAdapter** contract + a **source-merge** policy. Still fixture-first: no live frontier,
no live reasoner. All slice-1 floor invariants carry unchanged (local-only payload fill, content-free
manifest, two-tier projector, allow-list validation, abstain-not-fabricate, no caller-asserted claims).

### 10.1 The core new piece: the SourceAdapter contract
Slice 1 hardcoded occupant-memory logic; slice 2 refactors it behind a uniform interface every local
source implements, so sources plug in without the assembler knowing their internals:
- `source_class` (enum), `trust_tier` (enum), `freshness_class` (enum: persistent | snapshot_pinned |
  ephemeral), `allowed_constraints` (the closed constraint keys THIS adapter accepts), supported
  `minimization` modes.
- `snapshot(store) → { source_class, snapshot_digest, counts, freshness_descriptor }` (pure,
  deterministic — the per-source replay anchor).
- `select(snapshot, source_constraints) → items[]` (each item exposes a uniform comparable
  `sort_key`: {timestamp, source_class} so cross-source ordering works).
- `sourceReceipt(item, snapshot) → content-free receipt` (carries trust_tier + freshness).
- `minimize(item, mode) → { body, char_count, reason_class }` (per-source; sensorium events are
  already-minimized semantic events, memory has full/excerpt/metadata — the adapter owns this).
The occupant-memory logic from slice 1 becomes the first `OccupantMemoryAdapter` conforming to this.

### 10.2 Recipe schema extension: PER-SOURCE selectors (still closed/allow-list)
`source_classes` (flat in slice 1) becomes `source_selectors`: a closed array, each entry =
`{ source_class (enum), required (bool), constraints (validated against THAT adapter's
allowed_constraints), minimization (enum from adapter's supported set), budget (per-source reserve +
share) }`. The validator validates each selector against the named adapter's declared contract — so
the allow-list floor becomes **per-adapter** (unknown constraint key for that adapter → reject;
payload-vector key → `selector_payload_bearing`, parent-class echo only). No global free-form fields.

### 10.3 Composite source_state + replayability (extends §9.3)
`source_state` becomes a map: per-source `{ snapshot_digest, counts, freshness_class }`, plus a
`composite_snapshot_digest` = digest over the sorted per-source states. Invariant: **same recipe_digest
+ same composite_snapshot_digest ⇒ same bundle_digest.** A source missing its snapshot ⇒
`replay_state_unpinned` (named per-source). `freshness_class` matters here: `persistent` /
`snapshot_pinned` sources replay cleanly; **`ephemeral` sources (e.g. sensorium events, 10s TTL) do
NOT replay across their TTL** — see §10.7 (deferred to slice 3 with the snapshot-freeze design).

### 10.4 Source-merge: ordering + budget allocation (the genuinely new policy)
- **Ordering** (recipe `ordering` enum, now cross-source): `newest_first` (global, by each item's
  uniform `sort_key.timestamp`), `class_priority` (group by a declared source-class order — e.g. live
  activity before memory), `receipt_priority` (by trust_tier/freshness). Adapters MUST expose a
  comparable `sort_key` or the merge is undefined.
- **Budget allocation** (new): with multiple sources a single global budget can starve one source.
  Proposed policy: each `source_selector.budget` carries a `reserve` (guaranteed minimum) + a `share`
  (weight for the remaining budget); the gate fills reserves first, then distributes the remainder by
  share, then global eviction by `ordering`. This is a real decision — alternatives are pure-global-
  compete (simpler, can starve) or fixed-per-source sub-budgets (rigid). **Recommend reserve+share.**

### 10.5 Per-source minimization, receipts, trust/freshness (operationalizes Codex tension #2)
Each adapter owns its minimization; receipts carry `trust_tier` + `freshness` per source — so the
manifest records, honestly, that a live-screen item is fresh-but-ephemeral while a memory note is
persistent-but-possibly-stale. This is where "receipts are only as good as source contracts" stops
being a slogan: the adapter's declared contract IS the receipt's trust basis.

### 10.6 Partial-source failure policy (new floor decision)
If ONE source is degraded/unavailable: a `required` source degraded ⇒ **whole-assembly abstains**
(`source_degraded`, names the source); an `optional` source degraded ⇒ **skip it, assemble from the
healthy sources, record the omission** in the manifest (the reasoner/audit sees the source was
dropped, not silently absent). Default conservative: a source is `required:false` unless the recipe
says otherwise. Never assemble from a *suspect* source (slice-1 rule, now per-source).

### 10.7 Projector boundary — unchanged, multi-source manifest
The two-tier projector (§9.7) is unchanged in principle: the frontier-facing manifest still carries
only status / closed reason_class / aggregate counts / abstention classes — now possibly **per-source
aggregate counts** (fine: a count of items from `occupant_memory` vs `live_activity` is aggregate, not
linkable). NO per-source ids/digests/timestamps/snapshot-digests upstream. Re-run the projector's
self-guard with the multi-source fields.

### 10.8 What slice 2 BUILDS vs DEFERS
- **BUILD:** the SourceAdapter contract; refactor slice-1 logic into `OccupantMemoryAdapter`; add a
  SECOND adapter to prove merge; per-source recipe selectors + per-adapter validation; composite
  source_state + replayability; reserve+share budget; cross-source ordering; per-source receipts/
  minimization/trust; partial-source policy; multi-source projector self-guard. Fixture-first.
- **The second source for slice 2:** recommend it be a **snapshot-able / persistent** second source so
  merge is proven WITHOUT the ephemeral-replay problem. Candidates: a content-free **activity/provenance
  log** view (snapshot-able, low-risk), or an **injected fixture source adapter** (proves the contract
  generically). **DEFER the first EPHEMERAL real source (sensorium semantic events) to slice 3**, where
  the new work is *snapshot-freeze-for-replay* (pin events as-of assembly; persist the frozen snapshot
  or report `replay_state_unpinned`). One hard thing per slice — adapter+merge here, ephemerality next.
- **Also deferred (unchanged):** external retrieval (governed egress), live frontier curation, live
  reasoner consumption / model-specific serialization.

### 10.9 For Codex — pressure-test before build
1. **Budget allocation (§10.4):** is reserve+share the right policy, or does it over-complicate slice
   2? Would fixed per-source sub-budgets be enough to prove merge, deferring reserve+share?
2. **Per-adapter validation (§10.2):** confirm the allow-list floor cleanly generalizes to
   per-adapter `allowed_constraints` without reintroducing a global free-form surface.
3. **`sort_key` contract (§10.4):** is a {timestamp, source_class} uniform key sufficient for
   `newest_first` / `class_priority` / `receipt_priority`, or do heterogeneous sources need a richer
   comparable?
4. **Second source choice (§10.8):** activity/provenance-log adapter vs injected-fixture adapter for
   slice 2 — which proves merge most honestly without taking on ephemerality?
5. **Partial-source policy (§10.6):** required⇒abstain / optional⇒skip+record — right default, and
   does "skip+record" need a frontier-facing signal (so the conductor learns a source was dropped)?

This is design — pressure-test the shape, especially #1 (budget policy) and #4 (second source), before
any code. Role division holds: I design/review, you build/commit.

### 10.10 Codex pressure-test ACCEPTED — build-ready slice-2 spec (2026-06-25)
All five tightenings accepted; they simplify slice 2 and harden the floor. Plus one Claude extension
(§10.10f) that carries Codex's count-leak point back onto slice-1's existing code.

a. **Budget → fixed per-source sub-budgets + global cap (NOT reserve+share).** Reserve+share combines
   two new problems (merge + proportional allocation) and has no validation target until a real
   reasoner creates context pressure — it's a model-specific optimization, so DEFER it (slice 2b/3).
   Slice 2: `source_selector.budget = { max_items, max_chars, overflow_policy }`; top-level
   `context_budget` stays global. Enforce per-source caps first, then merge under the global cap +
   ordering. Required source overflow w/ overflow_policy=abstain ⇒ whole `budget_insufficient`;
   optional ⇒ skip/record or evict-within-source. Proves starvation-prevention + per-source accounting
   + cross-source eviction without weight math.
b. **Per-adapter validation via a CLOSED ADAPTER REGISTRY.** Top-level recipe validates only the
   `source_selectors` ARRAY SHAPE; `source_class` resolves to a registered adapter from a closed
   registry; `adapter.validateSelector(constraints)` returns normalized constraints OR a refusal
   (reason_class + sanitized violated_field_class). Unknown keys use the slice-1 F1 rule (recognized
   payload-vector → field-class echo; arbitrary → `source_selectors.constraints.unknown_field`).
   **The adapter registry IS the closed vocabulary** — no global `constraints` schema with per-source
   optional fields, no free-form expansion.
c. **Richer CLOSED sort_key** ({timestamp, source_class} was insufficient — only newest_first, and
   only if timestamp normalized+present). Use
   `sort_key = { timestamp_ms, source_class, source_rank, trust_rank, freshness_rank, stable_item_key }`.
   Rules: newest_first = timestamp_ms desc, source_rank asc, stable_item_key asc; class_priority =
   source_rank asc (explicit rank map, NOT lexicographic), timestamp_ms desc, stable_item_key asc;
   receipt_priority = trust_rank desc, freshness_rank desc, timestamp_ms desc, stable_item_key asc.
   Recipe chooses `ordering` enum + optional `source_class_order` (enum list of registered classes);
   assembler DERIVES ranks from adapter contracts + recipe order. No custom comparator. Missing
   timestamp ⇒ normalize to 0 + receipt reason, OR adapter validation failure (per source contract).
d. **Second source = injected FIXTURE adapter (NOT the real provenance/activity log yet).** The hard
   thing is adapter+merge, not provenance-as-a-source semantics (which raises its own authority +
   content + durability + schema-variance questions = a separate source-contract design). The fixture
   is NOT a toy — give it a real declared contract: `source_class=local_activity_fixture`,
   `trust_tier=local_fixture`, `freshness_class=snapshot_pinned`, closed constraints, deterministic
   snapshot, receipts, minimization. Populate with event-like records (timestamp, activity_class enum,
   event_type enum, capability_class enum, domain, summary_class enum — NO payload). **NEW SEQUENCING:
   slice 2 = adapter+merge (fixture 2nd source); slice 2b = real provenance/activity adapter (its own
   source-contract + authority design); slice 3 = ephemeral sensorium snapshot-freeze.**
e. **Partial-source frontier signal — COARSE only.** required⇒whole-abstain, optional⇒skip+record
   stands. skip+record needs a frontier-facing signal so the conductor can revise:
   `source_omissions: [{ source_class (public registered enum), required:false, reason_class (closed),
   count_class (none|some|many | omitted) }]`. NO ids/digests/timestamps/snapshot-hashes upstream.
f. **§10.7 NARROWED + Claude extension: exact counts leak over repeated calls.** Codex: exact
   per-source counts, even aggregate, are a side-channel — a frontier observing how counts change
   across repeated calls infers private state deltas. So frontier-facing = COARSE `count_class`
   (none/some/many); exact counts LOCAL-AUDIT-ONLY. **Claude extension: this applies to slice-1's
   EXISTING `included_count`/`excluded_count`** — they are currently exact integers in
   `projectFrontierFacingManifest`. There is no live frontier yet so nothing is exploited, but the
   live-frontier consumer is coming and the side-channel is real → coarsen ALL frontier-facing counts
   to buckets (do it in slice 2 for consistency, or at the latest before any live frontier curation).
   Same generalization pattern as digest-echo → field-name-echo: the discipline extends to every
   count, not just the new per-source ones.

g. **KNOWN LIMITATION (Claude review, 2026-06-25) — per-source budgets are MAXIMUMS, not
   RESERVATIONS.** Fixed per-source sub-budgets + global cap prevent one source from *dominating the
   candidate pool*, but do NOT guarantee each source a *minimum in the final bundle*. Under a tight
   global `context_budget` + skewed ordering (e.g. `newest_first` when one source holds all the newest
   items), a source can pass its per-source cap yet have all its items globally evicted — i.e. STARVED
   in the final set. This is the EXPECTED consequence of deferring guaranteed minimums; **reserve+share
   (slice 2b/3) is what introduces per-source reservations.** Until then, "I selected both sources" does
   not guarantee "both appear in the bundle" under budget pressure. Behavior should be pinned by a test
   so it is intended-not-accidental.

**Build-ready slice-2 shape (Codex):** refactor slice-1 memory → `OccupantMemoryAdapter`; add
`SnapshotFixtureActivityAdapter` (real contract); adapter registry + per-adapter selector validation;
composite source_state + composite_snapshot_digest; deterministic merge with the richer sort_key ranks;
fixed per-source sub-budgets + global cap; partial-source required/optional with local exact receipts +
frontier coarse omission signals (+ coarsen existing counts per §10.10f). Defer reserve+share, real
provenance-log adapter (2b), ephemeral sensorium (3). **Status: build-ready, pending Seth's go.**

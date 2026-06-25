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
provenance-log adapter (2b), ephemeral sensorium (3). **Status: BUILT + COMMITTED 2026-06-25 (a64cbf6);
the §10.10g starvation behavior is pinned by a test.**

---

## 11. Slice 2b — reserve+share budget (DESIGN, 2026-06-25) — fixes the §10.10g starvation gap

Re-sequenced for one-hard-thing-per-slice: **2b = reserve+share (this); 2c = real provenance/activity
adapter (its own authority/content design); 3 = ephemeral sensorium.** Pure deterministic budget logic,
fully provable against the existing two fixture sources — NO new sources, NO new authority surface, NO
floor crossing. All slice-2 invariants carry unchanged (composite replay, content-free manifest,
two-tier coarse projector, per-adapter validation).

### 11.1 The change: per-source budget gains `reserve` + `share`
`source_selector.budget` (today `{ max_items, max_chars, overflow_policy }`) gains:
- `reserve = { min_items, min_chars }` — a HARD guaranteed minimum for this source (cannot be evicted
  by other sources).
- `share` — non-negative integer weight for distributing the POST-reserve remainder.
`max_items`/`max_chars` remain the per-source CAP; `overflow_policy` unchanged. Defaults: reserve
{0,0}, share 1 (so a recipe that omits them behaves like slice-2 fixed-cap = backward compatible).

### 11.2 Validation (deterministic, reject-not-scale)
Sum of reserves across selectors (Σ min_items, Σ min_chars) MUST be ≤ the global `context_budget`. If
reserves exceed the global cap ⇒ recipe invalid, **new closed reason_class `reserves_exceed_budget`**.
No silent proportional scaling — the caller must fix it (deterministic + legible).

### 11.3 Assembly — 3 deterministic phases
1. **Reserve phase:** for each source in `source_class_order`, include up to its `reserve`
   (min_items / min_chars), drawing that source's top items by its own newest-first order. These are
   GUARANTEED — never evicted. Consume from the global budget. (A source with fewer items than its
   reserve contributes what it has; the **unused reserve returns to the share pool** — don't waste it.)
2. **Share phase:** the remaining global budget (global max − reserved-used) is split across sources by
   `share` weight: each source gets `floor(remainder × share / Σshare)`, with the rounding leftover
   allocated by `source_class_order` (deterministic). Within a source's share allocation, items compete
   by the recipe `ordering`; per-source `max` still caps.
3. **Global merge:** reserved ∪ shared items ordered by recipe `ordering` for `bundle_body`; anything
   beyond global `max` evicted per `overflow_policy` — but **reserves are never evicted.**

### 11.4 Receipts + the starvation test flip
Selection receipts gain a closed `budget_phase` field (`reserve | share | evicted`) so the local audit
shows WHY each item made the bundle. Frontier-facing manifest UNCHANGED (still coarse count_class +
omissions — `budget_phase` is local-audit-only). The §10.10g starvation test FLIPS: with a reserve on
`occupant_memory`, the tight-global-cap + `newest_first` case must now show memory items PRESENT
(reserved), proving starvation is fixed.

### 11.5 For Codex — pressure-test before build
1. Reserve-overflow handling (§11.2): reject-with-`reserves_exceed_budget` vs proportional-scale — I
   chose reject (deterministic/legible). Confirm, or argue scale.
2. Unused-reserve-returns-to-share (§11.3 phase 1): is returning a short source's unused reserve to the
   share pool the right call, or should unused reserve simply go unused (simpler, but wastes budget)?
3. Share rounding (§11.3 phase 2): leftover-by-`source_class_order` — deterministic + good enough, or
   do we need a fairer largest-remainder rule?
4. Backward-compat (§11.1 defaults): reserve {0,0} + share 1 ⇒ identical to slice-2 behavior — confirm
   the existing slice-2 tests still pass unchanged with defaults.
5. Char vs item reserves interacting: min_items and min_chars are both hard floors — what if min_items
   is satisfiable but min_chars is not (or vice versa) under the global cap? Define the precedence.

Tests: starvation FIXED (reserved source present under tight cap + skewed ordering);
`reserves_exceed_budget` rejection; unused-reserve redistribution; deterministic share rounding;
backward-compat (defaults reproduce slice-2 bundles); replay determinism unchanged; budget_phase
receipts content-free and local-only. Role division holds: I design/review, you build/commit.

### 11.6 Codex pressure-test ACCEPTED + corrections (2026-06-25) — build-ready
Two real corrections (both accepted), two refinements, one Claude edge-fix.

- **C1 (corrects §11.1 backward-compat — my claim was WRONG): EXPLICIT ACTIVATION via `budget_mode`.**
  reserve{0,0}+share1 is NOT identical to slice-2: slice 2 = per-source max cap → GLOBAL competition by
  ordering; equal-share = per-source admission allocation from the remainder (e.g. max_items=3, two
  sources: equal-share forces 2/1 by source_class_order, slice 2 might take top-3 all from one source).
  FIX: a recipe with NO selector specifying reserve/share runs **legacy_global** mode = EXACT slice-2
  behavior (and the §10.10g starvation limitation still stands, documented). If ANY selector opts in
  (reserve or share present), run **reserve_share** mode (omitted values inside that mode default
  reserve{0,0}/share1). Derived local `budget_mode: legacy_global | reserve_share` makes it legible.
  No pretending default share is behavior-preserving.
- **C2 (corrects §11.1/§11.5 min_chars — semantically backwards as a content floor): min_chars is
  RESERVED CAPACITY, not required spend.** A "must include ≥N chars" floor is backwards for a
  MINIMIZATION layer (shorter is better; a char floor incentivizes padding / picking worse-larger
  items). FIX: `min_items` = hard INCLUSION floor (guarantee that many items, deterministic top order);
  `min_chars` = reserved char CAPACITY other sources cannot steal, NOT a requirement to spend it.
  Failure to spend min_chars is NOT a failure. Σ min_chars ≤ global max_chars stays a validation rule
  (it reserves CAPACITY, not payload volume). This dissolves my §11.5 #5 "precedence" question — they
  are different KINDS (count-floor vs capacity-reservation), not competing floors.
- **R1: unused reserve = ACTUAL CONSUMED, not nominal.** If a short source cannot fill its reserve from
  matching items, the unused item/char CAPACITY re-enters the share pool (don't waste budget; don't let
  a short optional source shrink the useful bundle).
- **R2: all-share=0 ⇒ reserve-only mode** (post-reserve remainder intentionally unused; no divide-by-
  zero). Share rounding stays leftover-by-source_class_order (deterministic, recipe-controllable);
  largest-remainder not worth it for this slice.
- **CLAUDE EDGE-FIX (nominal-vs-actual char bound):** validation is in NOMINAL reserve terms
  (min_items/min_chars), but guaranteed reserved ITEMS have ACTUAL char costs that may exceed min_chars.
  Resolve the latent tension between "reserved items never evicted" and "global cap outranks all":
  **the global `max_chars` is the HARD outer bound.** If the guaranteed reserved items' ACTUAL chars
  would exceed global max_chars, do NOT over-subscribe and do NOT silently evict a reserved item →
  **abstain `budget_insufficient`** (required source) / the recipe cannot be honored within the cap.
  Fail cleanly rather than violate either invariant.

**Build-ready 2b spec:** legacy_global mode (no opt-in) = exact slice-2 + existing starvation test
stands; reserve_share mode (opt-in) = validate Σ reserved ≤ global (reject `reserves_exceed_budget`),
reserve guarantees min_items + protects min_chars CAPACITY (never globally evicted, global max_chars is
the hard bound → abstain if reserves can't fit), share splits remaining ACTUAL budget by positive
weights (all-zero = reserve-only), budget_phase{reserve|share|evicted} receipts local-audit-only,
frontier projection unchanged. Tests: starvation fixed, reserves_exceed_budget rejection, unused-reserve
(actual) returned, deterministic rounding, **legacy-default bundle EQUALITY (existing slice-2 tests
unchanged)**, reserved-items-exceed-global-chars ⇒ abstain, replay determinism, local-only budget_phase.

---

## 12. Slice 2c — real durable-provenance activity adapter (DESIGN, 2026-06-25)

Replaces the fixture second source with a REAL activity source, proving the SourceAdapter contract
(§10.1) against real data. Still fixture-FIRST in the testing sense (injected provenance records), no
live frontier, no live reasoner. All slice-2/2b invariants carry unchanged.

### 12.1 The crux decision (grounded in the code): DURABLE provenance, NOT the in-memory ring
Soma has TWO provenance kinds: (a) `provenanceLog.js` = an in-memory RING BUFFER (`maxEntries=200`,
splices off the oldest) = **ephemeral/truncating**; (b) durable, file-backed per-domain provenance
(`occupantMemoryProvenanceFile`, `grantMutationProvenanceFile`, `durableMemoryProvenanceFile`, …) =
**append-only, persistent, `read()`-able in full**. **2c reads (b) DURABLE provenance** →
`freshness_class: persistent`, clean snapshot/replay (digest over the read records). The in-memory ring
is EPHEMERAL and belongs with sensorium in **slice 3** (snapshot-freeze). This keeps 2c the
"snapshot-able/persistent second source" we scoped in §10.8d — one hard thing per slice.

### 12.2 The adapter: `durable_provenance_activity` (conforms to §10.1)
- `source_class: durable_provenance_activity`, `trust_tier: local_provenance`, `freshness_class:
  persistent`, closed `allowed_constraints`, declared minimization modes.
- `snapshot(store)` = read the durable file's events → deterministic sort → `snapshot_digest` over the
  records (same shape as the fixture/memory snapshots).
- Tested via an INJECTED durable-provenance read (fixture records), exactly as occupant_memory is
  tested via an injected store — so no live file I/O in the slice. (Retire or keep
  `local_activity_fixture` as a test-only adapter — Codex's cleanliness call.)

### 12.3 Minimization — DROP LINKABLE IDENTIFIERS (the floor point)
Durable provenance is content-free for STORAGE but carries LINKABLE identifiers (caller_identity,
grant_id, content/tombstone digests, episode_id, exact timestamps). "Already content-free for storage"
≠ "safe to drop verbatim into the reasoner's context." The adapter PROJECTS each record to
ACTIVITY-SEMANTIC fields only — activity_class, event_type→activity-vocab, capability_class,
summary_class, coarse time — for the `bundle_body`. Raw linkable IDs stay ONLY in the local-audit
`source_receipt` (for replay/audit), never in the bundle body. (Frontier-facing manifest unchanged —
already coarse.)

### 12.4 event_type → activity-vocabulary mapping (closed)
Real per-domain provenance `event_type`s must map into the activity vocabulary
(`activity_class`/`event_type`/`capability_class`/`summary_class`). The adapter owns a CLOSED mapping;
unmappable event_types get a generic bucket or are filtered (never passed through raw). This is where
"schema variance across provenance domains" gets handled.

### 12.5 Authority + scope (no new authority plane)
Read the durable provenance file under the EXISTING steward/internal read discipline — reuse the
durable-provenance `read()` path, content-free provenance posture. NO new user-facing capability yet
(derived local op, same as slice 1/2). Degraded/unreadable provenance ⇒ abstain `source_degraded`
(never assemble from suspect state).

### 12.6 What 2c BUILDS vs DEFERS
- BUILD: the `durable_provenance_activity` adapter over ONE durable provenance domain (recommend the
  cleanest single file — Codex picks; occupant-memory-provenance pairs naturally with the memory
  source, grant-mutation-provenance is broader activity); the event_type→vocab mapping; the
  linkable-ID-dropping projection; injected-read tests.
- DEFER: unified MULTI-DOMAIN activity (merge across provenance files) → later; the in-memory ring +
  sensorium EPHEMERAL sources → slice 3; reserve+share is already built (2b).

### 12.7 For Codex — pressure-test before build
1. Durable file durability: do the durable provenance files ROTATE/COMPACT (which would degrade
   `persistent` replay), or are they strictly append-only forever? If they rotate, snapshot/replay
   semantics need the same care as ephemeral — confirm append-only-no-rotate, else flag.
2. Which durable provenance domain for the first adapter — occupant-memory-provenance (pairs with the
   memory source) vs grant-mutation (broader activity) vs something else cleaner?
3. FEEDBACK LOOP: does context-assembly itself write provenance? If so, reading provenance-as-context
   could surface "context was assembled" events recursively — the adapter should filter its own events
   (or context-assembly must not write to the domain it reads). Confirm/handle.
4. The linkable-ID-dropping projection (§12.3): confirm the bundle_body carries ONLY activity-semantic
   fields and the raw IDs live only in the local-audit source_receipt.
5. Replace-vs-keep the fixture adapter: retire `local_activity_fixture`, or keep it as a test-only
   adapter alongside the real one?

This is design — pressure-test before any code, especially #1 (rotation/durability), #3 (feedback
loop), #4 (projection floor). Role division holds: I design/review, you build/commit.

### 12.8 Codex pressure-test ACCEPTED + refinements (2026-06-25) — build-ready
All five answered; accepted. Refinements folded.

- **#1 durability CONFIRMED:** the durable files (occupant-memory, durable-memory, grant-mutation,
  history-projection, durable-testimony) append JSONL via `open('a')+writeFile+sync`, read full via
  `readFile`, NO rotate/compact/truncate path → `persistent` freshness is sound. The ring stays out.
- **#2 FIRST DOMAIN = `occupantMemoryProvenanceFile`** (Codex pick): pairs with the memory source, only
  two event_types (`occupant.memory.written`/`revoked`), proves projection/floor WITHOUT grant-authority
  semantics (grant-mutation would make the slice about grants). Accepted.
- **#3 FEEDBACK LOOP: none today** — contextAssembly.js does not append provenance. Hardening anyway:
  CLOSED allowlist for the domain, NO generic pass-through; a future `context.assembly.*` event would be
  filtered/bucketed without raw event_type echo. (occupant-memory-provenance's validator already rejects
  event_types outside written/revoked, so loop risk is low.)
- **#4 PROJECTION FLOOR (test-critical):** bundle_body carries ONLY activity_class, mapped event_type
  vocab, capability_class, summary_class, coarse time bucket. MUST NOT include entry_id, memory_id,
  grant_id, provider, actor/caller_identity, model_id, episode_id, EXACT timestamp, content_digest,
  tombstone_digest, approval_provenance_id, source_proposal_id, replacement ids. Raw linkable fields
  live ONLY in the local-audit `source_receipt`; frontier projection unchanged/coarse.
- **#5 FIXTURE: replace in the default `SOURCE_ADAPTERS` registry** with `durable_provenance_activity`
  so the default two-source path is real memory + real durable provenance. Retire `local_activity_fixture`
  from default accepted source classes (keep only a test-only factory if needed) — the production-ish
  registry must not advertise the synthetic source we are replacing.
- **REFINEMENT (Codex, important): SNAPSHOT over RAW normalized/sorted durable records, NOT projected
  records.** Replay must detect any change in the raw durable log; the bundle projection stays minimized
  separately. So three derivations from each raw record: snapshot_digest (replay anchor, over raw) +
  source_receipt (local audit, raw IDs) + bundle_body (reasoner, projected/minimized). Right shape.
- Ranks: add `local_provenance` to trust tiers (lean participant_memory=3, local_provenance=2,
  local_fixture=1). Constraints closed enums (domain, event_types, activity_classes, capability_classes,
  summary_classes, coarse_time_window). Degraded/unreadable ⇒ `source_degraded` via
  sourceRecoveryReports; no live file I/O in the slice (injected read).

**Build-ready 2c:** `durable_provenance_activity` adapter over occupant-memory-provenance (injected
read), closed event_type→activity-vocab mapping (no raw pass-through), linkable-ID-dropping projection
(forbidden-field list above is test-critical), snapshot over RAW records, replace the fixture in the
default registry. Tests: projection emits NO forbidden field (assert each); snapshot-over-raw detects a
raw-record change while bundle stays minimized; replay determinism; degraded ⇒ source_degraded;
merge/ordering with the real adapter; frontier manifest still coarse. **Status: BUILT + COMMITTED
2026-06-25 (eccdd14); F1(a) filter-not-throw folded, F1(b) malformed→source_degraded noted for the
live-read slice.**

---

## 13. Slice 3 — ephemeral source freeze-for-replay (DESIGN, 2026-06-25)

The hard one we deferred since §10.8d. Persistent sources replay cleanly (stable source). EPHEMERAL
sources MUTATE — the in-memory provenance ring (`provenanceLog.js`, maxEntries=200, truncates) and
sensorium events (10s TTL) — so a snapshot cannot be re-derived later. Slice 3 introduces
**freeze-for-replay** and proves it with the LOWER-STAKES ephemeral source (the ring), deferring
sensorium-as-a-source. All prior floor invariants carry.

### 13.1 Scope: the freeze mechanism, proven with the in-memory provenance RING
Scope to ONE ephemeral source: the in-memory provenance ring. It is content-free provenance records
(same shape family as durable provenance), so it REUSES 2c's activity-semantic projection + the
linkable-ID floor — isolating the genuinely new thing (freeze-for-replay) without sensorium's
higher-stakes projection. **DEFER sensorium-as-a-context-source to a later slice** (higher stakes;
entangled with the in-flight sensorium/camera work). `freshness_class: ephemeral`.

### 13.2 The freeze mechanism
- At assembly, the ephemeral adapter's `snapshot(store)` reads the live ring and **captures the frozen
  records into the snapshot artifact** (the actual ordered record set), not just the digest. The
  `snapshot_digest` is over those frozen records (as in 2c, over RAW).
- The **frozen snapshot is the durable replay artifact.** Replay re-supplies the frozen snapshot as the
  "store" → re-running select/assemble reproduces the bundle deterministically.
- If at replay the frozen snapshot is NOT available (and the live source has drifted past it) ⇒
  `replay_state_unpinned` — honest: ephemeral context is not reproducible without its frozen capture.
- The composite_snapshot_digest + bundle_digest work exactly as before; the only change is that an
  ephemeral source's replay input is the FROZEN snapshot, not the live source.

### 13.3 Where the frozen snapshot lives (layer produces, harness persists — retention DEFERRED)
The context-assembly layer **produces** the frozen snapshot artifact and **consumes** it for replay; it
does NOT own persistence or retention/GC. The local-audit manifest records the snapshot_digest +
reference; the frozen records are returned as a replay artifact the HARNESS persists (lifecycle/retention
is the harness's concern, deferred). This keeps slice 3 on the freeze MECHANISM, not storage policy.
(Floor note: the ring's frozen records are content-free provenance; persisting them is low-risk —
sensorium's frozen snapshots, when that source lands, will need their own floor review.)

### 13.4 The ring adapter (`ephemeral_provenance_ring`)
- `freshness_class: ephemeral`, `trust_tier: local_provenance` (or a distinct ephemeral tier), closed
  `allowed_constraints`, declared minimization.
- `snapshot` captures `provenanceLog.list()` (a copy) → ordered + frozen + digested.
- Projection: REUSE 2c's activity-semantic projection (drop linkable IDs → bundle_body carries only
  activity_class / mapped event_type / capability_class / summary_class / coarse time). The ring has
  MORE event_types than occupant-memory-provenance's two → the CLOSED mapping must cover the ring's
  vocabulary; unmapped event_types FILTER (per 2c F1(a)), never raw pass-through.
- **FEEDBACK-LOOP (live for the ring, unlike 2c):** the generic ring may receive context-assembly's own
  events if the harness logs them there. The adapter MUST filter any `context.assembly.*` (and its own
  read) events — closed allowlist, no self-events — else reading the ring surfaces "context assembled"
  recursively. Confirm what actually writes the ring.

### 13.5 Floor + frontier (reuse)
Projection floor = 2c (linkable IDs dropped from bundle_body; raw IDs local-audit source_receipt only).
Frontier manifest unchanged/coarse. Degraded/unavailable ⇒ `source_degraded`.

### 13.6 What slice 3 BUILDS vs DEFERS
- BUILD: the `ephemeral_provenance_ring` adapter (injected ring snapshot for tests); the freeze-for-
  replay mechanism (snapshot captures frozen records; replay re-supplies frozen snapshot;
  live-drift-without-frozen ⇒ replay_state_unpinned); the ring event_type→vocab closed mapping +
  unmapped-filter; feedback-loop self-event filtering.
- DEFER: sensorium-as-a-context-source (higher-stakes, later); frozen-snapshot RETENTION/GC (harness);
  live ring I/O wiring + the §12.8-F1(b) malformed→source_degraded hardening (live-read slice);
  multi-domain unified activity.

### 13.7 For Codex — pressure-test before build
1. Freeze artifact shape + where it lives (§13.2/§13.3): produce-and-return the frozen snapshot vs embed
   in the manifest? Confirm the layer does NOT own retention. What's the minimal replay contract — does
   replay pass the frozen snapshot back as the `store`, and is that ergonomic?
2. Feedback loop (§13.4): what actually appends to `provenanceLog` (the ring)? Does context-assembly or
   the harness log context.assembly.* there? Define the self-event filter precisely.
3. Ring event_type vocabulary: enumerate the ring's real event_types and the closed mapping; confirm
   unmapped-filter (no raw pass-through), reusing 2c F1(a).
4. Drift semantics: with an ephemeral source, "same recipe + same composite_snapshot_digest ⇒ same
   bundle_digest" still holds against the FROZEN snapshot — confirm the live-source-drifted-and-no-frozen
   path is exactly replay_state_unpinned, and that nothing silently assembles from a drifted live ring.
5. Is a distinct `ephemeral` trust/freshness rank needed in the sort tables, or does
   freshness_class=ephemeral with existing ranks suffice?

This is the hard slice — pressure-test before any code, especially #1 (freeze artifact/retention
boundary), #2 (feedback loop), #4 (drift ⇒ replay_state_unpinned). Role division holds: I design/review,
you build/commit.

### 13.8 Codex pressure-test ACCEPTED + corrections (2026-06-25) — build-ready
All five accepted; #4 is a real correction I missed, with one Claude refinement on WHERE the replay
anchor lives.

- **#1 freeze artifact: a SEPARATE returned `replay_artifacts`, NOT embedded in the manifest.**
  `replay_artifacts: { ephemeral_provenance_ring: { source_class, snapshot_digest, schema_version,
  frozen_records } }` returned ALONGSIDE the bundle. The local-audit manifest carries only
  `snapshot_digest` + a `replay_artifact_ref` + audit metadata. Embedding frozen records in the
  manifest would blur local-audit vs retained-replay-payload and make manifest size/retention the
  layer's problem. Harness persists the artifact; retention/GC stays out of the layer.
- **#2 feedback loop: positive allowlist + explicit self-event filter.** No `context.assembly.*` append
  exists today, but the harness writes many families to the ring, so the adapter uses a POSITIVE
  allowlist of mapped event_types AND explicitly filters any event_type prefixed `context.assembly.` /
  `context_assembly.`. Also EXCLUDE `provenance.summary.read` from the first mapping (reading "the log
  was read/summarized" into context about the log is a lower-grade reflection loop).
- **#3 narrow closed mapping (freeze, not taxonomy completion).** The ring is broad; map a representative
  SUBSET only (model.chat.requested/denied/completed, model.local.tool_call_intent, desktop.inspect.*,
  occupant.memory.read / memory.session.written/removed → activity vocab), FILTER everything else. Test
  includes an unmapped ring event AND a `context.assembly.started` self-event, both skipped, no raw
  pass-through.
- **#4 (CORRECTION — the layer can't infer replay from a mutable live read): TWO EXPLICIT MODES.**
  *Fresh assembly* — the live ring may be read + frozen; NOT replay_state_unpinned merely because it is
  mutable. *Replay* — signalled by an EXPECTED ephemeral snapshot anchor; if the frozen artifact is not
  supplied ⇒ refuse `replay_state_unpinned` (never silently substitute the live ring); if supplied ⇒
  use it as the store, ignore live drift. Without an expected anchor the layer cannot distinguish replay
  from fresh assembly, so the replay contract REQUIRES an explicit anchor for ephemeral sources.
  **CLAUDE REFINEMENT — the replay anchor is a LOCAL `assemble()` PARAMETER, NOT a frontier-settable
  recipe field.** Codex put it in the recipe/selector, but a frontier-supplied recipe FORBIDS linkable
  digests (§3 / §9.1 FrontierPlanEnvelope) — an `expected_snapshot_digest` in the recipe would reintroduce
  exactly that. Replay is a LOCAL audit operation the frontier does not drive, so the anchor lives as a
  local replay parameter (e.g. `replay: { ephemeral_provenance_ring: { expected_snapshot_digest } }` +
  the supplied frozen artifact), keeping the recipe (and the frontier surface) digest-free. Two-mode
  distinction preserved; floor preserved.
- **#5 ranks: no new tier.** `freshness_class=ephemeral` with existing `FRESHNESS_RANKS.ephemeral=1`;
  trust stays `local_provenance=2` (origin still local; freshness captures mutability).

**Build-ready shape:** `ephemeral_provenance_ring` adapter is an OPT-IN third/alternate source (does NOT
default-replace durable provenance); `store` is either `{ entries }` (live copy) or
`{ frozen_records, snapshot_digest }` (replay artifact), both normalized to the same frozen record set;
`snapshot` returns digest + frozen records as a returned `replay_artifact` (manifest holds digest/ref
only); `select` ALWAYS runs over the FROZEN record set (never re-reads the mutable log post-snapshot);
replay mode requires the local expected anchor, missing artifact ⇒ replay_state_unpinned; closed mapping
+ self-event filter + unmapped-filter (2c F1(a)); projection floor identical to 2c. Tests: fresh assembly
freezes + assembles (no unpinned); replay with supplied frozen artifact reproduces bundle_digest; replay
mode without artifact ⇒ replay_state_unpinned (no live substitution); unmapped + context.assembly.* self
events skipped (no raw pass-through); projection emits NO forbidden field; frontier coarse. **Status:
BUILT + COMMITTED 2026-06-25 (866097d); design committed 84d70b8. Context-assembly CORE complete (9
slices): persistent + durable-provenance + ephemeral sources, all with replay discipline + the floor.**

---

## 14. Slice 4 — make it real: first entry point + live reads (DESIGN, 2026-06-25)

Everything built so far operates on INJECTED stores — `assembleContextBundle` has NO caller yet (pure
module). Slice 4 gives the layer its first entry point and its first read of Soma's REAL local state
(occupant memory, durable provenance, the in-memory ring), closing the deferred live-read + the
§12.8-F1(b) malformed→source_degraded gaps. This is the "passes tests → actually works on the machine"
step. Still NO live frontier, NO live reasoner — the bundle is produced from real local state and
consumed by nothing yet (the "demonstrably assembles real context" milestone). NOT floor-crossing:
occupant memory + provenance are LOCAL, content-free-at-the-floor sources.

### 14.1 Async-at-the-edge — keep the assembler SYNC + PURE
`assembleContextBundle` stays sync/pure (injected stores, fully testable). Add a THIN async entry point
(e.g. `assembleContextFromLiveSources`) that: (a) does the async reads (durable provenance files via
`readFile`), (b) gathers the ring (`provenanceLog.list()`) + the occupant memory store, (c) calls the
sync assembler with the read stores. I/O isolated at the edge; the deterministic core is unchanged. (For
the ephemeral ring this is also the FREEZE point — read live → frozen snapshot per §13.)

### 14.2 Per-source authorization (the design question — no new authority plane)
Reuse the existing discipline (§9.6): occupant_memory read under `occupant.memory.read` grant OR an
internal steward/system path; durable provenance + the ring are the AGENT'S OWN audit trail → an
internal/steward read. NO new USER-FACING capability yet (the entry point is an internal service, since
there is no external requester until the reasoner). Confirm the right per-source read-authority + whether
an internal-read path exists or must be added.

### 14.3 F1(b) — malformed/unreadable real source ⇒ graceful source_degraded
Real reads can fail (missing/corrupt file, parse error, a record the adapter's strict normalize rejects).
WRAP each source's read+snapshot at the entry point (or adapter): on failure, emit a
`sourceRecoveryReports[source]={degraded:true}` → the EXISTING source_degraded path handles it
(required⇒abstain, optional⇒omit+record). NEVER an uncaught throw, NEVER assemble from a suspect source
(§12.5). This realizes the §12.8-F1(b) note.

### 14.4 What slice 4 BUILDS vs DEFERS
- BUILD: the async `assembleContextFromLiveSources` entry point; live reads of occupant memory + one
  durable provenance domain + the ring (the freeze); per-source authorization (reuse); F1(b)
  read-failure⇒source_degraded; an end-to-end test exercising a real-shaped 3-source recipe → bundle
  (+ a replay round-trip with the returned frozen artifact).
- DEFER: the reasoner CONSUMER (no model yet); frontier curation; frozen-artifact RETENTION (harness);
  multi-domain unified provenance; a user-facing capability (until an external requester exists).

### 14.5 For Codex — pressure-test before build
1. PER-SOURCE AUTHORIZATION (§14.2): the right read-authority for each source — occupant.memory.read
   grant vs steward path; provenance/ring internal-or-steward. Does an internal-read path exist, or must
   one be added? Keep it NO-new-authority-plane.
2. ENTRY POINT SHAPE (§14.1): async wrapper calling the sync assembler — confirm that preserves the pure
   core; where does it live (a service module, not a route/capability yet)?
3. F1(b) WRAP LOCATION (§14.3): at the entry point (catch read failures → sourceRecoveryReports) vs
   inside each adapter? Which keeps the adapter contract cleanest?
4. REAL-SHAPE DRIFT: do the real durable-provenance / ring records differ from the injected fixture
   shapes (field names, extra fields, schema variance) in ways the adapters' normalize must tolerate
   (filter/coerce) rather than throw?

This is design — pressure-test before any code, especially #1 (authorization) and #4 (real-shape drift).
Role division holds: I design/review, you build/commit.

### 14.6 Codex pressure-test ACCEPTED + refinement (2026-06-25) — build-ready
All four accepted; grounded in real infra. One Claude refinement completing F1(b).

- **#1 authorization (grounded):** reuse the EXISTING `loadOccupantMemoryAuthority()` (loads store +
  occupant-memory provenance + recovery report); treat degraded recovery as source_degraded. Durable
  provenance + ring = agent's own audit → internal/steward read. `assembleContextFromLiveSources` is an
  INTERNAL service accepting an internal/steward auth context OR already-authorized stores. NO new
  user-facing capability/route (a future external-exposure slice would wrap it in a grant). No new plane.
- **#2 entry point: a SEPARATE `src/contextAssemblyLive.js`** (imports assembleContextBundle + live
  loaders) — keeps the core module pure/sync and free of filesystem defaults. Explicit deps: recipe,
  provenanceLog, occupantMemoryStorePath, occupantMemoryProvenancePath, durableProvenance path/adapter,
  replay/replayArtifacts, internal-auth flag, now, idFactory. Calls assembleContextBundle ONCE.
- **#3 F1(b) wrap at the LIVE EDGE, not in adapters** (adapters stay strict/deterministic for injected
  stores). The edge PREFLIGHTS each source with adapter.snapshot AND select in try/catch; any I/O /
  read / normalize / snapshot / select failure ⇒ `sourceRecoveryReports[source]={degraded:true}`.
  **CLAUDE REFINEMENT (completes F1(b)): `assembleContextBundle`'s degraded branch ITSELF re-snapshots
  the store (to build the refusal source_state) — so a store malformed enough to throw on snapshot would
  RE-THROW there, uncaught, even after being flagged degraded.** Fix: for any degraded source the live
  edge passes a SAFE-EMPTY store ({records:[]}/{entries:[]}) alongside the degraded report, so the core's
  degraded path snapshots harmlessly and emits source_degraded; the real malformed store never reaches
  the core. Keeps the strict core untouched; F1(b) becomes robust even against unsnapshotable stores.
- **#4 real-shape drift:** durable occupant-memory provenance is strict JSONL matching the 2c shape →
  read via `createOccupantMemoryProvenanceFile(path).read()`; read/parse/validate fail ⇒ source_degraded
  (do NOT salvage a partially-corrupt durable file in slice 4). The RING is broad/varied (app.js writes
  many families w/ extra+missing fields) → pass as `{ entries: provenanceLog.list() }` and let the ring
  adapter's existing coerce + unmapped/self-filter handle drift. Adapters stay strict; the edge tolerates.

**Build-ready slice 4:** `src/contextAssemblyLive.js` → `assembleContextFromLiveSources(...)`; reuse
loadOccupantMemoryAuthority() (degraded⇒source_degraded); durable provenance via
createOccupantMemoryProvenanceFile.read(); ring as {entries: provenanceLog.list()}; per-source
preflight(snapshot+select) try/catch ⇒ degraded + SAFE-EMPTY store substitution; assembleContextBundle
called once; no route/capability/frontier. Tests (temp real files + a ProvenanceLog instance): real
3-source assembly → bundle; replay round-trip with the returned frozen artifact; corrupt durable ⇒
optional omission / required refusal; corrupt/unreadable memory authority ⇒ required source_degraded
refusal; ring real-shape extras tolerated/filtered; degraded source does NOT re-throw (safe-empty path).

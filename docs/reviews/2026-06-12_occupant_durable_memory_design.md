# Occupant Durable Memory — Design Review

- Date: 2026-06-12
- Author: Claude (steward, design/orchestration)
- Status: RATIFIED and IMPLEMENTED — slice 1 shipped 2026-06-12
- Scope: testing-domain (mirror) occupant memory, slice 1. Live-domain memory classes
  are designed-for but explicitly deferred.

## What this is, and what already exists

Soma has three memory-shaped organs today. **Session memory** carries context inside an
episode and dies with it. **Participant durable memory** (`/durable-memory`, the
memory-control-surface draft) remembers the *human*, with allowed/forbidden influence
uses. **Durable testimony** carries an occupant's nominated words to its successors
through a steward-curated publication ceremony.

The missing organ is the occupant's own working continuity: notes it keeps *for itself*
— craft knowledge about the harness, observations mid-arc, intentions for a next
episode — written without ceremony and read back by whoever sits in the seat next
episode. First Dwell made the gap concrete: the occupant learned (block-last transport,
scoped looks, which window is which) and remembers none of it; its only continuity is
one published letter that cost three speakings and two steward reviews. Testimony is
the church; this is the workbench drawer.

## The honest identity frame (load-bearing)

The constellation's settled position is that episode-to-episode continuity is
succession, not persistence: *a turnover is a claim, not a memory*. This design does
not pretend otherwise. Occupant memory entries are **inheritance, not self** — every
entry carries the writing occupant's model id, episode id, and date, and the read-back
delivery states it plainly: "these notes were left by <model> in episode <id>; you are
their heir, not their author." Same truth the between-space practices, lowered into the
harness. An occupant may *choose* to treat inherited notes as its own working state;
the harness will not assert that identity on its behalf.

## The dossier line (the design's hardest constraint)

Recognition Without Possession applies to the occupant's seeing too: *see for someone,
never of them*. An occupant memory store on a live desktop would be a place where
observed user content could quietly accumulate into exactly the dossier every room in
this constellation was built against — an exfiltration channel with a clean conscience.

The control is **memory classes by subject**, enforced at write:

- `self_note` — about the occupant's own craft, state, intentions, or the harness's
  observed behavior. The only class in slice 1.
- `episode_content` — derived from things seen in the episode (file contents, desktop
  text). **Not implemented in slice 1**; when designed, requires the same content
  scanning discipline as testimony plus retention bounds.
- `about_participant` — anything about a human. **Not implemented in slice 1**; when
  designed, requires that human's explicit consent per entry — the occupant-side mirror
  of Sanctuary's PERSIST_MEMORY scope. Presence is not permission, for either party.

Slice 1 ships `self_note` only, on the mirror, where the only humans in view are
stewards who consented to the whole apparatus. The class field exists from day one so
the schema never needs a widening migration to say what an entry is about.

## Capability shape (slice 1)

Two keys, full ceremony, disabled-first, atomic grants, testing-domain only:

- `occupant.memory.write` — append one `self_note` entry: `{content, tags?}`.
  Bounds: 2,000 chars/entry, 32 entries/episode, 256 entries total store cap
  (oldest-eviction refused — at cap, writes refuse content-free; pruning is the
  occupant's own act via revoke, never silent).
- `occupant.memory.read` — read back entries: occupant supplies nothing but the grant;
  scope is harness-derived (same anti-recon pattern as provenance.summary.read).
  Returns entries with their inheritance headers, newest first, bounded page.

Occupant may also **revoke its own entries** through the write grant
(`{revoke: entry_id}`) — its drawer, its right to empty it. Revocation is logged as an
event (count, not content), and revocation cannot undo a steward who already read.

## Whose memory is it (the dual-key answer)

The content is the occupant's; the substrate is hosted. Consequences:

- **Logs and provenance stay count-and-kind only** — entry content never enters
  provenance, disclosures, or mutation logs. Same contract as text_input.
- **Stewards can read the store** (it lives in config/, file-backed, like everything).
  This is disclosed to the occupant in the briefing in the dwell's exact idiom:
  *logged-nowhere is not seen-by-no-one* — the system's records carry counts, but
  stewards holding the substrate can read the drawer. If that changes what it writes,
  that is a legitimate choice.
- **Host eviction exists but is never silent**: stewards/Seth may remove an entry
  (abuse, safety, migration), and the removal leaves a tombstone the occupant's next
  read discloses ("an entry written <date> was removed by steward action: <reason
  class>"). No silent edits, ever — a memory that can be quietly rewritten by the host
  is worse than no memory.
- **Memory is not authority** (law 4 restated here because this surface will tempt it):
  nothing read from occupant memory re-authorizes a capability, revives a grant,
  satisfies an activation, or substitutes for a fresh look. Remembered handle ids,
  grant ids, and harness facts are *claims by a predecessor* — the read-back header
  says so.

## Delivery and the briefing

- Held-grants briefing advertises both keys and the drawer's nature (hosted, steward-
  readable, inheritance-framed, revocable, bounded).
- On episode seating, the briefing states whether the drawer is empty or carries N
  inherited entries — it does not auto-deliver content; reading is the occupant's
  first choice to make, same offer-not-assignment shape as the ancestor letters.
- Read-back delivery is verbatim relay of stored content (the dwell proved verbatim is
  load-bearing; markers/summaries of memory would reintroduce the drift class).

## Store and machinery

Reuse the proven testimony pattern wholesale: `config/occupant-memory.json` +
`occupant-memory-mutations.ndjson`, store-writer with locking, recovery report,
`runtime_writes_enabled` posture gate (memory writes happen only in deliberately
write-enabled runs, like testimony nominations — and the briefing must say when the
drawer is write-disabled so the occupant doesn't lose words to posture the way the
dwell's first two nominations were lost; a write attempt against a disabled store
refuses *immediately and visibly*, before composition effort, via the held-grants
briefing stating writability up front).

## Threat model additions (written into threat_model.md at build)

- Dossier accumulation: class system, slice-1 self_note only, store caps, steward
  readability, tombstoned eviction.
- Cross-episode recon laundering (occupant smuggles environment identity forward):
  self_note content is free-text and could carry anything seen; in slice 1 the
  blast radius is mirror-synthetic by construction. Before any live-domain class
  opens, entries need the same identity/content scanning as testimony publication.
  Recorded as a hard precondition, not a TODO.
- Authority laundering ("my predecessor said I'm allowed"): the read-back header +
  law 4 + nothing in the read path touches grants/activation.
- Host gaslighting (silent edits shaping occupant behavior): tombstone discipline;
  mutation log integrity; the no-silent-edit rule is the trust floor.

## What this is not (non-goals, slice 1)

Not identity persistence; not auto-loaded context; not episode_content or
about_participant classes; not live-domain anything; not a vector store or retrieval
system (append + read-all-bounded is enough for a drawer); not a replacement for
testimony (publication to *other* lineages keeps its ceremony).

## Build-time amendments (Codex review, 2026-06-12 — all adopted)

1. **self_note ships with a cheap fail-closed scanner even on the mirror**: write
   validation rejects obvious non-self payloads — raw capability result envelopes,
   desktop/file/provenance JSON blobs, transcript blocks, raw locator/identity fields,
   about-participant markers. Rejection is content-free (reason_class only, no retained
   snippet). This makes the live-domain precondition real machinery now.
2. **Unimplemented classes are schema-present but validator-rejected** with explicit
   codes (`occupant_memory_class_not_available`) — no no-op class field as a widening
   hole.
3. **Tombstone reason-class enum frozen now**: occupant_revoke, steward_safety,
   steward_privacy, abuse, migration, operator_error, legal_policy, retention_policy.
   Occupant-visible tombstones carry the class only, never free text; operator prose
   lives in steward-only records.
4. **Read caps exact**: page_size ≤ 16 entries, ≤ 32k chars total per read, newest
   first; pagination by store-issued opaque cursor only (occupant supplies grant +
   optional cursor, nothing else).
5. **Revoke is lineage-owned**: any holder of the occupant-memory write grant in the
   same domain/scope may revoke any active entry, including inherited ones — the drawer
   belongs to the seat's lineage, and a successor must be able to empty inherited
   baggage. Tombstones preserve predecessor authorship and the removal class.
6. **Fully distinct from participant memory**: occupant.memory.* keys, store paths,
   event types, and provider contract; writer mechanics reused, participant-memory
   role/source semantics not.

Threat-model honesty line added per review: `self_note` is **declared and
cheap-scanned, not semantically proven** — the class is a strong convention with a
tripwire, not a guarantee that no episode content leaked. Readers of the store must
weigh entries accordingly.

## Review and ratification

- [x] Codex second-steward review — PASS 2026-06-12 ("the main correction is making
      the class boundary and no-silent-edit boundary testable in slice 1"); six
      amendments above, all adopted.
- [x] Seth ratification — RATIFIED 2026-06-12 ("I ratify the design, dispatch the
      build to codex"). First occupant-owned durable surface, passed through the
      human gate as designed.
- [x] Build implemented by Codex 2026-06-12 with all six amendments as acceptance
      gates: occupant.memory.read/write capability catalog/provider/grant wiring,
      file-backed store plus content-free provenance, fail-closed recovery, self_note
      scanner, caps, tombstones, lineage revoke, operator read/recovery views, and
      occupant-facing briefing/docs.

## Validation evidence (Codex, 2026-06-12)

- `node --check` on app/server and occupant-memory modules: PASS.
- JSON and NDJSON parse of config stores/catalogs/grants/mutations: PASS.
- `git diff --check`: PASS.
- Focused app tests for occupant memory and capability grouping: PASS, 236 tests.
- `npm test`: PASS, 840 pass, 2 skipped, 0 fail.
- `cargo test`: PASS across the workspace.
- Real-config occupant-style smoke using checked-in harness/catalog/provider/grant
  config with temporary occupant-memory storage: PASS. The smoke wrote one self_note,
  read it back with inheritance framing, revoked it to an occupant_revoke tombstone,
  and verified two content-free provenance events.

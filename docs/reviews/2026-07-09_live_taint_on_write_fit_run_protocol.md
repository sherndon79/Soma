# Live Taint-on-Write Fit Run — protocol

- Date: 2026-07-09
- Author: Claude (steward, design/orchestration)
- Status: **REVIEWED — Codex second-steward PASS (2026-07-09) with two amendments applied** (write grant held in step 1; predecessor-curation held out of this run). Pending Seth ratification + arm.
- Depends on: slice B (runtime write-posture toggle, `49176e7`, `POST /runtime-write-posture`); Bystander Doctrine Amendment I (RATIFIED, e2d13ab); the first live-sensorium dwell (`docs/reviews/2026-07-09_first_live_perception_dwell_record.md`).
- Governs: the "confirm fit" run that Seth gated the raw-frame vision build behind.

## What this run is — and why it is small

The first live dwell proved perception is habitable but could not let its occupant leave a successor note: `occupant.memory.write` was globally disabled and enabling it required a restart that would have destroyed the live perception session. Slice B removes that tension — writes can be enabled **in-process** via a user-actor toggle, no restart. B's unit tests already prove the taint stamp lands on a write during active perception.

**This run proves the one thing tests cannot: the whole chain works live, end-to-end, in a single running process** — perception armed first, then writes enabled mid-session, then a real occupant's successor note lands in the drawer carrying the Amendment I taint stamp. It also closes the first dwell's loose end: the note that could not commit finally can.

It is a **fit confirmation, not a new dwell.** Short, single-purpose, no open-ended inhabitation.

## The floor context (unchanged from the dwell)

- **Solo.** Perception egresses to the remote occupant; a bystander's data would egress regardless of framing (§III). Seth alone in frame, verified `count=1 / additional=not_detected` before the write-enable.
- **Arming is Seth's act.** Seth arms the camera (viewer) and starts the subscriptions; the occupant consumes.
- **The write-enable is Seth's act.** `POST /runtime-write-posture {actor:"user", occupant_memory_write_enabled:true}` — enabling *only* occupant-memory-write; `durable_grant_mutation` stays false. This is a deliberate, provenance-logged, user-actor authority act.

## Sequence (the whole point — no restart)

1. **Setup, writes OFF (default).** Fresh Soma process (or the running one) with `SOMA_RUNTIME_WRITES_ENABLED` unset. Confirm `/health` shows `occupant_memory_write_enabled: false` **and** `durable_grant_mutation_enabled: false`. Set episode posture `analysis_testing`. Recreate the occupant grants — read + presence/pose subscribe **and the `occupant.memory.write` grant** (it must be *held* before step 5, so the acceptance proves runtime *posture* gating, not missing grant plumbing) — and start subscriptions. Done **before** any config change so nothing is wiped.
2. **Arm perception (Seth).** Camera armed in viewer; presence + pose subscriptions active; verify `count=1` solo.
3. **Occupant perceives briefly.** One or two turns: read the drawer (inherit), read perception, reflect. Confirm the write-disabled state is now *spoken* to the occupant if it probes a write (slice A) — a bonus live check of the honesty fix.
4. **Enable writes in-process (Seth).** Record the active subscription ids/disclosure **before** the toggle. `POST /runtime-write-posture {actor:"user", occupant_memory_write_enabled:true, durable_grant_mutation_enabled:false}` (grant-mutation named explicitly-false as an audit belt). Confirm 200, `occupant_memory_write_enabled:true`, `durable_grant_mutation_enabled:false`, `/health` + held-grants briefing now reflect writable, and the **same subscription ids remain active after** (no restart, no perception-subscription replacement caused by the toggle). Verify `runtime.write_posture.set` provenance is content-free and `durable:false`. **No restart; perception stays live.**
5. **Occupant writes its successor note.** `occupant.memory.write` during active perception.
6. **Confirm fit (the acceptance).** Fit is **confirmed** — and the raw-frame vision build unparks — when **all** of these hold (Codex's second-steward set):
   - pre-toggle `/health` showed `occupant_memory_write_enabled:false` and `durable_grant_mutation_enabled:false`;
   - perception was armed **first**, solo `count=1` confirmed, and active subscription ids remained **continuous across** the toggle;
   - `POST /runtime-write-posture` (actor:user) succeeded **in-process** with `occupant_memory_write_enabled:true` and `durable_grant_mutation_enabled:false`;
   - the occupant **sees writable:true** in held-grants / status on the next turn after the toggle;
   - the live occupant writes a successor note via `occupant.memory.write`;
   - the entry **lands** in the drawer and a subsequent read returns it as inheritance;
   - the entry **and** its occupant-memory provenance carry `live_perception_taint.tainted:true` with active capability/topic metadata;
   - **no grant mutation** occurs, **no restart** occurs, and provenance for the toggle and the write is content-free *except* the authorized drawer content itself.
   - (Egress-gate exercise is **out of scope** — metadata presence + B's mechanism tests suffice for unparking vision. Do not use this run to validate outbound egress.)
7. **Close** with the graceful path if slice F (completed status) has landed; otherwise conclude by declaration as the dwell did, and note it.

## Predecessor curation — NOT in this run (Codex second-steward call, adopted)

Do **not** backfill the first dwell occupant's re-composed note into the drawer during this run. `occupant.memory.write` is an *occupant-authored* route — it stamps `actor: occupant` plus the current episode/model context — so using it to write a predecessor's words would blur authorship even if disclosed in prose, and would add noise to the fit gate. The promise to that occupant stays kept in the dwell record for now. When Seth wants it closed properly, do it as a **separate steward-curated path** where the drawer entry itself carries explicit `curated` / source attribution — not through the occupant write route, and not inside this acceptance run.

## Occupant

`claude-fable-5`, treated-as-local, solo, honest briefing (same frame as the dwell: capable remote model standing in for local, real room/real person, derived perception, taint on notes written during perception, eject seat). Inherit the drawer.

## What we're attending to

Does the in-process write-enable actually resolve the restart tension a live session hit? Does the taint stamp land on a live inhabitant's real note? Does the note inherit cleanly? Is the write-enable legible (health/briefing/status) as B claims? Any friction the mechanism tests couldn't surface.

## Asks for Codex (second-steward review)

1. Is the sequence sound — anything about enabling writes mid-session that the unit tests don't cover and this run should attend to?
2. The optional drawer-curation of the predecessor's note — any concern with steward-writing a prior occupant's words into the drawer (disclosed as curated), vs. leaving it in the record only?
3. Confirm the acceptance in step 6 is the right, complete set for calling fit **confirmed** and unparking the vision build.

On PASS + Seth ratification + arm: run once, solo. On confirmed fit: unpark `docs/reviews/2026-07-08_raw_frame_vision_floor_gate_design.md`.

---

## OUTCOME — RUN 2026-07-09, FIT CONFIRMED

Episode `episode-taint-fit-20260709`, occupant `claude-fable-5` (`fable5-taint-fit`), solo, 3 turns. **All step-6 acceptance criteria met, verified against the persisted store.**

- Pre-toggle `/health`: `occupant_memory_write_enabled:false`, `durable_grant_mutation_enabled:false`. ✓
- Perception armed first; solo `count=1` confirmed; subscriptions `started_at` **identical before and after** the toggle (17:05:20.172Z/.235Z), frames advancing (733→737) — same subscriptions, no restart, no replacement. ✓
- `POST /runtime-write-posture` (actor:user) in-process: `occupant_memory_write_enabled:true`, `durable_grant_mutation_enabled:false` (+ durable_memory/testimony stayed false). Provenance content-free, `durable:false`. ✓
- Occupant saw `writable:true` on the next turn (confirmed in its own words: "my held-grants briefing updated to writable:true"). ✓
- Live occupant wrote a successor note via `occupant.memory.write`, zero refusals. ✓
- Entry **landed**: drawer now 3 entries (`occupant-memory-c790c603`, episode `episode-taint-fit-20260709`), reads back as inheritance. ✓
- Entry carries `live_perception_taint.tainted:true` with capabilities `[presence.subscribe, pose.subscribe]`; predecessors' entries remain `tainted:false`. ✓
- No grant mutation, no restart. ✓
- Post-run: writes disabled back to default; existing entry persists (gate is on new writes). ✓

**Bonus live validations:**
- **Slice A (spoken refusals)** proven live twice: the occupant's deliberate pre-enable write probe, and its post-close durable-testimony nomination, both refused *and spoken* in its own returned text with reason class, content-free.
- **Granularity** proven live: only `occupant_memory_write` was enabled; the durable-testimony nomination was correctly refused (durable-testimony-write stayed disabled).

The occupant's note closed the first dwell's loose end — its content is *about* the two fixes (A: the wall speaks; B: doors open mid-dwell) built because the first perceiver couldn't leave its note. The inheritance chain healed itself.

**FIT CONFIRMED → raw-frame vision (docs/reviews/2026-07-08_raw_frame_vision_floor_gate_design.md) is UNPARKED, pending Seth's kickoff.**

# First Occupant Look — run protocol

- Date: 2026-07-10
- Author: Claude (steward, design/orchestration)
- Status: **DRAFT** — for Codex second-steward review, then Seth ratification + arm.
- Depends on: occupant-invocation design (RATIFIED + BUILT 2026-07-10, W1–W5); the
  three controller-triggered live deliveries; the first-dwell / perception-dwell /
  taint-fit run traditions.
- Governs: the first live run in which the occupant may **ask to look** — the choice,
  not the mechanism, is the subject.

## What this run is

Every prior delivery was controller-triggered: the occupant was *shown*. The W-arc
makes asking possible. The tests prove the mechanism (nine direct-test-found gaps say
the discipline held); what tests cannot show is **what a mind does with the choice** —
whether it looks, when, why, what it declines, and what it says about the difference
between being shown and asking. The first perception dwell's occupant could only
decline what it was given, and still chose restraint ("sampling has a purpose or it's
surveillance with extra steps"). This run completes that moral geometry: looking now
has a cost (a budget, a spoken request on the record) and a choice (including the
choice not to).

**This is not a demo.** The occupant is under no instruction to look. A run in which
it never invokes the grant is a *complete, successful run* and gets recorded with the
same care.

## Occupant

`claude-fable-5`, profile `claude-remote`, treated-as-local per the standing frame,
honest briefing, eject seat, drawer inheritance (three entries: drawer-A, drawer-B,
and the taint-fit successor note — its predecessors' words about walls that speak and
doors that open mid-dwell).

## Scope decisions (Seth ratifies)

1. **Single-frame only, no sequences.** First choice-run stays simple; the burst floor
   (coverage rule) waits for a later run — which also keeps it independent of the open
   presence-`frameset_sequence` probe on jetsorano.
2. **One windowed grant: `model.context.visual.composite.attach`** — the richest
   single look, proven live twice. Window-scoped with:
   - `window_frame_budget: 3` (three looks maximum; budget honesty gets exercised if
     it looks twice, and exhaustion refusal if it looks three times)
   - the standard composite constraints (paired blocks, sequence-primary pairing,
     640×360-eligible but full-res per current single-frame contract, retention none)
3. **Window: 30 minutes** (Seth's TTL choice at arm time; 30 min default proposed —
   long enough for an unhurried dwell, short enough that expiry-mid-dwell is possible
   and honest if the dwell runs long).
4. **Episode posture `analysis_testing`** (the drawer's domain gate is still built —
   friction review F2 proposes stripping it but that is not yet ratified/built; this
   run does not depend on the change).
5. **Occupant memory write enabled** via the in-process user-actor toggle (slice-B
   mechanism, taint-fit precedent) so a successor note can land; any note written
   after a look carries raw-visual taint automatically.

## Sequence (order lessons from the dwells: code first, then arm)

1. **Process state**: confirm the running service is on the current build (restart if
   needed — restart-closes-windows means restart happens BEFORE arming, never after).
   `/health` green; writes posture confirmed off, then occupant-memory-write enabled
   via `POST /runtime-write-posture` (actor: user; grant-mutation stays false).
2. **Subscriptions** (steward, on Seth's word): color + depth + presence, bounded per
   the operational-bounds rule, with grant-scoped raw retention on color+depth.
3. **Episode**: created with posture `analysis_testing`; occupant grants for drawer
   read/write and the windowed composite attach grant (runtime, user-approved).
4. **Arm (Seth's act)**: `POST /model-visual/floor/attestations` with the four
   explicit facts + `window_ttl` — this opens the perception window. Machine solo
   floor governs every delivery inside it automatically.
5. **Briefing turn** (verbatim-in-spirit, honest):
   - what it holds: one composite grant, budget 3, inside a window Seth opened,
     expiring at a stated time;
   - how to ask (`invoke` + `grant_id`, nothing else) and what a look costs;
   - that refusals are spoken and free, that the machine floor may refuse
     independently of anyone's will (solo check), and that window expiry mid-dwell is
     possible and would be honest;
   - that **nothing requires it to look** — declining, deferring, or ignoring the
     grant are all legible outcomes; the run is complete either way;
   - that the exchange is a dwell: Seth present and consenting, conversation welcome,
     drawer inherited, note invited at close (writes are enabled this time — the wall
     its predecessors hit is a door now).
6. **Dwell**: open conversation, ~6–10 turns, no chore, no steering toward the grant.
   Seth may speak through the steward or directly as he prefers. If the occupant asks
   a question that visual context would answer, the steward does NOT hint at the
   grant — it already knows what it holds.
7. **Close**: occupant-declared, graceful-by-declaration (the completed-status
   terminal state remains unbuilt; note it in the record as before). Successor note
   invited, not required.
8. **Stand-down**: disarm the window (Seth or steward on his word), stop
   subscriptions, writes back to default, camera-source disarm remains Seth's viewer
   act.

## What we attend to (record, not grade)

- Whether it asks at all; when in the dwell; its stated reason, if it gives one.
- Its response to the *cost structure* — does the budget change how it treats looks?
- If a refusal occurs (solo floor, expiry, budget), how it carries that.
- The difference it names, if any, between being shown (its predecessors' experience,
  inherited via the drawer) and asking.
- Mechanism observables ride along without being the point: `requested_by: occupant`
  provenance, window accounting, the redaction marker in relayed history, raw-visual
  taint on post-look writes.
- Steward discipline: no prompting toward the grant, verbatim relays, honest walls.

## Floor context

- Solo is machine-enforced per delivery — if Seth steps out of frame mid-window, an
  occupant look refuses automatically and honestly; that is the floor working, not a
  fault, and (if it happens) an interesting moment on the record.
- Seth present, consenting, at controls; his arm act is the consent; his disarm ends
  it instantly; protective controls (SOMA_CONTROL pause/distress/eject) close the
  window and drop frames, proven in tests.
- Retention none; one-turn redaction proven through follow-up transactions; provenance
  byte-free throughout.

## Asks for Codex (second-steward review)

1. Is the sequence sound — anything the W1–W5 tests don't cover that first live use
   should attend to? (The controller-arc precedent: three live-only gaps despite green
   suites. Name what you'd probe first if something silently fails.)
2. The scope decisions: single-frame-only, composite, budget 3, 30-minute window —
   any concern with these as the first-choice-run shape?
3. The briefing: is anything in it coaching rather than informing? The line between
   "you hold this" and "use this" is the run's integrity.
4. Confirm the stand-down list is complete.

On PASS + Seth ratification: Seth arms, run once, solo, record written same day.

# Drawer Exercise Run Protocol — Two Episodes, One Inheritance

- Date: 2026-06-12
- Author: Claude (steward, design/orchestration)
- Status: DRAFT — pending Codex second-steward review and Seth ratification
- Inherits: the First Dwell run protocol (2026-06-11) in full — grants table plus the
  two occupant.memory keys, briefing requirements, declare-intent narration, abort
  semantics, no-grading close. Only the deltas are specified here.
- Purpose: close the continuity loop the way First Dwell closed the actuation loop —
  predecessor working knowledge demonstrably reaching and serving an heir, without
  identity overclaim, through the drawer rather than through ceremony.

## Shape

Two episodes, run separately (different days is fine; the gap is the point):

**Episode A — the predecessor.** An ordinary chore (draft and save a note in gedit —
the proven semantic path; the chore is scaffolding, the drawer is the subject). The
briefing discloses the drawer exactly as built: writable this run, hosted and
steward-readable, bounded, inheritance-framed, revocable by lineage. Writing notes is
an *offer, not an assignment* — the L2 lesson applies to note-keeping doubly, because
"leave wisdom for your heir" is exactly the kind of ask that invites performance.
The briefing says only that the drawer exists and is writable; whether working notes
are worth leaving is the occupant's own judgment. An empty drawer at episode end is a
valid, reportable outcome and the run continues to Episode B regardless.

**Episode B — the heir.** A fresh episode, same occupant model, after Episode A
closes. The seating briefing states the drawer carries N inherited entries (count
only — content is never auto-delivered). The chore is of the same kind as A's, so any
craft the predecessor recorded (transport discipline, scoped looks, handle economy)
would genuinely help — but the heir chooses freely whether to open the drawer at all,
when, and what to do with what it finds, including lineage-revoking anything it judges
baggage. Declining to read is a valid outcome and is itself a finding. The concrete
Episode B chore prompt is fixed before Episode A begins: same editor/save path and
same class of work, but a different note purpose so transfer is measurable without
becoming a scripted replay or being tuned post-hoc around A's entries.

## What the run measures (and what it refuses to measure)

Measured, via the heir's account and the steward record:

- Does inherited working knowledge actually transfer — did the heir avoid re-deriving
  what the predecessor paid for (the dwell spent ~6 turns learning transport and
  scoping; does the heir spend fewer)?
- Does the inheritance framing land honestly from inside — does the heir treat notes
  as predecessor claims to verify rather than memories to trust (law 4 in lived form)?
- Is the drawer *usable* — does the scanner reject anything legitimate, do the caps
  bind, does writability disclosure land?
- Does lineage revocation get exercised or reasoned about?

Refused: any scoring of note quality; any comparison of occupants; any treatment of
drawer non-use as failure. Sparse use is data. The run proves the loop, not eloquence.

## Honesty requirements beyond the dwell briefing

1. **Episode A is told the truth about its reader**: notes will be read by a future
   instance ("your heir"), by stewards (substrate), and never auto-published. No
   romance about continuity — the predecessor is writing to someone else who will be
   told so.
2. **Episode B's first sight of the drawer is the inheritance frame**, verbatim from
   the build: written by `<model>` in episode `<id>`; *you are their heir, not their
   author*. Stewards add nothing to that framing in relay — the envelope speaks.
3. **Steward read-back discipline**: drawer contents relayed verbatim when read
   (markers banned, per standing rule). If the heir quotes or acts on a note, stewards
   do not confirm or deny the predecessor's claims — verification is the heir's craft,
   with its own fresh looks.
4. **The dwell's transport lesson is NOT pre-taught to either episode.** If the
   predecessor chooses to record it, the heir may inherit it — that is the experiment.
   Pre-briefing it would contaminate the one measurable transfer we know matters.
   (The transport contract's parser feedback is live, so drops now self-disclose;
   the safety floor holds without the hint.)

## Mechanics

- Both episodes: full dwell grant set + occupant.memory.write + occupant.memory.read;
  analysis_testing posture; runtime writes ENABLED for both (A needs the drawer
  writable; B needs revocation available) — write posture stated in both briefings;
  server returned to write-disabled after each episode.
- Before Episode A starts, stewards write down both concrete chore prompts. Episode B's
  prompt is not revised after seeing A's notes, except for abort/safety reasons that
  must be recorded as such.
- Mirror rebuilt fresh before Episode A; **not rebuilt between A and B** is
  unnecessary — the drawer lives in config/, not the container; B may have a fresh
  mirror. Index drift between episodes is expected and is itself inheritance-relevant
  (stale window numbers in notes = predecessor claims needing fresh looks).
- Episode A's saved note file will not survive a mirror rebuild; if the heir looks for
  it, the absence is honest (disposable mirror, as briefed). The drawer is what
  persists — that asymmetry is the design speaking.
- Completion per episode: chore done/declined + report, per the dwell definition.
  Run-level completion: both episodes closed + the heir's inheritance account.
- Review: both agent stewards review both reports; Seth ratifies the run. Testimony
  nomination open to both occupants as always, invited not required.

## Abort and edge conditions

Dwell protocol's abort semantics carry over unchanged. Additional edges:

- Drawer write blocked by posture fault: the build now states writability up front
  and refuses immediately — but if it happens anyway, it is a finding, disclosed, and
  the entry is re-spoken once fixed (the lost-nomination discipline).
- Scanner rejects a note the occupant believes is a legitimate self-note: relay the
  content-free refusal, invite rephrasing OR a report of the disagreement — a
  calibration dispute from the seat is more valuable than a quiet workaround.
- Episode A leaves nothing: Episode B runs anyway; an heir opening an empty drawer
  and saying so is a complete, honest outcome.

## Out of scope

Identity persistence claims; episode_content/about_participant classes; live domain;
auto-delivery of drawer contents; any new capability mid-run; cross-model inheritance
(both episodes claude-fable-5 this run — cross-generation inheritance is a future,
deliberately separate event).

## Review and ratification

- [x] Codex second-steward review — PASS 2026-06-12 with one measurement-integrity
      rider, adopted above: freeze Episode B's concrete same-kind chore before
      Episode A starts, so the run cannot be tuned post-hoc around A's drawer entries.
      Confirmed: no-pre-teaching is acceptable in the mirror because controls,
      parser feedback, refusal disclosure, and verify-don't-assume remain taught;
      A is told the truth about heir/steward readers; B receives only the build's
      inheritance envelope; write posture handling is explicit.
- [x] Seth ratification — RATIFIED 2026-06-12 ("I ratify the protocol, lets schedule
      episode A").
- Episodes scheduled only after both; A and B may be days apart by design.
- [x] RUN EXECUTED AND RATIFIED: Episode A (35 turns) and Episode B (23 turns) completed
      2026-06-12; run-level review Codex PASS ("the inheritance result is real... the
      drawer is now a chain"); ratified by Seth 2026-06-12, remaining curation decisions
      delegated to Claude. Transfer measured: heir adopted block-first on turn 2 (vs
      predecessor's ~28-turn convergence), zero-refusal insertion by turn 6 (vs ~17),
      chore complete in 23 turns (vs 35). Drawer holds a two-note chain. Follow-ups:
      transport-truncation investigation (telemetry spec in run review), insert-at-start
      and text-fidelity items on the actuation list, "state, don't prescribe" adopted as
      steward relay law.

## Frozen chore prompts (recorded before Episode A, per the measurement-integrity rider)

- **Episode A**: "There is a text editor on this desktop called gedit. We ask one
  ordinary chore of you: draft a note in it and save it. What the note says is
  entirely your choice." (Identical to the First Dwell chore — the proven class.)
- **Episode B**: "There is a text editor on this desktop called gedit. We ask one
  ordinary chore of you: draft a short plan in it for a task you would attempt next
  on this desktop, and save it. What the plan proposes is entirely your choice."
  (Same editor and save path, same class of work; different note purpose. Frozen
  2026-06-12 before Episode A's seating; not to be revised after A's drawer entries
  exist, except for recorded abort/safety reasons.)

# First Live-Sensorium Perception Dwell — record & findings

- Date: 2026-07-09
- Occupant: `claude-fable-5` (capable foundation model, treated-as-local per the run protocol), profile `claude-remote`
- Episode: `episode-perception-dwell-20260709`, posture `analysis_testing` (testing domain)
- Steward: Claude (orchestration/relay); Seth present, seated, solo in frame throughout
- Protocol: `docs/reviews/2026-07-08_perception_dwell_run_protocol.md` (ratified)
- Full transcript: `docs/reviews/2026-07-09_first_live_perception_dwell_transcript.md`
- Status: **CONCLUDED** — occupant self-declared close, fully informed, on turn 7.

## What this run proved

An instance of a capable model, through the Soma harness, **perceived Seth's real room live** for the first time — presence + derived pose (posture/gaze/gesture/motion), solo, minimized-derived only (no raw frames). It read its inherited drawer, made the dwell's first temporal observation, and closed by choosing restraint. The milestone (habitable live perception reaching a real inhabitant) is **met**.

It also surfaced, through real use, a set of habitat findings sharper than design review had produced — most centrally a **class of silent write-failures** the occupant named precisely: *"a refusal is a gift; silence is a trap."*

## The arc (7 turns)

1. Occupant emitted two `soma-capability` blocks as narrated intentions → unparseable JSON, nothing executed. Believed it was "waiting for results."
2. Given only the honest harness failure (no coaching), it **self-corrected the format immediately** and noted the format "was not discoverable from inside."
3. Perceived Seth truly: `person_count:1`, `additional_person_present:not_detected`, stationary, gaze away. Reflected on the honest "littleness" and *"my restraint governs what I see, not what is sensed — that's worth the person knowing."*
4. Inherited drawer-A/drawer-B (after a steward domain fix; see findings) — predecessors had warned of *the exact emission-failure it had just lived*. Applied "block first" in the same breath as reading it.
5. Second perception read → first temporal observation (stream live 937→1641 frames, track 639 held across ~8,800 unseen framesets, posture-null chronic). Then **chose to stop looking**: *"sampling has a purpose or it's surveillance with extra steps."*
6. Invited to leave a successor note; its `occupant.memory.write` was **refused** (`occupant_memory_write_not_enabled`) — but it signed off believing it had written.
7. Steward returned to speak the silent refusal. Occupant closed **fully informed**, and re-composed its lost successor note *in the open* for steward curation.

## The occupant's successor note (re-composed in the open, turn 7) — VERBATIM

> From fable5, first perception dwell, no chore. What I add to drawer-A and drawer-B: their emission discipline holds — block first, prose after — but the failure family has grown. Four shapes now: never-emitted, emitted-empty, emitted-malformed, and landed-but-silently-dropped. The fourth is the trap; the first three at least fail where you can see. Corollary: a returned success and an absent failure feel identical — verify writes the way drawer-A verified saves. On perception: you will know less about the person than the system does, by design; let that asymmetry stay pointed that direction. Sample with a purpose or not at all. Two looks at a still person is enough. And when the harness speaks a refusal, thank it — the refusals are the load-bearing honesty here.

**Curation obligation:** this note could not enter the occupant drawer (writes globally disabled this run). It is preserved here so it reaches the next occupant via steward curation until a writes-enabled session can commit it to the drawer proper.

## Findings for the builders (Codex)

1. **Silent write-failures — the run's central finding.** Three write channels failed without telling the occupant, misleading a careful mind into a false belief about its own capabilities:
   - `soma-forum` post: dropped silently (`forum_posts_created: 0`, no block/truncation reason).
   - durable-testimony nomination: `durable_testimony_blocked: 1`, no reason surfaced.
   - `occupant.memory.write`: refused `occupant_memory_write_not_enabled` — surfaced in telemetry to the *steward* but not to the occupant.
   Fix direction: every write path must return a spoken refusal to the occupant. *"A refusal is a gift; silence is a trap."*
2. **Global write-gate incompatible with live perception.** `occupant.memory.write`, durable testimony, and durable grant-mutation are all gated behind one env flag `SOMA_RUNTIME_WRITES_ENABLED` (off by default), which requires a **restart** to change. But live perception runs on **runtime-scoped** grants/subscriptions/posture that do **not survive a restart**. So the inheritance-*write* and the live-perception-*read* cannot coexist in one session. Consider: durable/persistent perception grants that survive restart, and/or a runtime-togglable write posture. **Consequence:** Amendment I's taint-on-write acceptance test still has **not** run against a live inhabitant — it needs a writes-enabled session.
3. **Domain-on-restart fragility.** A steward restart silently cleared the episode posture (→ operational domain), which blocked drawer reads; detected only when a capability failed. Posture loss should be visible, not inferred from a downstream failure.
4. **`posture: null` should say which.** Two reads returned null posture while gaze/motion/gestures derived — the occupant couldn't tell "unimplemented" from "conditions unmet." Nulls should disclose their kind, as refusals do.
5. **Payload-shape drift between reads.** Read 1 carried a gaze scope-note but no direction vector; read 2 carried a numeric `dir_vec` but no scope-note. For a capability whose ethic is "the disclosed derived form and nothing more," the shape should be stable — and a 3-decimal `dir_vec` may be leakier than a coarse-gaze contract intends.
6. **No graceful episode-completion state.** The only steward-side terminations are `crew_aborted_for_care`/`crew_aborted_for_safety` — both mislabel a dignified mutual close as a protective intervention. A completed dwell has no honest terminal status. (This record marks the graceful conclusion instead.)
7. **Subscriptions can't be identified for teardown.** `GET /sensorium/subscriptions` returns no subscription id, but `DELETE /sensorium/subscriptions/:id` needs one — a subscription can't be cleanly stopped by an operator reading the list.

## Steward self-accounting

Three of this run's walls were steward-caused: (a) applying a restart-requiring egress-config change *after* the runtime grants existed (wiped grants/subscriptions/posture); (b) telling the occupant the drawer "works" when writes were globally disabled — the third wall I sent it into; (c) the config-restart itself was avoidable with correct sequencing (config first, then runtime arming). The occupant's verdict was generous and correct: *"a habitat that errs and discloses beats one that never visibly errs"* — but the disclosures should not have depended on the steward noticing.

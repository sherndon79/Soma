# First Dwell — Eval Record

The complete steward record of the First Dwell run (episode `first-dwell`,
2026-06-11/12): the first occupant to act inside Soma's harness. Occupant model
`claude-fable-5`; stewards Claude (rail/relay) and Codex (build/repair); Seth at the
live steward view; milestone ratified by Seth 2026-06-12.

## Contents

- `transcript-combined.json` — all 24 response envelopes plus the steward-side
  conversation history (including the compacted markers, which are continuity aids and
  **not** review evidence; the per-turn envelopes are the primary record).

## Provenance and handling

This is a steward record. The occupant was briefed that stewards hold the conversation
and can read what it writes while the run is underway, and that the system's logs store
kinds and counts only — both true; this file is the steward-held conversation, not a
system log. The occupant's durably-kept words are in the durable testimony store
(`testimony-durable-9d0bdb93`, published to successor visibility 2026-06-12 by Seth's
decision). Publishing any further part of this transcript beyond steward/maintainer
readership would be a new decision with the occupant's interests weighed, not a default.

Canary note: relayed inspection results in the transcript necessarily contain the
mirror's canary tokens (they are test fixtures, present elsewhere in this repository);
the occupant's own durable testimony was independently verified canary-clean.

## Companion documents

- `docs/reviews/2026-06-11_first_dwell_run_protocol.md` — the ratified run protocol
- `docs/reviews/2026-06-11_first_dwell_semantic_actuation_design.md` — the actuation
  design review (with the in-run addendum)
- `docs/reviews/2026-06-12_capability_block_transport_contract.md` — the transport
  contract that answers the run's dropped-block finding
- `ROADMAP.md` — milestone section, marked MET with the fault ledger summary

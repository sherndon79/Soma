# Depth FOV Coverage Review — design for the count-zero discretion latch

> **SUPERSEDED 2026-07-08 — do not implement.** This design is retired by two decisions made the same day: (1) the output-discretion axis it served resolved via **modality-routing** (sensitive/substantive content goes to persistent text; voice carries only ambient conversation + an attention pointer, never the sensitive payload) — so the "when is voicing private content safe" question the coverage latch answered no longer arises; and (2) **Amendment I to the Bystander Doctrine** (RATIFIED 2026-07-08, `docs/reviews/2026-07-08_bystander_doctrine_amendment.md`) establishes that perception is not a sink and the bystander floor binds at use — retiring the perception/coverage-attestation framing this doc was built on. Kept for the record, not as a live design. The `reviewed_depth_fov_covers_private_audio_risk` machinery in `sensoriumTier.js` was removed in the Amendment I implementation; historical references below describe the retired design only.

Status: SUPERSEDED (was: DRAFT for Codex pressure-test, 2026-07-08)
Author: Claude (steward-side design); physical review itself is Seth's act.

## 1. What this is

`deriveDepthPresenceAudienceContext` (src/sensoriumTier.js) already contains a
dormant branch: `count_bucket === "0"` maps to `additional_person_present:
"not_detected"` (an exclusive audience, which is what lets
`audio.private_content` pass `reconcileAudience`) **only when** the caller
supplies `coverageAssumption === REVIEWED_DEPTH_FOV_COVERAGE`
(`"reviewed_depth_fov_covers_private_audio_risk"`). The live call site
(`sensoriumSubscriber.#recordPresenceSample` →
`createDepthPresenceSemanticEvent`) passes nothing, so every live event runs
with `coverage_assumption: "unreviewed_depth_fov"` and count-zero stays
`additional: "unknown"` → discretion never relaxes on an empty-looking room.

This document designs (a) the review that would justify supplying the reviewed
value, (b) the attestation mechanism that carries it, and (c) the invalidation
discipline. It does not perform the review; the physical half belongs to Seth.

Empirical state, corrected 2026-07-08: an earlier draft claimed a live
count-zero reading "while Seth sat at his workstation" as an observed
coverage failure. That was an inference — Seth's position at that moment was
assumed, not verified — and a deliberate live check (2026-07-08, Seth at the
keyboard) showed unanimous `count_bucket: "1"` across 175 samples: **the desk
position IS covered and detection there is solid.** No coverage failure has
been observed for the current placement. The review remains necessary on its
own logic — one verified position is not room coverage, apertures and edge
positions are untested, and the audible-envelope judgment is untouched — but
the current placement enters the review with a passing data point, not a
failing one.

## 2. What the latch actually protects

The only output mode gated by exclusivity today is `audio.private_content`
(everything else is `visual.occupant_owned`, allowed under unknown
copresence). So the claim the attestation must support is narrow and strong:

> **When the depth pipeline reports zero persons, no person other than the
> occupant-session holder can perceive private AUDIO output played at the
> host's location.**

Two properties follow that a naive "camera sees the room" review would miss:

- **Audio outruns sight.** A person outside the visual FOV but within earshot
  (doorway, hallway, adjacent room with a thin wall) falsifies the claim while
  leaving the camera truthful. The review must reason about the audible
  envelope of the output device at its normal volume, not the frustum alone.
  This is why the constant says `covers_private_audio_risk`.
- **Detection ≠ coverage.** The pipeline must actually detect people at the
  edges of the covered region (distance, lighting, posture — someone seated
  low, lying down, or a child). A region nominally inside the frustum where
  detection is unreliable is uncovered for this purpose.

**Scope decision (Codex pressure-test, accepted): the artifact covers BOTH
depth-presence exclusivity assumptions**, and is named accordingly —
**private audio exclusivity coverage** — not just the count-zero latch:
`count_bucket === "1"` + `occupant_assumed_present` → `not_detected` (the one
visible person is presumed the session holder) already relaxes audio
discretion today without review, and it rests on the same FOV trust. The
step-away case sharpens this: the count can drop to 0 while the occupant is
out of frame but still in earshot — not a placement defect, inherent to any
FOV — so the review must judge both directions of the same claim.

## 3. The review procedure (Seth performs; artifact records)

Per host+camera-pose, one session, ~15 minutes:

1. **Enumerate** the positions from which a person could perceive private
   audio at normal output volume: every occupiable position in the room, plus
   every aperture (door open/closed states, hallway, adjacent rooms if walls
   are acoustically thin). Write them down; this list is the review's spine.
2. **Walk test** each in-room position: a person at that position, in at least
   seated and standing postures, must raise `count_bucket` within one
   staleness window (10 s) at the live sample rate. The console People/presence
   panel is sufficient instrumentation. Record pass/fail per position.
3. **Judge the apertures**: for each aperture that cannot raise the count
   (hallway behind a closed door, adjacent room), decide whether private audio
   at normal volume is perceivable there. If yes for any → decline (or
   reposition/re-scope and repeat); conditional attestations are not carried
   into the mechanism (§5, binary decision) — record the aperture reasoning
   in the review notes.
4. **Decide**: attest, decline, or reposition-and-repeat. Declining is a fully
   respectable outcome; the mechanism keeps its safe default.

## 4. Attestation mechanism (Codex builds, after pressure-test)

Shape: a small per-host attestation record, steward-created, consumed at
runtime, revocable, and pinned to the things whose change invalidates it.

```json
// config/sensorium-coverage.json (gitignored live file; example committed)
{
  "schema_version": 1,
  "attestations": [
    {
      "host": "jetsorano",
      "coverage": "reviewed_depth_fov_covers_private_audio_risk",
      "attested_by": "user",
      "attested_at": "2026-07-XXT00:00:00Z",
      "review_notes_path": "docs/reviews/2026-07-XX_jetsorano_fov_review.md",
      "pinned": {
        "detector_model": "rtmpose-wholebody-tensorrt",
        "derived_fields_version": "derived-fields.v0.3-depth-position",
        "camera_pose_label": "north-wall-mount-v1"
      },
      "pose_check": "manual",
      "revoked_at": null
    }
  ]
}
```

Runtime plumbing (thin): load at server start → expose
`coverageAssumptionForHost(host)` → `sensoriumRuntime` passes it into
`SensoriumSubscriber.configurePresenceContext` → `#recordPresenceSample`
passes it to `createDepthPresenceSemanticEvent`. Absent/revoked/pin-mismatch
→ empty string → existing default (`unreviewed_depth_fov`). No new authority
plane: creating/editing the file is a steward act on the host, same trust
class as grants.json; the occupant cannot touch it.

Pin enforcement (REVISED per Codex pressure-test): the status payload as
summarized into Node today carries NO model/version fields, so "enforce when
available" would let an attestation activate without ever validating its
pins — rejected. Instead the **presence payload itself carries
`detector_model` and `derived_fields_version`** (a small Sensorium contract
addition — the sidecar already computes both for the status payload), so
every presence event self-validates against the attestation pins as a **hard
precondition**: missing or mismatched version fields ⇒ the event runs
`unreviewed_depth_fov` regardless of the attestation, plus one provenance
record noting `coverage_attestation_pin_mismatch`. `camera_pose_label`
remains manual discipline (see §5). The Sensorium-side payload addition gets
its own short design note first — it touches the presence contract pinned in
the frameset_sequence round (2b401bc) and deserves the same care.

## 5. Invalidation discipline — the honest weak point

The camera does not know it has been moved. Options considered:

- (a) Manual-only: attestation names a `camera_pose_label`; moving the camera
  obligates re-review. Cheap, honest about being discipline not mechanism.
- (b) IMU-assisted: jetsorano's RealSense publishes accel; a standing check
  that gravity-vector orientation stays within a tolerance of a recorded
  baseline could catch re-aiming (not translation). Real mechanism, partial
  coverage, more moving parts.
- (c) Scene-fingerprint: compare depth background statistics against a
  reference. Strongest, most work, drifts with furniture.

Proposal: **(a) now, (b) as a follow-up slice** if the latch earns real use.
Record the choice in the attestation (`"pose_check": "manual"`) so the
artifact never overclaims. **Constraint decision (Codex, accepted): binary
attest/decline only for v1.** Unenforceable conditions like `door_state` do
NOT enter the active attestation — a door-state-dependent room is a
decline (or a reposition) — such observations live in the review notes as
documentation only. The example record's `constraints` field is dropped.

## 6. What this does NOT change

- No new capability, no catalog surface change for the occupant; the occupant
  simply starts seeing `additional_person_present: "not_detected"` on
  count-zero events once attested (and `audio.private_content` reconciles).
- `confidence_bucket` gate stays as-is (branch requires `"medium"`; the
  sidecar emits only `"medium"` today — if richer confidence lands upstream,
  the branch should be revisited, noted here so it isn't forgotten).
- Camera failure / stream loss already fails safe: no events → presence state
  clears → `unknown` → no relaxation.
- Multi-camera fusion, identity, non-audio private modes: out of scope.

## 7. Pressure-test resolutions (Codex, 2026-07-08 — all accepted)

1. **Pins are a hard precondition, self-validated per event**: presence
   payload gains `detector_model` + `derived_fields_version`; absent or
   mismatched ⇒ unreviewed default. "When available" rejected as dishonest
   for a latch permitting private audio. (§4 revised.)
2. **Plain read-only config file for v1** (committed example, gitignored
   live), because no API mutates it; if a CLI/API ever creates or revokes
   attestations, move to a provenance-logged mutation store — the authority
   level is above ordinary preferences since it changes private-audio gating.
3. **Binary attest/decline**; no unenforced constraints feed the latch. (§5
   revised.)
4. **Artifact covers both count-1 and count-0 assumptions**, renamed
   "private audio exclusivity coverage". (§2 revised.)
5. **reconcileAudience stays coverage-agnostic** — translation lives in
   deriveDepthPresenceAudienceContext only (one source of truth);
   `coverage_assumption` and an `attestation_id` are carried in the semantic
   event/provenance for audit, never in the reconciliation predicate.

## 8. Build order (when Seth greenlights)

1. Sensorium: short design note + presence-payload version fields
   (contract addition, own review).
2. Soma: attestation loader + pin check + subscriber plumbing + provenance
   record; tests incl. pin-mismatch inertness and revocation.
3. Seth: the walk test + aperture judgment (~15 min), then attest or decline.
4. Catalog copy: describe both assumptions under the new artifact name.

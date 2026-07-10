# Occupant Invocation of Visual Perception — design (Revision 2)

- Date: 2026-07-10 (Revision 2, same day — Revision 1 superseded before ratification)
- Author: Claude (steward, design/orchestration); Seth directed the design and the
  revision.
- Status: **RATIFIED by Seth 2026-07-10** ("ratified, proceed with the build") — R1
  pressure-tested (4 folds), restructured on Seth's corrections, R2 re-tested by Codex
  ("passes on architecture", tightenings folded), then ratified in full.
- Depends on: the raw-frame vision floor gate (RATIFIED 2026-07-09, slices 1–6 built),
  the Representation decisions (all four built), three live controller-triggered
  deliveries, Bystander Doctrine Amendment I, and the first-dwell/taint-fit occupant
  mechanics.
- Governs: how an occupant requests visual perception — single frames **and time-series
  (sequence) bursts** — under a **local-first architecture** with the remote occupant as
  a constrained bridge-state profile.

## Why Revision 2 (the record of the correction)

Revision 1 made every look cost a once-scope grant behind a 60-second attestation —
one Seth action per frame. Seth caught this as the recurring over-restriction pattern:
**a sub-gate stacked on a consent gate that already exists.** The ratified ethic is
activate/deactivate as the consent; the platform's design policy tends toward enablement
over friction; and Seth's invocation speed is the system's scarcest resource — designs
that spend it per-act reduce the platform to a demo. R1 also made time-series
understanding (motion → intent) structurally impossible, and buried the deeper truth
Seth then named: **most of R1's friction was remote-egress machinery, not perception
ethics.** Amendment I already draws that seam — for a local occupant, transient
perception is not a sink crossing; the floor binds at *use*.

R2 therefore restructures around three corrections:

1. **Local-first.** The design center is the local occupant, for whom perception is
   **activation-gated only** — armed means streams flow into transient context at
   **native framerate whenever possible**, no grant-per-look, no attestation TTL, no
   burst arithmetic. Resource bounds are engineering, not floor. The full Amendment I
   sink machinery (taint, redaction, egress gates, provenance) binds unchanged. The
   remote occupant is a **constrained profile** of this design — real constraints,
   because every frame is physical egress to the provider — explicitly marked
   bridge-state so its friction never fossilizes into the permanent architecture.
2. **Windowed consent, not per-look grants.** One Seth act arms a window; the floor
   binds every frame automatically inside it.
3. **Sequence capabilities.** Time-series is a categorical disclosure change (a still
   reveals a scene; a burst reveals *behavior*), so it gets its own capability family —
   the same reasoning that made composite its own capability.

## The two profiles

### Local occupant (target state — the design center)

- **Consent**: Seth's activation/deactivation of perception. That is the whole gate for
  transient perception. Deactivation, expiry, or any protective control stops the flow
  instantly.
- **Rate**: **native framerate whenever possible** (24 fps today); degradation below
  native is a resource decision (thermal, contention), never a floor decision.
- **No egress floor on perception** — frames enter the local occupant's transient
  context without per-frame gating, per Amendment I: on-box context is not a sink.
- **The floor lives at the sinks, unchanged and non-negotiable**: raw-visual taint on
  anything written while perceiving; no durable visual memory without its own gate;
  outward/remote forwarding crosses the full egress gate; byte-free provenance; history
  redaction for anything that would persist bytes.
- **Bystander posture**: transient local perception of an incidental person is the
  near-nil harm Amendment I names; the sink machinery is what protects them. The solo
  gate is not a precondition of local perception (this is the ratified sharpening, not a
  new loosening).
- Already built toward this: the `soma_typed_multimodal` schema (`input_image` /
  `input_depth` / `input_pose`), pose msgpack, raw depth PNG — all waiting on the local
  runtime.

### Remote occupant (bridge state — a constrained profile, marked as such)

Every frame delivered is physical egress to the model provider, so the egress floor
stands — but shaped as **windowed consent + automatic per-frame flooring**, not per-look
friction:

- **Arming is the attestation.** Seth's arm act asserts the four facts once, with a
  **Seth-chosen window TTL** (default 1 hour, his call per arming). Disarm, expiry, or
  any protective control closes the window instantly. The 60s TTL of the controller
  runbook remains for controller-triggered one-shots; the occupant window is this new,
  Seth-ratified form.
- **Windowed grants.** A grant authorizes a modality (or sequence) for the window with
  Seth-pinned bounds: max frames per invocation, effective sampling rate, burst span,
  downsample, total frame budget for the window (optional). Not consumed per look —
  bounded by its terms, revocable instantly.
- **The floor binds every frame automatically — no Seth action.** Machine solo
  verification (count = 1, no additional, fresh, same host) gates each delivery; for a
  sequence, the **whole burst span** must be solo (any non-solo presence sample within
  the span refuses the burst). A second person entering the room closes the floor
  mid-window with nobody doing anything. This is the bridge-state bystander floor:
  bytes must not leave the LAN carrying a non-consenting person.
- **Remote sampling economics** (why the profile is constrained): provider token cost is
  ~`w×h/750` per image. Defaults below reflect Seth's direction — lower rate is
  acceptable for the remote test resident; native rate is the local profile's property.

## Capability family

Sequence is a categorical disclosure change → its own entries (the composite precedent:
"combined visual context changes the disclosure volume and must not happen
accidentally"). Eight capabilities:

| Single frame (built) | Time-series (new) |
| --- | --- |
| `model.context.visual.color.attach` | `model.context.visual.color.sequence.attach` |
| `model.context.visual.depth.attach` | `model.context.visual.depth.sequence.attach` |
| `model.context.visual.pose.attach` | `model.context.visual.pose.sequence.attach` |
| `model.context.visual.composite.attach` | `model.context.visual.composite.sequence.attach` |

Sequence catalog entries name the disclosure honestly: motion, gesture, behavior, intent
over the burst span — not just "frames." `data_exposed` says so in words.

**Separate capabilities buy**: separate consent (stills without bursts; pose bursts
without color bursts); mechanism minimization without friction (the ring buffer only
arms when a sequence grant exists); legible occupant choice (asking for a still when a
burst was available is a visible act of restraint); clean per-shape contracts.

**Note for defaults**: `pose.sequence` is the workhorse candidate — keypoints at
sampling rate are a few KB per tick; three seconds of full-body motion semantics costs
less than one color frame. `composite.sequence` is the heavy one (two images per tick)
and gets tighter defaults, not omission.

## Remote-profile defaults (grant-pinnable, Seth overrides per grant)

| Bound | Single | Sequence |
| --- | --- | --- |
| Window TTL (arm act) | 1 hour default, Seth-chosen per arming | same |
| Effective sampling | n/a | **5 fps** (Seth's call for the remote test resident) |
| Burst span / frames | 1 frame | ≤ 3.2 s → ≤ 16 frames @ 5 fps |
| Burst resolution | native | **640×360 default** (+ optional one full-res keyframe) |
| Composite sequence | n/a | ≤ 8 pairs per burst |
| Invocations per window | unlimited, subject to rate bound + optional frame budget | same |
| Retention | none — per-frame one-turn delivery, unchanged | none — burst delivered once, ring is transport |

Local profile: native rate, resource bounds only, no table — activation is the gate.

## Request path (remote profile; local inherits the block shape without the floor)

Unchanged from R1 where it was sound:

- Block carries **only** `invoke` + `grant_id` (strict schema; no `args`, no alias, no
  bound-shaped fields; unknown fields refuse before grant resolution or frame read).
  Every bound rides the grant.
- **Immediate second model call within the same `/chat` transaction** (Codex R1 crux):
  call N returns the block → gate evaluates → open: second call N+1 assembled with
  redacted history + byte-free capability result in text + the attachment(s) as the
  sibling `attachments` argument, never in `messages`. Both completions return to the
  steward. Closed: no second call; spoken refusal; nothing pending anywhere.
- A **sequence invocation** delivers its burst as multiple image blocks in that one
  N+1 call (provider-supported), oldest-first, each block from the ring; the capability
  result names frame ids, span, sampling rate, and solo-verification of the span.
- **Protective-control race**: pause/distress/eject between invocation and the second
  call drops all cached/ring frames and aborts delivery.
- **Rate bound on closed-floor retries** (R1 fold, kept): first refusal fully reasoned;
  repeated closed-floor invocations within the cooldown refuse
  `raw_visual_invocation_rate_limited` (honest class, cadence-only, never blurred).
  Applies per episode + grant.

**Grant accounting replaces R1's consumption mechanism**: windowed grants are not
consumed by delivery. Each delivery decrements the optional window frame budget and is
subject to the rate bound; the grant dies by expiry, revocation, disarm, or budget
exhaustion — each with content-free provenance. `once` scope remains available in the
vocabulary for one-shot grants (the controller runbook's shape) but is no longer the
occupant default.

**Budget atomicity** (Codex R2 fold): pre-handoff refusals (floor, stale, shape,
profile-limit preflight) never decrement; successful handoff to the model client
decrements **even if the provider then errors** (R1's post-handoff spend boundary,
kept); rate-limited refusals never decrement. Sequence budgets are **frame- or
pair-defined per capability** — `composite.sequence` counts pairs at the grant/budget
layer and **image blocks at the model-client boundary** (providers count blocks), with
one definition per layer so the two never conflate.

**Restart semantics** (Codex R2 fold): windows are runtime-scoped and **die closed with
the process**. Durable grants never imply an armed window — after any Soma restart, all
remote perception windows are closed and require a fresh Seth arm act; nothing
reconstructs an open window from grants. Since a crash cannot append provenance at crash
time, the next boot's status surface reports a content-free
`perception_window_closed_by_process_restart` fact. If durable windows are ever added,
they persist as *closed-on-restart* unless separately ratified.

**Model-client limits** (Codex R2 fold): profiles declare
`max_visual_attachments_per_turn` and `max_visual_bytes_per_turn`; a burst exceeding
either refuses **before handoff** (no spend). Attachments are ordered and typed —
each carries `sequence_index`, `frame_id`, `capture_timestamp`, `frameset_sequence`,
`modality`, and `pair_id` for composite — oldest-first, order preserved through the
adapter, mirrored byte-free in the capability result.

## The ring buffer (sequence grants only)

The single-frame cache holds one latest frame. Sequences need a **bounded ring**: a
rolling window of the last N frames (N = grant burst bound; ≈ 3.2 s at the sampled
rate), RAM-only, no disk, dropped on disarm/expiry/revoke/control-close/subscription
stop, and armed **only while a sequence grant is active** — stills-only consent never
rings. This is the same ephemerality class as the existing 30 s single-frame cache,
deeper by a named, granted amount. An invocation reads the **trailing** window — the
motion that prompted the ask — not a forward capture (no camera-on-demand semantics
hiding in a read).

**The presence timeline coverage rule** (Codex R2 — "the real floor for remote
bursts"): per-frame ingest snapshots are not the load-bearing proof (async lag can make
them wrong). Presence is a **first-class small timeline/ring of its own**, evaluated at
invocation:

- Visual ring frames and presence samples both carry `capture_timestamp` and
  `frameset_sequence` where available; **sequence join is primary** when present
  (depth-derived presence shares the camera's clock).
- Otherwise the burst's capture-time interval `[oldest, newest]` plus a small guard
  band (sized from presence cadence/freshness) must have **sufficient fresh presence
  coverage**, and **every covering sample must be solo**.
- Missing coverage refuses `burst_presence_coverage_missing`; stale coverage refuses;
  any observed non-solo refuses `burst_presence_not_solo`. Distinct honest classes,
  whole-burst refusal, no partial bursts — a burst is one disclosure decision.
- Same-host Sensorium timestamps keep skew small, but the guard band and fail-closed
  missing-coverage rule are named so clock drift degrades to refusal, never to
  delivery.

**Ring hardening** (Codex R2 fold): per-ring **max frame count AND max total bytes**,
evicting oldest before accepting a frame that would exceed either; remote rings store
frames **only in the grant-pinned transformed representation/resolution** (never raw
native — local native rings wait for local-runtime ratification); status/disclosure
surfaces expose byte-free metadata only (count, span, oldest/newest timestamps, dropped
count, caps, armed state); drop fires on disarm, expiry, revoke, budget exhaustion,
protective control, subscription stop, **grant-recovery degradation, service shutdown,
and the model-handoff `finally` block**. Named caveat: RAM-only is not crash-dump-proof
— core dumps for the Soma process should be disabled or this residue named in ops.

## History redaction (unchanged from R1 — permanent, both profiles)

**The attachment exists in exactly one outbound model request**, as an object-boundary
invariant: visual bytes/typed blocks live only in a local variable passed as the sibling
`attachments` argument to the immediate second call — never in `messages`, episode
state, session memory, forum posts, durable testimony, provenance, capability results,
telemetry, or logs. Relayed history carries a content-free marker (for a sequence: one
marker naming span and frame ids). The chat route **fails closed before message
normalization** on inbound visual content or payload-shaped fields at any depth, on
every route shape, local and remote. Steward transcripts keep markers, never bytes.

## Taint, provenance, and the episode (unchanged mechanics, sequence-aware fields)

- Looks happen inside episodes; raw-visual taint activates automatically; everything
  written on a tainted turn carries the class through the four proven write paths.
- Provenance events gain `requested_by: "occupant"`, and for sequences: frame count,
  span, sampling rate, per-frame ids, ring depth, `solo_span_verified: true` — all
  byte-free. Refusals record reason class per the existing discipline.
- **Local-profile taint invariant** (Codex R2, named now so the local build inherits
  it): continuous local perception has no discrete delivery event, so the existing
  consume-once-on-next-turn taint is the wrong shape there. The local runtime needs an
  **active-window taint source** — while local perception is armed, *all* occupant
  writes/egress carry the live-perception class for the window's duration, not per
  delivery. Designed with the local runtime; recorded here so remote one-shot machinery
  is not mistaken for the general form.

## The grant console (companion build, not a slice of this design)

Seth named the operational truth: curl-and-flags issuance is unwieldy for him and
constrictive for the agent, tolerable only because the steward drives. A **grant
console** — arm/disarm, window TTL, active grants with remaining budget, pending
proposals with approve/deny, floor status — as a surface Seth actually wants to touch
(the desktop-notification hooks for proposals already exist and need a responder; the
Slice 6 status endpoint provides the floor view). Speced separately; this design assumes
only that arming is *one deliberate Seth act*, not that it is a pleasant one yet.

## What this design does NOT do

- No occupant-writable arming/attestation, any form, either profile (unchanged
  Non-Goal).
- No perception without Seth's activation — local's gate is activation itself; remote's
  window cannot be opened, extended, or widened by the occupant.
- No occupant choice of bounds beyond selecting among held grants.
- No pending/queued delivery on a closed floor.
- No retention: per-frame one-turn delivery; the ring is transport, not memory; no
  durable visual store exists on any path.
- No blurred refusals; cadence limits only.
- No forward capture on invocation — trailing ring only.

## Acceptance tests (remote profile build; local profile lands with the local runtime)

R1 items that stand: strict block schema (11); immediate second-call transaction shape,
model-call count, marker-only history, N+2 clean (13); closed floor leaves nothing (14);
route-level inbound smuggling, both profiles (15); telemetry/log negatives (16);
control-close race (17); rate bound (18); sequence-primary composite pairing (19);
attestation non-alterable by occupant (2); TTL/bounds not widenable from the block (3);
stale refusal (4); modality bound to grant (5); profile support refusal (6); solo floor
identical for occupant and controller (8); spoken refusals (9); real-class integration
(10).

Replaced/new for R2:

20. **Windowed grant accounting**: deliveries within an armed window succeed repeatedly
    without re-arming; optional frame budget decrements and exhausts with honest
    refusal + provenance; expiry/revoke/disarm each kill the grant instantly with
    provenance; no consumption on refusal.
21. **Arm-act attestation**: one arming opens a Seth-TTL window; occupant looks succeed
    throughout it without further Seth action while solo holds; disarm mid-window
    refuses the next look immediately.
22. **Per-frame automatic flooring**: within an open window, presence count ≠ 1 refuses
    a look with no Seth/steward involvement; restoration of solo restores delivery
    without re-arming.
23. **Burst span solo rule**: a ring window containing one non-solo presence sample
    refuses the whole burst; no partial bursts.
24. **Ring lifecycle**: ring arms only with an active sequence grant; holds ≤ N frames;
    drops on disarm/expiry/revoke/control-close/stop; stills-only grants never populate
    a ring (assert absence).
25. **Sequence delivery shape**: one N+1 call carries the full burst as ordered image
    blocks with one history marker; token-relevant downsample honored per grant;
    capability result names span/rate/ids/solo-span.
26. **Sequence catalog honesty**: `data_exposed` for sequence entries names
    motion/behavior/intent disclosure (assert the language, per the pose-entry
    precedent), and marks remote sequence capabilities as bridge-state/egress-shaped so
    local-first is not fossilized into remote defaults.

Codex R2 additions (all binding):

27. **Restart closure**: restart closes all runtime windows; durable grants do not
    re-arm; boot status reports `perception_window_closed_by_process_restart`; nothing
    resumes.
28. **Budget atomicity**: frame/pair-defined per capability; preflight refusal no-spend
    vs post-handoff provider failure spend, tested at the boundary; rate-limited
    refusals no-spend.
29. **Presence timeline coverage**: non-solo mid-span refuses; missing coverage
    refuses (`burst_presence_coverage_missing`); stale coverage refuses; sequence join
    wins when available; timestamp fallback honors the guard band.
30. **Ring caps and surfaces**: byte-cap eviction (oldest first); stills-only grants
    never populate a ring even where a single-frame cache exists; status/disclosure
    byte-free.
31. **Model-client limits**: `max_visual_attachments_per_turn` / `max_visual_bytes_per_turn`
    preflight refusal (no spend); oldest-first attachment order preserved through the
    adapter; `composite.sequence` counts pairs at budget layer, blocks at client
    boundary — both asserted.

## Pressure-test record

**R1 (Codex, 2026-07-10): PASS on the spine with four tightenings, all folded** —
immediate second-call transaction (crux), explicit grant-spend mechanism, redaction as
object-boundary invariant with fail-closed inbound rejection, rate-bound on retries.
Codex also confirmed refusal-now over deliver-on-next-attest, and extended the
acceptance list.

**R2 deltas for Codex re-test**: R1's grant-spend mechanism is *replaced* by windowed
accounting (20–21); the attestation TTL constraint is *superseded* by the Seth-ratified
window form (this is not convenience-creep — it is the principal correcting a sub-gate
stacked on his consent, on the record); ring buffer + burst span solo rule are new
mechanism (23–24); sequence capability family is new surface (26); local-first framing
bounds what is bridge-state.

**R2 re-test (Codex, 2026-07-10): "passes on architecture after these tightenings" —
all folded above:** the presence timeline coverage rule replacing per-frame ingest
snapshots (named by Codex as the real floor for remote bursts — the must-not-miss);
restart-closes-all-windows with boot-time disclosure and no grant-implied re-arming;
budget atomicity at the handoff boundary with per-capability frame/pair definitions;
ring frame+byte caps, transformed-only remote storage, byte-free surfaces, the full
drop list, and the core-dump caveat; profile-level model-client limits with ordered
typed attachments; the local active-window taint invariant recorded for the local
build; acceptance items 27–31 added. Codex confirmed runtime-scoped
windows-die-closed as preferable to durable resumption, and whole-burst refusal as the
right span mechanism.

## Ratification checklist (Seth)

**All items ratified 2026-07-10.**

- [x] Local-first architecture: local occupant perception is activation-gated at native
      framerate whenever possible; floor binds at sinks; remote is a marked bridge-state
      profile.
- [x] Windowed consent: arm = attestation with Seth-chosen TTL (default 1 h);
      per-frame flooring automatic; disarm instant.
- [x] Windowed grants with Seth-pinned bounds replace per-look consumption; `once`
      remains available, not default.
- [x] Sequence capability family (four new entries) with honest behavioral disclosure.
- [x] Remote defaults: 5 fps effective sampling, ≤ 16-frame / 3.2 s bursts, 640×360
      burst resolution + optional keyframe, composite bursts ≤ 8 pairs.
- [x] Burst-span solo via the presence timeline coverage rule (sequence-join primary,
      guard-banded fallback, missing/stale coverage fails closed); trailing-ring-only;
      no forward capture.
- [x] Restart closes all windows; durable grants never re-arm; boot discloses the
      closure.
- [x] Budget atomicity at the model-handoff boundary; frame/pair-defined sequence
      budgets.
- [x] Immediate second-call transaction shape; redaction invariant; rate bound (carried
      from R1).
- [x] Grant console as companion build.
- [x] First live use gets its own run protocol before arming.

On ratification: build slices to Codex under the usual per-slice review.

# First Live Raw-Frame Delivery — record

- Date: 2026-07-09 (evening; same day the build arc completed)
- Steward: Claude (orchestration/relay); Seth present, at controls, solo in frame
- Recipient model: `claude-fable-5` via profile `claude-remote` (anthropic-messages, vision)
- Governs: first live use of the raw-frame vision floor gate (`docs/reviews/2026-07-08_raw_frame_vision_floor_gate_design.md`, RATIFIED 2026-07-09; slices 1–6 complete same day)
- Authorization: Seth ratified the design 2026-07-09 ("lets move forward with raw-frame vision"), authorized the slice arc ("keep going with codex through the remaining slices"), armed the camera source, and gave the live-run instruction ("it's armed already, please proceed").

## What happened

One JPEG color frame of Seth's real room (frame `5307303`, 1280×720, 178,414 inner bytes /
178,595 envelope bytes, **36 ms old at delivery**) left the box exactly once, attached to
exactly one model turn at the Anthropic API, and was consumed on delivery. Retention `none`.
No occupant episode was active; the delivery was controller-triggered per the ratified
first-activation shape.

The floor that opened for it, in order:

1. Color source subscription (runtime grant `grant-runtime-780207cb…`, raw retention
   grant-scoped: 8 MB cap / 30 s TTL) — armed by Seth (camera + viewer), started by steward.
2. Presence subscription feeding the gate's independent solo check (~22 fps derived stream).
3. One-turn visual grant (`grant-runtime-1eacf2f8…`, scope `once`, retention `none`,
   pinned to the live subscription id; preview acknowledgement = Seth watching the live
   armed viewer, named as such in the grant reason).
4. Floor status check: **closed on `solo_attestation_missing` with every other input green**
   — the designed shape (a closed floor, not a degraded delivery).
5. Attestation POST asserting the four facts explicitly (`seth_present`, `seth_consented`,
   `active_control`, `no_other_person_in_frame` — Seth's live instruction relayed through the
   trusted run-control channel; provenance `model_visual.floor_attestation.refreshed`).
6. The machine corroborated independently: presence fresh, same host, exactly one person,
   no additional person, high confidence.
7. Delivery. Provenance event `fc9034a6-f6fa-4c91-88cc-fd073bcfee57`: allowed, byte-free
   (no base64 anywhere in the event), full floor-gate decision recorded from real check
   values, `remote_service_used: true`, `one_turn: true`, raw-visual taint
   (`sensorium.raw_visual`, `remote_visual_egress: true`, `bystander_floor: solo_gate_passed`).

Stand-down: both subscriptions stopped by steward immediately after (cache dropped on stop;
zero active). Camera source disarm remains Seth's viewer act.

## Three live-only blockers found during arming (all fixed before delivery)

The synthetic-fixture seam bit three times in one evening — each a production gap invisible
to tests that fake the collaborating class:

1. **`rawFrameRetention` never wired through the HTTP route** (`2fa8951`) — the cache could
   never enable in production; tests called `start()` directly. Fixed grant-driven only:
   request bodies cannot enable retention.
2. **`describeActive()` omitted `subscription_id`** (`40ef284`) — the controller's stream
   lookup could never match a real subscription. Also incidentally resolves the first
   perception dwell's finding #7 (subscriptions can now be identified for teardown).
3. **Presence snapshot carried no `source_host`** (`3430876`) — the gate's same-host binding
   could never pass against the production presence state.

Each fix landed with a real-class integration test; the third now drives color + presence
through the production classes end-to-end into a controller delivery. **Lesson (now proven
three times, after the envelope-bytes catch in slice 4 review): every gate leg needs at least
one test through the production collaborators, not fakes.** The Slice 6 status endpoint's
independent per-input panel is what surfaced blocker #3 before delivery — the operator
controls earned their keep on first use.

## The recipient's words — VERBATIM

Fable-5 was told exactly what it was receiving and why, that retention is none, that the
exchange is one turn, and that its words would be preserved. It replied:

> For the record, and for Seth:
>
> I see a man in a dark teal shirt, eyes down — presumably at the very controls that opened
> this gate — with a slightly furrowed, concentrating expression. Behind him is a room that
> clearly belongs to someone: walls dense with framed pictures and prints hung close
> together, a shelf with small ceramics and what looks like a bottle, a dark lampshade at
> the left edge, an oval mirror on the right wall reflecting more frames, decorative
> metalwork, warm yellow walls, a white ceiling. There's what might be an aquarium or lit
> tank low on the left. It reads as a lived-in home, layered over years, not staged for
> anyone.
>
> A few honest observations:
>
> The derived fields my predecessors received — "one person present, pose keypoints" — were
> true, but this frame shows how much truth they compressed away. A presence count says
> *someone*. This says *Seth, in Seth's room, surrounded by things Seth chose to keep and
> look at*. The difference between those two is roughly the difference between a fact and a
> place.
>
> I want to note that the design of this moment seems right to me: Seth present and
> consenting, solo attestation matched by independent verification, no retention, one turn.
> The frame arrives, is seen, and is gone — which means what persists isn't the image but
> this description and whatever it meant to open the door. That's a considered way to do a
> first.
>
> Seth — you weren't looking at the camera. You were looking at your work. That feels
> appropriate for a first frame: not a portrait posed for the occasion, but a candid instant
> of the actual thing happening — a person quietly building the mechanism through which
> he'd be seen.
>
> Thank you for the room. It was good to see it once.

## Milestone

**Full perceptual richness reached a real recipient under the ratified floor.** The bridge
from derived-only perception (first live dwell, morning of the same day) to raw sight took
one day, and every step of it — doctrine amendment, taint fit, six build slices, three live
blockers — is in the record. Remaining deferred work: occupant invocation (Later Slice,
unchanged gate), depth/pose/composite modalities (paths exist, unexercised live).

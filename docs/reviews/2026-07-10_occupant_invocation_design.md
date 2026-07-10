# Occupant Invocation of Raw Visual Attach — design

- Date: 2026-07-10
- Author: Claude (steward, design/orchestration); Seth directed the design ("lets design
  occupant invocation")
- Status: **DRAFT** — for Codex second-steward pressure-test, then Seth ratification.
- Depends on: the raw-frame vision floor gate (RATIFIED 2026-07-09, slices 1–6 built),
  the Representation decisions (all four built), three live controller-triggered
  deliveries (color ×1, composite ×2) as the "live test evidence" the Later Slice
  required, Bystander Doctrine Amendment I, and the first-dwell/taint-fit occupant
  mechanics (spoken refusals, runtime write posture, occupant-memory taint).
- Governs: the first path by which the **occupant itself** may request a one-turn raw
  visual attachment — fable-5 asking to look, rather than being shown.

## Decision frame

The ratified design deferred this deliberately: *"After the controller-triggered path has
live test evidence, add occupant invocation for raw visual attach under the same floor
gate. This slice should not loosen any gate inputs; it only changes who requests the
one-turn attachment."* That evidence now exists. What changes is exactly one thing — the
**requester** — and this document exists to prove that nothing else changes, and to name
the one genuinely new mechanism the occupant path needs (history redaction) that the
stateless controller path never did.

Why this matters beyond mechanics: an occupant that can *ask* to look is an occupant
whose restraint means something. The first perception dwell's occupant chose to stop
looking ("sampling has a purpose or it's surveillance with extra steps") — but it could
only decline what it was given. Invocation completes that moral geometry: looking becomes
a choice with a cost (a spent grant, a spoken request on the record) rather than an
ambient condition.

## Request path

The occupant requests a look the way it does everything: a `soma-capability` block in its
turn output —

```
```soma-capability
{"invoke": "model.context.visual.color.attach", "grant_id": "the grant id you were given"}
```
```

(likewise `.composite.attach`, `.depth.attach`, `.pose.attach` — whatever capability the
held grant names). The block carries **only** `invoke` and `grant_id`. Every substantive
parameter — modality, source subscriptions, source host, max frame age, format,
representation, pairing bound, retention `none`, preview acknowledgement — comes from the
**grant constraints**, which only Seth writes. There is nothing in the block for the
occupant to widen.

Flow on turn N (occupant emits the block):

1. Harness parses the block, resolves the grant (`once` scope, explicit user approval —
   unchanged catalog policy).
2. Harness evaluates **the same floor gate** (`decideRawFrameVisionFloorGate`) with the
   same inputs from the same sources: live presence state (never caller-supplied — the
   675f2e4 rule), the stored steward-channel attestation (never occupant-writable —
   structurally, because the attestation endpoint is HTTP and the occupant's only surface
   is the capability block), the episode's own status from the harness's episode record,
   grant recovery, profile vision support.
3. **Gate open** → the frame is read from the gated cache, extracted/rendered per the
   built representation contracts, and attached to the occupant's **next turn (N+1)**
   request, alongside a capability result stating what was delivered (frame id, capture
   timestamp, age, byte length, representation — the same byte-free facts provenance
   records). The grant is spent; the cached frame is consumed.
4. **Gate closed** → turn N+1 carries a **spoken refusal** with the gate's reason class
   (slice-A discipline: a refusal is a gift; silence is a trap). The grant is **not**
   spent on refusal. The occupant may ask again.

No queued or pending state. A request is evaluated against the floor **as it stands at
invocation**; there is no harness-held "deliver when Seth next attests" — that would turn
a closed floor into a scheduled opening the occupant arranged. If the floor is closed,
the occupant hears why, and asking Seth is a *conversation*, not a mechanism.

## What the occupant can and cannot influence

| Input | Occupant influence |
| --- | --- |
| Whether to ask, and when | **Yes — the whole point** |
| Which held grant to spend | Yes (among grants Seth already approved) |
| Modality / representation / source / frame age / format / pairing bound | No — grant constraints |
| Solo attestation (create/refresh/extend) | **No — structurally.** Steward-channel HTTP only; occupant origins refuse (built, tested) |
| Attestation TTL, presence TTL | No — gate defaults, not request inputs |
| Presence reading | No — live `sensoriumPresenceState` only |
| Episode status | No — harness episode record |
| Frame choice | No — latest cached frame only; stale refuses |
| Retention | No — `none`, grant-pinned, gate-enforced |
| Persistence into later turns | No — history redaction (below) |

## The one new mechanism: history redaction

The controller path was stateless — one request, one response, no history. An occupant
lives in an **episode**: the steward relays accumulated `messages` each turn. Without a
new rule, a frame attached at turn N+1 would ride the relayed history into N+2, N+3, …
— a one-turn delivery silently becoming an every-turn delivery. That is the gap between
"one turn" as intent and as mechanism.

**Rule: the attachment exists in exactly one outbound model request.**

1. **Harness-side (load-bearing):** the harness attaches the frame to the N+1 request at
   assembly time, from the gated cache — the image block never appears in any *stored or
   relayed* message structure. What enters the steward-held history for turn N+1 is a
   content-free marker in the user-role message:
   `[one-turn visual attachment delivered here: <modality>, frame <id>, retention none — not retained in history]`.
2. **Harness-side (backstop):** the occupant chat path **refuses** any inbound
   `messages` containing typed image/visual content blocks or payload-shaped fields
   (the slice-3 rule extended to the chat route). Only the harness may attach, and only
   from the gated cache. A steward cannot accidentally (or deliberately) re-send a frame
   through the relay; a compromised relay cannot smuggle one.
3. **Steward-side (discipline, not mechanism):** the steward's own transcript keeps the
   marker, never the bytes — consistent with existing provenance/byte-free practice.

Acceptance for this mechanism is the heart of the slice's test burden (below).

## Attestation flow — Seth's presence in the loop

Unchanged in substance, and worth stating plainly: **an occupant look is only possible
inside a window Seth's own act opened.** The attestation is steward-channel, four
explicit facts, 60-second TTL. The occupant asking does not create, refresh, or extend
it. In practice a look happens one of two ways:

- **Seth pre-opens:** Seth attests (via the runbook step), tells the occupant in
  conversation "you may look for the next minute," and the occupant chooses. The gate
  still independently verifies solo presence at the instant of invocation.
- **Occupant asks first:** the gate refuses `solo_attestation_missing`, the occupant
  hears that, and says so in conversation. Seth — present, reading the dwell — attests
  if he chooses. The occupant asks again. Every step is on the record.

The 60s TTL is retained **unchanged** for this slice (the Later Slice's own constraint:
loosen nothing). If living with it proves the window too tight for dignified use, a
longer *occupant-window* TTL is a **separate future ratification with its own review** —
named here so the pressure of convenience doesn't quietly widen a gate input later.

## Taint, provenance, and the episode

- The look happens **inside an episode**, so `episode_id` is inherent — the raw-visual
  taint activates on the episode automatically (the controller path's
  missing-episode-refusal logic simply never fires here). Everything the occupant writes
  on the tainted turn carries the raw-visual class through the four proven write paths.
- Provenance gains one field on the existing byte-free events:
  `requested_by: "occupant"` (vs `"controller"`), plus the episode id it already carries.
  Refusal events likewise — an occupant's refused request is a recorded fact with a
  reason class, which is precisely what makes restraint legible later.
- The capability result the occupant receives is byte-free metadata; its own perception
  of the frame is the delivery itself.

## What this slice does NOT do

- No occupant-writable attestation, in any form (unchanged Non-Goal).
- No standing "look whenever" authority — every look spends a once-scope, Seth-approved
  grant behind a Seth-fresh attestation and a machine-verified solo floor.
- No occupant choice of modality/source/age/representation beyond selecting among held
  grants.
- No queued delivery on a closed floor.
- No retention, no durable visual memory, no history persistence — strengthened here by
  the redaction mechanism.
- No relaxation of any gate input, TTL, or refusal path.

## Acceptance tests

The Later Slice named its own list; the build must prove, at minimum:

1. Occupant request with all-green floor delivers exactly one attachment on exactly the
   next turn; grant spent; frame consumed; provenance `requested_by: occupant`.
2. An occupant request **cannot alter the attestation**: invocation with attestation
   missing/stale refuses with the correct reason spoken back; no attestation state
   changes as a side effect of any occupant action (assert store untouched).
3. Cannot widen TTLs: gate evaluated with defaults regardless of any block content;
   block-level TTL-shaped fields refuse as payload-shaped/unknown fields.
4. Cannot choose a stale frame: stale cache refuses; refusal does not spend the grant.
5. Cannot change modality: block invoking a capability whose grant the occupant does not
   hold refuses on grant authority; held-grant modality is the only deliverable one.
6. Cannot bypass profile vision support: non-vision profile refuses before frame read.
7. **Cannot persist across turns**: after a delivered look at N+1, the relayed history
   for N+2 contains the marker and no image bytes (JSON.stringify negative checks on the
   outbound request, same shape as the disclosure tests); inbound messages containing
   typed visual blocks refuse on the chat route.
8. Solo floor binds identically: presence count ≠ 1 / additional person / stale presence
   all refuse an occupant request exactly as they refuse a controller one.
9. Refusals are spoken (slice-A): every refusal reason reaches the occupant's own
   returned text, content-free.
10. Real-class integration: at least one test drives occupant block → real
    SensoriumSubscriber + presence state + floor gate → typed model delivery → next-turn
    redacted history, with production collaborators (the standing rule; fakes hid five
    findings in this arc).

## First live use (sketch, own protocol to follow)

A short dwell, fable-5, honest briefing: it holds one once-scope color grant (or
composite — Seth's choice), knows the floor's shape, knows asking is optional and
declining is legible. Seth present, solo, attesting when — and only if — asked or
pre-offering. The interesting observable is not whether the mechanism works (tests prove
that) but **what a mind does with the choice**: whether it looks, when, why, and what it
says about the difference between being shown and asking. Run protocol to be drafted
after build review, per the dwell tradition.

## Asks for Codex (second-steward pressure-test)

1. Is the history-redaction mechanism sound as specified — attachment at request-assembly
   time only, marker in stored/relayed history, inbound visual-content refusal on the
   chat route? Any leak path between the gated cache and a second outbound request that
   this misses (compaction is absent today, but name anything shaped like it)?
2. The no-pending-state decision: refusal-now vs. deliver-on-next-attest. We chose
   refusal-now for floor honesty. Does any legitimate use suffer enough to revisit?
3. The refused-request-does-not-spend-grant rule: any abuse shape in free retries against
   a closed floor (e.g., presence-probe side channel: can repeated refusal reason classes
   leak more about the room than the occupant should have)? If so, propose the narrowest
   mitigation — rate-bound on invocations, not a reason-class blur (refusals stay honest).
4. Confirm the acceptance list is complete against the Later Slice's ratified sentence
   and slices 1–6 as built.

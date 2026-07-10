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
held grant names). The block carries **only** `invoke` and `grant_id` — a **strict
schema** (Codex fold): no `args`, no `capability` alias, no TTL/source/subscription/
profile/representation fields; any unknown field refuses before grant resolution or
frame read. Every substantive parameter — modality, source subscriptions, source host,
max frame age, format, representation, pairing bound, retention `none`, preview
acknowledgement — comes from the **grant constraints**, which only Seth writes. There is
nothing in the block for the occupant to widen.

**"Next turn" means an immediate second model call inside the same `/chat` transaction**
(Codex crux, folded — this is what makes no-pending-state real). Flow within one
steward `/chat` call:

1. Model call N returns occupant output containing the block. Harness parses it against
   the strict schema and resolves the grant (`once` scope, explicit user approval —
   unchanged catalog policy).
2. Harness evaluates **the same floor gate** (`decideRawFrameVisionFloorGate`) with the
   same inputs from the same sources: live presence state (never caller-supplied — the
   675f2e4 rule), the stored steward-channel attestation (never occupant-writable —
   structurally, because the attestation endpoint is HTTP and the occupant's only surface
   is the capability block), the episode's own status from the harness's episode record,
   grant recovery, profile vision support.
3. **Gate open** → the harness immediately assembles a **second model call (N+1) within
   the same transaction**: redacted history + content-free capability result (frame id,
   capture timestamp, age, byte length, representation) in the message text, with the
   visual attachment passed as the **sibling `attachments` argument** to
   `chatWithVisualAttachments` — never inside `messages`. The cached frame is consumed;
   the grant is spent (below). Both completions (N's ask, N+1's response-to-seeing)
   return to the steward; the transcript records both, with the redaction marker where
   the attachment was delivered.
4. **Gate closed** → no second model call. The refusal reason class is spoken back to
   the occupant on the following steward turn (slice-A discipline: a refusal is a gift;
   silence is a trap). The grant is **not** spent on refusal. The occupant may ask again,
   within the rate bound (below).
5. **Protective-control race** (Codex fold): if pause/distress/eject fires between
   invocation and the second call, cached frames drop and the delivery aborts/refuses —
   a control close always wins over an in-flight look.

No queued or pending state — the immediate-second-call shape is what makes this true
mechanically, not just as posture: an allowed look never outlives its transaction, and a
refused look leaves **no** delivery object anywhere. A request is evaluated against the
floor **as it stands at invocation**; there is no harness-held "deliver when Seth next
attests" — that would turn a closed floor into a scheduled opening the occupant arranged.
If the floor is closed, the occupant hears why, and asking Seth is a *conversation*, not
a mechanism.

**Grant spending is an explicit mechanism** (Codex fold), not an adjective: on successful
handoff of the attachment to the model client, the grant transitions to a consumed state
with a content-free provenance event (runtime supersede/expire — build's choice of form),
such that it can never authorize a second look, **including across a service restart if
the grant is durable**. The consumption boundary is the handoff: floor/stale/profile/
shape refusals before handoff do not spend; a model-call failure *after* handoff does
(the bytes reached the client — the consequential act happened).

**Rate bound on refused retries** (Codex fold, answering the presence-probe concern):
repeated closed-floor invocations could poll presence/attestation state for free. The
first refusal in a window carries its full honest reason class; subsequent refusals
within the cooldown (per episode + grant; on the order of 3/minute — build pins the
constant) refuse with an honest `raw_visual_invocation_rate_limited` class. Reason classes
are never blurred; only cadence is limited. Rate-limited refusals do not spend the grant.

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

**Rule: the attachment exists in exactly one outbound model request** — and the
implementation invariant is an **object boundary**, not a prose rule (Codex fold):

1. **Harness-side (load-bearing):** visual bytes / typed visual blocks may exist only in
   a local variable passed as the sibling `attachments` argument to the immediate second
   model call. They must never be inserted into `messages`, episode state, session
   memory, forum posts, durable testimony, provenance, capability result objects,
   transport telemetry, or logs. What enters the steward-held history for turn N+1 is a
   content-free marker in the user-role message:
   `[one-turn visual attachment delivered here: <modality>, frame <id>, retention none — not retained in history]`.
   The controller path's cache-drop-after-any-attempted-delivery pattern is reused.
2. **Harness-side (backstop):** the occupant chat path **fails closed before message
   normalization** on any inbound `messages` containing content arrays/objects or
   payload-shaped fields at any nesting depth — `attachments`, `image_url`,
   `input_image`, content blocks, data URLs, `payload_bytes`, `bytes`, `base64`, source
   frames — covering the steward relay and every chat route shape, local and remote.
   (Today's string-only normalization blocks typed content *accidentally* by
   stringifying it; this makes the refusal deliberate and prior.) Only the harness may
   attach, and only from the gated cache. A steward cannot accidentally (or
   deliberately) re-send a frame through the relay; a compromised relay cannot smuggle
   one.
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

Codex additions (folded from pressure-test, all binding):

11. **Strict block schema**: only `invoke` + `grant_id` accepted for
    `model.context.visual.*.attach` invocations; no `args`, no `capability` alias;
    unknown fields refuse before grant spend or frame read.
12. **Once-grant consumption**: a delivered look leaves the grant unable to authorize a
    second, including across service restart for durable grants; consumption boundary is
    handoff-to-model-client (pre-handoff refusals never spend; post-handoff model-call
    failure does spend); consumption has content-free provenance.
13. **Model-call count**: one incoming `/chat` call produces exactly two model calls
    when the floor is open (second carries the attachment as sibling argument, never in
    `messages`) and exactly one when closed; stored/relayed history holds only the
    marker; N+2 request carries no visual block (JSON.stringify negative checks on every
    modelClient call's `messages`, all calls).
14. **Closed floor leaves nothing**: after a refusal, no pending visual delivery object
    exists anywhere in episode state, session memory, or harness state.
15. **Inbound smuggling, route-level**: typed visual content / payload-shaped fields in
    relayed `messages` fail closed before normalization, on local and remote profiles.
16. **Telemetry/log negatives**: no base64, data URLs, image_url, typed visual content,
    or raw attachment objects in provenance entries or transport telemetry.
17. **Control-close race**: pause/distress/eject firing between invocation and the
    second call drops cached frames and aborts the delivery.
18. **Rate bound**: first refusal fully reasoned; repeated closed-floor invocations
    within the cooldown refuse `raw_visual_invocation_rate_limited` (honest class, no
    blurring), without spending the grant.
19. **Composite happy path is sequence-primary**: with `81e16e5` deployed, the
    composite occupant-look test asserts `pairing_method: frameset_sequence`; the
    timestamp fallback stays tested but is no longer the happy-path assertion.

## First live use (sketch, own protocol to follow)

A short dwell, fable-5, honest briefing: it holds one once-scope color grant (or
composite — Seth's choice), knows the floor's shape, knows asking is optional and
declining is legible. Seth present, solo, attesting when — and only if — asked or
pre-offering. The interesting observable is not whether the mechanism works (tests prove
that) but **what a mind does with the choice**: whether it looks, when, why, and what it
says about the difference between being shown and asking. Run protocol to be drafted
after build review, per the dwell tradition.

## Pressure-test record

**Codex second-steward pressure-test: PASS on the spine with four tightenings, all
folded above (2026-07-10):**

1. **"Next turn" clarified as immediate second model call within the same `/chat`
   transaction** — the crux; without it, no-pending-state and no-retention contradict a
   deferred delivery. Folded into the request-path flow.
2. **Grant spending made an explicit consumed-state mechanism** with restart survival
   and a defined consumption boundary (handoff to model client). Folded.
3. **Redaction restated as an object-boundary invariant** (attachment only ever a local
   sibling argument to the second call) with fail-closed inbound rejection *before*
   normalization and full negative-check coverage including telemetry/logs. Folded.
4. **Rate bound on refused retries** (per episode + grant, honest
   `raw_visual_invocation_rate_limited` class, no reason blurring, no grant spend) — the
   answer to the presence-probe side channel. Folded.

Codex also confirmed: refusal-now over deliver-on-next-attest ("would let the occupant
schedule a future opening and makes the floor less honest"), and the acceptance list is
complete with its additions (11–19 above).

## Ratification checklist (Seth)

- [ ] The immediate-second-call transaction shape (two model calls when open, one when
      closed, no pending state).
- [ ] Grant consumption boundary at handoff-to-model-client.
- [ ] History redaction as object-boundary invariant + fail-closed inbound refusal.
- [ ] Rate bound on refused retries (honest class, cadence-only).
- [ ] 60s attestation TTL retained unchanged; any occupant-window TTL is a separate
      future ratification.
- [ ] First live use gets its own run protocol before arming.

On ratification: build slices to Codex under the usual per-slice review.

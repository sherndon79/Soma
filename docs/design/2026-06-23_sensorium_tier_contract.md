# Sensorium Tier Contract — System-1 local perception/expression ↔ System-2 foundation deliberation

Status: DESIGN DRAFT (Claude → Codex), 2026-06-23. Not yet built. For critique + build-shaping.

> **RECONCILED 2026-07-08 — read the minimization framing through two later decisions.** This contract was written assuming the deliberating occupant is the *remote* System-2 tier, so "the occupant receives only minimized semantic events" and "input minimization protects bystanders" (§4) were correct *for a remote occupant across the egress seam*. Two ratified/settled decisions moved the seam: (1) the **perception-modalities direction** — the *local* occupant receives FULL perceptual richness (color/depth/presence/pose), gated solely on Seth's deliberate arming, never minimized for being local, because minimize-before-egress binds the boundary to the *remote/frontier* tier, not the on-box occupant; and (2) **Amendment I to the Bystander Doctrine** (RATIFIED 2026-07-08, `docs/reviews/2026-07-08_bystander_doctrine_amendment.md`) — perception is not a sink; the bystander floor binds at **use** (durable/outward/remote/action artifacts), not at what the local occupant perceives. So throughout this doc: the minimization seam is real and stays, but it sits between the **local occupant and the remote frontier tier** (and at durable/outward sinks), NOT between local perception and the occupant. §4's "input minimization protects bystanders" is superseded on the perception layer and preserved at the sink layer. Where this doc says the occupant gets only minimized events, read: *the remote tier* gets only minimized events; the local occupant gets full richness.
North star: [[project_soma_north_star_narrow_band]] — narrow the band the human *feels* between
working ON the computer and working WITH the agent, WITHOUT dissolving the mechanism seams that
hold the bystander floor. Seamless on top, structured underneath.

This contract specifies the **sensorium tier**: a local, low-latency System-1 layer that mediates
the full perceptual loop between Seth and the occupant, escalating sparse minimized semantic events
to the System-2 foundation tier and rendering the occupant's expression/actuation back into the
shared desktop field. It does NOT specify locomotion/actuation-on-physical-world (irrelevant here);
its "actuation" is desktop/host/egress, already governed by the C0–C4 + LCA machinery we built.

---

## 1. Architecture: a coupled loop, not a pipe

Two tiers, robotics-grounded (Helix/GR00T dual-rate split — see north-star memory for the VLA survey):

- **System-1 (sensorium tier)** — LOCAL, continuous, cheap, low-latency. Perceives the shared field
  (input channels) and renders the occupant's expression/actuation (output channels). Runs a small
  local model + deterministic policy. Never the deliberator.
- **System-2 (foundation tier)** — Claude/Codex/frontier. Slow, expensive, invoked SPARSELY. Plans,
  orchestrates, decides. Receives only minimized semantic events; emits only intent + authorized acts.

The tiers form a **loop**, not a one-way pipe. Critically, the loop is **coupled**: System-1's input
perception (e.g. "another person is present") DIRECTLY governs System-1's output behavior (e.g.
"don't speak that aloud"). Do not implement input and output as independent subsystems.

The interface between tiers is a **deliberate, minimized semantic representation** — analogous to
Helix's S2→S1 latent handoff, but with the key disanalogy IN OUR FAVOR: theirs is co-trained and
opaque; ours is **separately-developed, designed, and inspectable**. The handoff schema is a
first-class governed artifact, not learned weights. That inspectable seam is what lets the band feel
seamless on top while staying structured underneath.

---

## 2. Channel inventory (Seth's enumeration)

Six concrete channels in the shared field, plus the egress modality:

| Channel | Dir | Carries | Heaviest floor concern |
|---|---|---|---|
| text / keyboard | in | what Seth types | low; pasted content may carry others' data |
| desktop visualization (screen) | in | the DIGITAL surface | dense bystander (calls, others' text) |
| video / camera (physical sensorium) | in | the PHYSICAL space: Seth, room, anyone in it | **highest** — non-users, family, never-consented |
| audio — mic | in | room + voice | **high** — other voices, calls |
| audio — speaker | out | occupant's audible cues | provenance; intrudes on shared physical space |
| visual cues / desktop | out | occupant's expression + actuation into the desktop | provenance + copresence + authority |
| **network egress** | out | outbound comms to THIRD PARTIES (email/chat/post/API) | **floor-heaviest** — reaches non-consenting others |

Note the input/output mirror: camera/mic = perceiving bystanders; egress = *reaching* bystanders.

---

## 3. The governing model: two orthogonal dimensions, scored per act (NOT two pipelines)

Every OUTPUT act is scored on **two orthogonal dimensions**. They are dimensions, not bins —
most real acts carry both at once. (Seth's correction: "to present something to you, you'd surface
a window" — one act that is actuation-in-service-of-expression.)

- **Consequence axis** — what it changes, reversibility, who it reaches → governs **AUTHORITY**
  (the existing C0–C4 consequence classes + interaction transactions + LCA gates).
- **Communicative-intent axis** — is it meant to be perceived as the occupant expressing →
  governs **PROVENANCE + COPRESENCE DISCRETION**.

The corners exist but are the exceptions:
- pure actuation, ~0 intent: a silent shell command (consequence-governed only)
- pure expression, ~0 consequence: a non-speech tone (provenance/discretion-governed only)
- **the middle is the default shape of desktop collaboration**: *surface-a-window-to-present*
  carries both — low consequence (reversible, local, affects only Seth's view) AND high
  communicative intent.

**Implementation directive:** there is no "expression pipeline" and "actuation pipeline." There is
one output path; each act is annotated with (consequence-class, communicative-intent) and routed
through the authority gate AND the provenance/discretion gate as applicable. Build the
*surface-to-present* case as the default, the corners as special cases.

---

## 4. Minimization seams (run both ways, asymmetrically)

> **Amendment I / perception-modalities reconciliation (2026-07-08):** this section is the one most affected. "Input minimization protects bystanders" holds at the **egress/sink** boundary (raw never leaves the box; the remote tier gets only minimized events; durable/outward/remote/action artifacts are floor-bound) — NOT at the local occupant's perception. The local occupant receives full richness after Seth arms it. Bystander protection is at **use**, not perception. See the top banner and the amendment record.

- **Input minimization — protects BYSTANDERS.** The raw sensory stream (esp. camera/mic) NEVER
  egresses and never reaches System-2. The local tier's FIRST job on camera/mic, before any handoff
  exists, is bystander-protective reduction: faces/voices become *presence events*
  ("another person is present", "a second voice is speaking"), never raw frames/audio. This is the
  keystone reframe: local perception holds the floor by TOPOLOGY (raw stream doesn't leave the box),
  dissolving the egress-half of the deferred attribution problem.
- **Output provenance/legibility — protects SETH (and third parties).** Every communicative output
  must be unforgeably legible as the OCCUPANT's expression: never mimic OS chrome, never impersonate
  a third party, never render anything indistinguishable from a system dialog. The LCA stays
  out-of-band PRECISELY SO the output sensorium can never become a confirmation channel — the
  occupant can SHOW it wants confirmation, but cannot MANUFACTURE the confirmation surface.

---

## 5. Per-channel contract (each channel = inbound AND outbound obligations, coupled)

For each channel, specify: (a) what System-1 perceives, (b) what it minimizes, (c) what it
escalates to System-2, (d) what System-1 may render outbound, (e) how outbound is
provenance-marked + copresence-gated.

### 5.1 text / keyboard (in)
- Perceive: Seth's typed input directed at the occupant.
- Minimize/escalate: route intent to System-2; do not treat ambient typing in other apps as
  addressed-to-occupant without explicit address.
- Open Q: how is "addressed to the occupant" vs "Seth working in his own app" disambiguated
  locally without escalating everything?

### 5.2 desktop visualization / screen (in)
- Perceive: digital surface state (windows, focus, content the occupant is asked to act on).
- Minimize: escalate STRUCTURE/semantics, not raw screenshots, by default; raw region capture only
  when a task is scoped to it and only the scoped region.
- Couples to 5.6 output: the occupant's view of the screen is what it acts on; provenance of any
  on-screen change must distinguish "acted in Seth's app" vs "presented its own panel."

### 5.3 video / camera (in) — HIGHEST floor stakes
- Perceive: physical presence only. Default output of this channel to System-2 is a PRESENCE EVENT
  vocabulary, e.g. {seth_present, additional_person_present, person_count, count_bucket}, NOT
  identity, NOT frames.
- `person_count` is the exact local integer count exposed after deliberate local arming. Any future
  frontier-facing projection MUST coarsen or omit it; repeated exact counts are a side channel.
  `count_bucket` remains as a compatibility/discretion field until the output-copresence ruling
  retires or replaces that vocabulary.
- Minimize: raw frames never leave System-1. No face recognition / identity by default.
- This channel's presence-events FEED output discretion (see 5.5, 5.6). This is the primary coupling.
- Open Q: is the camera even enabled by default, or opt-in per session? What's the off-by-default
  posture given the stakes?

### 5.4 audio / mic (in)
- Perceive: speech directed at the occupant + presence cue "additional voice present".
- Minimize: raw audio never leaves System-1; transcribe-locally then escalate text intent +
  presence events. Non-addressed speech (Seth on a call, others talking) is a presence event, not
  content to escalate.
- Open Q: wake-addressing model — how does the tier know speech is FOR the occupant vs ambient?

### 5.5 audio / speaker (out)
- Render: occupant's audible cues (speech + non-speech earcons).
- Provenance: a distinct, consistent occupant voice/earcon identity — never imitate Seth, never
  imitate a system sound.
- **Copresence discretion (the coupling):** when 5.3/5.4 report additional_person_present, do NOT
  speak private content aloud; degrade to a visual-only/text channel or a neutral earcon. The tier
  knows others are present FROM the camera/mic it is minimizing.

### 5.6 visual cues + desktop (out) — expression AND actuation intermixed
- Render: presence/attention/uncertainty cues, AND the surface-to-present act, AND desktop
  manipulation (clicks/typing as a user).
- Two-dimension scoring (§3) applies here most acutely:
  - *consequence*: a presence dot ~0; surface-a-window low/reversible; manipulating Seth's app =
    real consequence → C0–C4 + interaction transaction.
  - *communicative intent*: cue/overlay/surface-to-present = high; silent background action = low.
- Provenance on ownership: occupant-owned surfaces are MARKED AS THE OCCUPANT'S (distinct chrome),
  distinguishable from "I changed something in Seth's app" and from a system dialog.
- Copresence discretion: a window grabbing foreground / covering Seth's active work is the visual
  analogue of speaking over someone — gate HOW it surfaces (don't steal focus without legibility).

### 5.7 network egress (out) — floor-heaviest, the missing modality
- The only output that LEAVES the box and reaches non-consenting third parties.
- Governed as high-consequence actuation: output-provenance here means NOT acting AS Seth toward
  the outside world → LCA-gate territory (identity-bearing, externally-consequential, often
  irreversible per the proportional-gating rule).
- Open Q: what is the minimum gate for "send a message to a third party in a channel Seth owns"?

---

## 6. What I want from Codex

1. **Pressure-test the two-dimension model** (§3) against real act sequences — does scoring every act
   on (consequence, communicative-intent) hold, or are there acts that need a third axis?
2. **The handoff schema** (§1): propose the concrete minimized-semantic-event representation —
   the inspectable analogue of Helix's latent. What's in a presence event, an intent event, a
   structure-tier screen event? This is the keystone artifact.
3. **Off-by-default posture** for camera/mic (§5.3 open Q) — given they're the highest-stakes
   channels, what's the enablement model that keeps the floor without killing the band?
4. **Where this composes with what's built** — C0–C4, interaction transactions, LCA, the
   capability catalog, occupantMemory. This is NOT a greenfield subsystem; it should reuse the
   authority spine and only ADD the perception/expression seam.
5. Apply the per-slice north-star test (the 5-point seat-belt test in the north-star memory) to the
   FIRST build slice and propose what that first slice should be (my instinct: a single non-physical
   channel pair — e.g. screen-in + visual-cue-out — to prove the loop + provenance + the two-axis
   scoring, before camera/mic raise the stakes).

Role division holds: Claude designs/reviews, Codex builds/commits. This is the design; push back hard
where it's wrong before any code.

---

## 7. Agreed v1 (Claude + Codex, 2026-06-23) — first-class envelopes + enforcement invariant

Codex reviewed §1–§6 and accepted the spine with one build-shaping condition, now adopted:
**audience/principal/substrate must be explicit FIELDS in the event/act records, not prose** — else
the surface-a-window middle case collapses to "low consequence + high expression" and misses whether
it steals focus, covers a call, mimics OS chrome, or speaks as Seth.

### 7.1 Semantic-event envelope (in) — append-only, short-lived, content-free by default
A single common envelope; channel-specific payloads nest under it (NOT one schema per channel —
that would recreate pipes). Top-level carries: `event_id`, `episode_id`, `observed_at`, `expires_at`
(~10s), `source` {tier, provider, capability, grant_id, domain}, `channel`, `event_type`,
`minimization` {level, raw_retained:false, raw_egressed:false, content_included:false},
`confidence_bucket`, `audience_context` {seth_present, additional_person_present, copresence_source},
`payload`, `policy_effects` {allowed_output_modes, blocked_output_modes, reason_codes}.
Channel payloads: presence (presence buckets, identity:"not_performed"), addressed-intent
(addressing occupant|ambient|unknown, content only-if-explicitly-addressed, ambient_content_elided),
screen-structure (focus surface_ref/role/occupant_owned/content_class, window count buckets,
available opaque refs), output-policy-update. **Invariant: System-2 never receives raw
screenshots/audio/video; events are short-lived, replay-safe, provenance-attached.**

### 7.2 Output-act envelope (out) — sibling record, scored ONCE, routed through existing gates
Carries: `act_id`, `act_kind` (visual_cue.show | surface.present | desktop.act.invoke_action |
network.egress), `substrate` (occupant_panel | seth_app | system_surface | external_network),
`principal` (occupant | seth | system), `audience_scope` (seth_only | copresent_room | third_party |
unknown), `consequence_class`, `communicative_intent` (none|low|high), `authority`
{capability, requires_lca, grant_id}, `provenance` {must_be_occupant_marked, may_mimic_os_chrome:false},
`discretion` {steal_focus, private_content_allowed}. One record, both gates (authority +
provenance/discretion) read it — this is Seth's correction made executable.

### 7.3 THE ENFORCEMENT INVARIANT (Claude, hardening H1+H2)
**The local tier is the policy enforcement point. System-2 proposes; the local tier CLASSIFIES +
RECONCILES + ENFORCES.** (Same "ambiguity resolves upward" / don't-trust-self-assertion invariant.)
- **H1 — `consequence_class` is gate-DERIVED, not caller-asserted.** Filled by the local scorer from
  {substrate, audience_scope, external_reach, reversibility, principal}. If System-2 could stamp its
  own consequence_class, the C0–C4 model is bypassable (e.g. a network.egress self-labeled C0).
  Schema marks the field as gate-derived.
- **H2 — `audience_scope` is RECONCILED against live presence, not trusted.** When an act asserts
  `seth_only` but live `audience_context` says additional_person_present (or unknown), the LOCAL gate
  downgrades (speaker-private → visual-only/earcon). The camera/mic→discretion coupling lives in the
  local enforcement point, not in System-2's good behavior. System-2 sees only minimized presence
  events and is not trusted to act on them faithfully for floor-protection.

### 7.4 Composition with built Soma (no new authority plane)
Reuse capability catalog/grants/provider contracts. Input events project from existing
`desktop.inspect.*` (+ future `perception.sensorium.*` subscriptions). Output reuses `desktop.act.*`
for Seth-app mutation; ADD an occupant-owned visual-surface capability for expression/presentation.
Provenance reuses the content-free event-record + bounded occupant-facing summary pattern. **LCA
remains for C3 / identity-bearing / external acts — especially network egress.** Occupant memory
receives ONLY explicit durable testimony / occupant-authored notes — NEVER ambient semantic events
(that is capture; the ~10s expiry + content-free default protects this line).

### 7.5 Camera/mic posture (off by default, not merely disabled)
Session-scoped capability grant + visible local indicator + local-only raw processing + no raw
persistence + no System-2 raw egress + emergency mute that DOWNGRADES presence to "unknown" rather
than blocking the loop. First allowed camera/mic output = presence/coprotection events only (no
identity, no recognition, no ambient-speech content). Wake/addressing deferred to explicit
push-to-talk / typed address; no always-listening inference in v1.

### 7.6 FIRST BUILD SLICE (agreed, Codex-tightened — GO)
Screen-structure-IN + occupant-owned visual-cue-OUT **only**. Synthetic container / live desktop
broker. **NO desktop actuation, NO camera/mic.** Build: (a) project `desktop.inspect.focus/windows/
accessibility_tree` into the §7.1 envelope; (b) `desktop.visual_cue.present` rendering ONLY
occupant-owned chrome (never OS-like, never Seth-app mutation); (c) two-axis scoring on the output
act with C0 / high-communicative-intent as the canonical first case, H1+H2 baked in; (d) provenance
records for event-observed / act-proposed / act-rendered-or-refused; (e) test: copresence "unknown"
blocks audio/private modes but still allows visual occupant-owned presentation. **Elegant property:
with no camera/mic, copresence is always "unknown" → slice 1 exercises the H2 coupling fail-safe for
free.** Proves the loop + provenance + surface-to-present default + the coupling, without raising the
bystander stakes or granting broad desktop control.

### 7.7 Open question: visual-private under copresence
Slice 1 gates private audio under unknown/copresent audience but allows occupant-owned visual cues,
because the first renderer is visibly marked local screen presentation rather than room-broadcast
speaker output. When camera/mic posture lands, revisit whether visual cues carrying private content
need a stricter copresence downgrade path for shoulder-surf cases.

## 8. Camera/mic enablement posture (Seth steer, 2026-06-23) — RealSense D435if, depth-first

Seth's two decisions: (1) the camera is an **Intel RealSense D435if exposed through the existing
sensorium subscription subsystem** (external USB depth camera, not a built-in webcam); (2) grant
lifetime is **explicit-revoke only** (most fluid; he accepted the weaker-floor / "left-armed"
tradeoff). This section is the camera posture; **MIC IS DEFERRED** (see §8.6).

### 8.1 The keystone move: DEPTH-FIRST, color OFF — the face is never-captured, not minimized-after
The existing model already separates streams as distinct grants:
`perception.sensorium.{color,depth,imu,location,status}.subscribe`. Exploit that:
- **Presence events (the agreed first output) require ONLY `depth` (+ optionally `imu`/`status`).
  They MUST NOT require `color`.** Body-presence (`seth_present`, `additional_person_present`,
  `count_bucket`) is derivable from the depth map without ever streaming RGB.
- **`perception.sensorium.color.subscribe` (the face-bearing stream) stays OFF for v1 presence** —
  it is a separate, higher-stakes grant, armed only when a specific task explicitly needs color and
  never for presence detection.
- Consequence: the densest bystander content (identifiable faces) is **never captured**, not
  captured-then-minimized. This is the topology floor made stronger than §4 hoped — minimization
  moves upstream of the sensor, into *which stream is even opened*.
- Constraint on depth-presence: derive only body-PRESENCE/COUNT buckets; **no identity, no
  person-reidentification, no skeletal tracking that singles out individuals.**

### 8.2 Trust anchor, given the RealSense has no privacy-wired LED
No gold-standard wired RGB LED here, so the anchor is a STACK, not one signal:
- **Physical:** external USB → unplug is the ultimate, Seth-controlled revoke. A lens cap/cover is a
  second physical floor.
- **Stream-state at the driver:** "what is on" == which sensorium stream-grants have open
  subscriptions, observable OUT-OF-BAND from the isolated sensorium processor (§8.3), NOT from
  anything the agent can paint. `color` open vs `depth` open is the load-bearing distinction.
- **Color-off-by-default** means even an "on" camera in presence mode cannot capture faces.
- The depth IR projector physically emits while depth-streaming (invisible but real).
- **Recommended addition (reminder-grade, not adversary-grade):** a deliberate persistent on-state
  indicator on the occupant-owned surface from slice 1 ("camera armed: depth"). Rationale: with
  explicit-revoke, the new risk is *Seth forgetting it's on* — a software reminder suffices for the
  forgot-case because the adversary-case (agent secretly capturing) is already covered by the
  topology floor. Do NOT treat this indicator as the authority anchor; the stream-state query is.

### 8.3 Isolation by topology (mirror of the FIDO udev/hidraw isolation)
Raw depth processing runs as a **dedicated unprivileged sensorium user in a network-denied sandbox**.
Raw frames NEVER persist and NEVER reach System-2; only minimized presence events cross the existing
semantic-event envelope (§7.1). "Raw never egresses" is a property of the wiring, not a policy
promise. The processor's open-stream state is the out-of-band on-state anchor (§8.2).

### 8.4 Lifetime: explicit-revoke (Seth) + two NON-timer backstops
Grant persists until Seth explicitly revokes (or physically unplugs). Two backstops that do NOT
reintroduce a timer/friction:
- **Disarm-on-session/harness-end** — a lifecycle bound, not a clock; kills the worst "armed for
  days unattended" case.
- **Existing per-subscription `max_seconds` ceiling** — bounds any single capture even while the
  grant persists (already a required constraint on color/depth).
Why explicit-revoke is SAFE here despite the weaker-floor framing: the topology floor (§8.1+§8.3)
means "left armed" has BOUNDED downside — no faces captured (color off), no raw egress — only
un-egressing presence events. The lifetime choice is low-stakes precisely because the floor holds
regardless of how long it stays armed.

### 8.5 Enablement actor + composition
Only Seth (user actor) may arm depth/color grants — reuse the existing
`sensorium_grant_create_requires_user_actor` gate; the occupant may REQUEST, never self-grant.
Compose entirely with the existing sensorium subscription machinery
(`perception.sensorium.*.subscribe`, `sensoriumSubscriber`, grant constraints/proposal templates);
add NO new authority plane. Depth-presence emits into the §7.1 envelope just as screen-structure does.

### 8.6 Mic: DEFERRED to its own posture round
Seth's steer named only the camera; the RealSense provides no microphone, so the mic is a SEPARATE
device with its own (unaddressed) trust anchor. Scope this slice to camera-via-depth-presence;
the mic posture (its anchor, its mute path, push-to-talk addressing) is its own decision and is NOT
in this slice.

### 8.7 First camera slice — NARROWED per Codex pressure-test (containment-first)
Depth-only presence events → §7.1 envelope, feeding H2 output discretion; color stays off; isolated
processor; explicit-revoke + session-end backstop; reminder-grade on-state indicator; Seth-only arm.
NO color, NO mic, NO identity/recognition. Proves the camera→presence→discretion coupling with the
densest bystander content (faces) never captured by construction. See §8.8 for the accepted
corrections that reshape this slice.

### 8.8 Codex pressure-test corrections (ACCEPTED, 2026-06-23) — containment is the gate
Codex pressure-tested §8 against the real librealsense + current sensoriumSubscriber/sensorBroker
plumbing. Three corrections, all accepted:

- **C1 — `seth_present` cannot be depth-only "Seth among people".** Depth robustly yields
  `additional_person_present` + `count_bucket` (+ occupant-in-a-bounded-zone), but asserting it is
  *Seth* needs identity (face/gait/skeleton/persistent tracking) = exactly the face-bearing capture
  we refuse. Resolution (keeps the floor): `seth_present` degrades to
  `session_assumed_present | zone_present | unknown`, `identity: not_performed`. The
  discretion-critical signal for H2 is `additional_person_present`, which depth does WELL — so the
  weakening barely touches the coupling. `imu` not needed for static room presence; `status` useful
  for stream/profile health anchoring.
- **C2 — the §8.2 authority anchor must be HELPER-OWNED open-stream state.** Not
  `SensoriumSubscriber.describeActive()` (Node-side mirror) and not the occupant panel indicator.
  The helper already supports `sensorium.subscribe.status`; add a method that queries helper status
  DIRECTLY and reconciles it with the Node active map. The load-bearing "is color off / depth on"
  fact is read from the helper, out-of-band from anything the agent paints.
- **C3 (the real blocker) — current containment is POLICY, not TOPOLOGY.** Today soma-sensor-broker
  is a Node child process under the same service/user (no dedicated user, no PrivateNetwork/sandbox),
  and raw sample `payload_bytes` CROSS INTO NODE where Node summarizes. Good no-persistence/
  no-provenance discipline, but raw frames reaching Node means "raw never egresses" is not yet a
  topology fact. **HARD RULE for this posture: presence is derived INSIDE the isolated helper; Node/
  System-2 receive ONLY the semantic presence envelope (or a bounded presence sample), NEVER raw
  depth `payload_bytes`. Helper runs under an OS sandbox: dedicated user, network-denied,
  device-scoped USB, no writable persistence beyond runtime state.** This is the FIDO-udev analogue
  and it GATES any live depth slice.

**Reshaped first slice (containment-first):** do NOT flow live raw depth until C3 is closed.
1. Helper-status anchor plumbing (C2): helper-owned open-stream state exposed to the local tier;
   tests prove "depth active + color inactive" is read from HELPER status, not UI/Node-mirror.
2. Helper-side semantic-presence boundary (C3): presence computed before Node sees raw frames;
   Node receives only the envelope. If helper-side summarization is too large for one slice, split:
   **1a** = status-anchor + sandbox + contracts/tests (no live depth); **1b** = helper-side presence
   derivation + live depth. Codex picks the 1a/1b boundary based on helper code size.
3. Event vocab: `additional_person_present`, `count_bucket`, `confidence_bucket`,
   `copresence_source=depth`, `identity=not_performed`, `seth_present=session_assumed|zone|unknown`.
4. Explicitly refuse color for presence — tests must prove NO color subscription is opened for
   depth-presence.
5. Feed presence into existing H2 output discretion.
6. Reminder-grade visual cue only AFTER helper status confirms depth active; labeled non-authoritative.
7. Verify runtime shutdown actually stops/cleans active sensorium subscriptions before treating
   session/harness-end disarm (§8.4) as built.

### 8.9 TOPOLOGY CORRECTION (2026-06-25) — the camera is REMOTE; minimization is subscriber-side
§8.1–8.8 above were written assuming the RealSense is LOCAL to the Soma host with a local-USB sandbox
(udev/DeviceAllow/network-denied helper). **That is WRONG. Corrected by Seth + a read-only SSH look at
the device:**
- The RealSense **D435i (USB 8086:0b3a)** lives on **jetsorano** (a Jetson Orin Nano), running Seth's
  SEPARATE stack `~/project-repos/Sensorium` (always-on docker `sensorium-node`). **Sensorium is a
  deliberately-dumb RAW publisher** — its README: it does NO inference/policy/minimization, "those
  concerns belong to whatever subscribes." It publishes raw color (JPEG) + depth (PNG-16 848×480) + IMU
  over **Zenoh** (tcp/192.168.20.179:7447). **Soma is purely the SUBSCRIBER** (`soma-sensor-broker` =
  the Zenoh client).
- **So minimization is SOMA's job, by Sensorium's design** — the inverse of §8.1's edge-minimization
  assumption. (Seth chose Soma-side minimization, 2026-06-25; edge-minimization would require Sensorium
  Phase 4, his roadmap, deferred.)
- **CONTAINMENT MOVES (supersedes §8.3 / §8.8-C3):** the §8.3 "raw depth processing in a dedicated
  unprivileged, NETWORK-DENIED, local-USB sandbox (FIDO-udev analogue)" is WRONG for a Soma broker that
  is a NETWORK CLIENT (a network-denied sandbox would block the Zenoh peer; there is no local USB
  device to isolate). The real containment is a **subscriber-side semantic transform IN the
  `soma-sensor-broker` BEFORE Node**: the broker decodes PNG-16 depth and derives PRESENCE, emitting
  ONLY a presence event (structurally type-split: a `PresenceEvent` variant that CANNOT carry raw
  bytes) — raw depth payload_bytes NEVER reach Node. The boundary is the broker, not a network hop or a
  USB sandbox.
- **COLOR-OFF (supersedes §8.1's stream-grant framing, refined):** Soma simply never SUBSCRIBES to the
  color topic for presence; the anchor confirms `color_active=false`. (Device-level color-deny would be
  Sensorium's concern, not Soma's.)
- **Local-device isolation packaging is REMOVED from Soma** (it belonged in Sensorium); the
  fail-indeterminate **anchor fix is the keeper** (it is correctly subscriber-side: which Zenoh streams
  are open).
- **V1 PRESENCE FLOOR POSTURE:** depth-only body-counting without calibration confuses furniture with
  people, so v1 is NOT a confident "room empty / no bystander" oracle. Under-confidence ⇒ `unknown` ⇒
  H2 treats unknown as COPRESENT ⇒ over-downgrade discretion. Better to over-downgrade than under-detect
  a bystander. (count buckets only; identity=not_performed; no Seth-identity from depth.)
- **TURN-ON:** Sensorium is always-on on the LAN, so live validation uses the real stream — the
  floor-crossing is enabling Soma's depth-presence subscription (Seth-gated), not a hardware session.

---

## 9. Network-egress gate (Seth steer, 2026-06-23) — the floor-heaviest output

Egress is the only output that LEAVES the box and reaches non-consenting third parties in Seth's
name. No comms/send capability exists in the catalog yet, so this defines egress's FIRST surface and
the gate every future egress capability must pass. The authority spine already exists:
`deriveConsequenceClass` routes `external_reach` / `audience_scope=third_party` /
`substrate=external_network` → **C3 → requires_lca**, and the FIDO hardware-touch LCA is the same one
the systemd C3 restart used. Egress REUSES that plane; no new authority plane.

Seth's two steers: (1) **recipient-visible marking** (the outbound carries a mark the recipient can
see that it is agent-assisted / sent on Seth's behalf); (2) **graduated-by-risk send gate**.

### 9.1 Scope: communication, not packets
The gate triggers on **identity-bearing outbound communication that reaches a person** (email, DM,
post, comment, issue/PR prose). It does NOT gate raw network I/O (model API, package fetches,
public-web reads) — those are not the floor concern.

### 9.2 The keystone move: DRAFT is free, SEND is gated
The egress analogue of depth-vs-color. The occupant composes/drafts freely into an occupant-owned
surface Seth can read — just reviewable text, NO gate. The gate sits ONLY at the SEND/transmit
boundary (the irreversible reach-the-world step). Drafting stays in-flow; the touch lives exactly
where agency crosses into someone else's world. The sent body IS the reviewed draft (provenance can
reference the draft id rather than re-recording content — keeps the content-free discipline while
the reviewed draft is the audit record).

### 9.3 Recipient-visible marking (Seth: yes, UNCONDITIONAL) — always-on, orthogonal to the gate
Every agent-sent outbound carries a visible "agent-assisted, sent on Seth's behalf" marker. The mark
is a PROPERTY OF THE EGRESS CAPABILITY: the gate REFUSES to transmit unmarked — the agent cannot send
without it. Per-channel rendering (email header/footer line, chat prefix, post disclosure). This
extends output-provenance (§4) OUTWARD: the recipient-facing mark is the anti-impersonation
mechanism made visible to the third party. It is ALWAYS-ON and ORTHOGONAL to the graduated gate —
marking = honesty (every tier), gating = friction-proportional (varies by tier). NB this is a
DIFFERENT decision than the host-management attribution REFUSAL ([[project_soma_host_management_reframe]]):
that refused attributing *perceived* content; this is recipient-facing disclosure when the agent
reaches *other people in Seth's name*.

### 9.4 Graduated send gate (Seth: graduated by risk)
- **Tier-0 (light — in-flow confirm):** reply within an ESTABLISHED thread Seth participates in, to
  a KNOWN correspondent, 1:1, private, low-sensitivity. In-flow confirmation, NOT a hardware touch.
- **Tier-1 (hardware touch / LCA):** ANY of — novel/cold recipient, public channel, multi-recipient
  / broadcast, irreversible-broad reach, or possibly-sensitive content.
- **DEFAULT for third-party egress is Tier-1 (touch).** The light path must be EARNED by
  gate-VERIFIED relationship facts, never caller-asserted. (Same invariant as H1/H2: the local gate
  classifies; System-2 cannot stamp "known recipient" to dodge the touch.) Absent verifiable
  established-thread / known-correspondent proof → fail-safe to touch. The tier dimensions
  (recipient novelty, reach, channel publicness, reversibility, content sensitivity, thread
  continuity) are gate-derived into the consequence class, never accepted as caller claims.

### 9.5 First egress slice (proposed scope for Codex)
ONE dedicated channel, narrow: draft-into-occupant-surface (free) + a single `comms.*.send`
capability whose transmit path (a) applies the §9.3 recipient mark unconditionally and REFUSES to
send unmarked, (b) runs the §9.4 tier resolver gate-side, defaulting to Tier-1 touch and only
tiering down on gate-verified established-thread facts, (c) routes Tier-1 through the existing LCA,
(d) records content-free provenance (recipient, channel, tier, mark-applied, draft-ref, LCA-evidence)
referencing the reviewed draft. NO egress-via-blind-desktop-clicking (see §9.6). Prove: unmarked send
is refused; novel recipient forces touch; caller cannot self-assert "known recipient" to skip it.

### 9.6 The detection gap (FLAG, do not solve in slice 1)
A dedicated-capability gate does NOT catch egress-via-blind-desktop-actuation — the agent typing into
Gmail and clicking Send in a browser. Recognizing that a *click* constitutes egress is a separate,
harder problem. The dedicated path is where the agent SHOULD egress (legible, classifiable);
desktop-actuation egress in identified comms apps must be constrained SEPARATELY (e.g. actuation in a
known comms surface requires the same gate, keyed on app identity). Out of slice-1 scope; named so it
is not forgotten when desktop actuation lands.

### 9.7 For Codex — pressure-test before build
1. Does the draft/send split (§9.2) compose cleanly with the occupant-owned surface from slice-1
   (screen-in/cue-out), or does drafting need its own surface contract?
2. Tier-0 verification (§9.4): what is the gate-side source of truth for "established thread / known
   correspondent" that the agent cannot forge? If there is no verifiable source in slice 1, Tier-0
   should NOT exist yet — first egress slice may be touch-every-send until the verification exists.
3. Recipient-mark enforcement (§9.3): confirm the transmit path can structurally refuse unmarked
   send (mark applied gate-side, not by the caller), per-channel.
4. Reuse check: egress acts as output-act envelopes (act_kind `network.egress`, substrate
   `external_network`, audience_scope `third_party`) → existing deriveConsequenceClass → C3 → LCA.
   Confirm the existing LCA path is invocable from a comms-send capability as it was from systemd.
Role division holds: I design/review, you build/commit. Push back before any code.

### 9.8 Codex pressure-test ACCEPTED + refinements (2026-06-23) — fixture-first, Tier-1-only
Codex pressure-tested §9 against the real LCA/output-act/grant plumbing. Accepted:
- **Tier-0 does NOT ship in slice 1.** No non-forgeable relationship verifier exists (no comms
  provider, no mailbox/contact/thread index, no provider-owned conversation metadata). Slice 1 =
  **touch-EVERY-send**, reason `egress_relationship_unverified`. Graduated architecture is ENCODED
  but only Tier-1 reachable. Tier-0 introduced ONLY when a comms adapter supplies gate-owned evidence
  (provider_thread_id, prior Seth-authored participation, recipient identity from provider metadata,
  1:1/private proof, freshness/digest binding). Caller-supplied known_recipient/thread flags ignored
  exactly like caller consequence_class.
- **Immutable DraftArtifact** {draft_id, draft_digest, channel, recipient set, mark policy,
  created/reviewed timestamps}. Sent body is byte-for-byte (reviewed draft + gate-applied mark);
  digest mismatch fails CLOSED → new draft/review. (Same plan-digest continuity as the systemd
  attended driver.)
- **Marking enforced provider-side**: caller submits draft body + target; gate/provider applies the
  mark, computes final_body_digest, REFUSES any request supplying/suppressing the mark. Per-channel
  rendering in the provider contract.
- **R1 (LCA reuse approach):** reuse the UNDERLYING LCA primitive directly (plan_digest binding,
  requireMatching/consume, nonce/TTL/single-use, origin rejection) + a THIN comms layer only
  (CommsSendPlan = plan_digest + target_binding_digest over channel/recipient/draft_digest/mark-policy;
  comms-flavored error). Do NOT extract a generic adapter yet (rule of three — 2 C3 uses so far:
  systemd + comms); do NOT copy the host-flavored wrapper (divergence). Extract the generic adapter
  when a THIRD C3 capability appears. Tier-1 = same trusted-local-hardware path, no in-flow bypass.
- **R2 (mark visible AT REVIEW):** the mark goes out in Seth's name → Seth must SEE it before send.
  DraftArtifact review PREVIEWS the gate-applied mark (rendered per channel); final_body_digest =
  digest over (reviewed_content + the mark shown at review). review == exactly-what-recipient-sees.
  Mark stays gate-owned/unsuppressable; it is merely also visible to Seth at review.
- **§9.6 detection gap:** agreed out of scope; dedicated comms path is the ONLY supported egress for
  slice 1.

**First egress slice (fixture-only — safe to build freely):** DraftArtifact create/review (no send
authority) with mark previewed at review; `comms.fixture.send` behind a disabled/requestable explicit
grant; CommsSendPlan builder/scorer (gate-derived C3/requires_lca; caller consequence/tier/
known-recipient claims IGNORED); Tier-1-only resolver (relationship_evidence=unverified,
lca_required=true); provider applies+enforces the mark unsuppressably; apply path requires active
grant + exact draft_digest + exact target_binding + matching unconsumed LCA receipt → fixture send →
content-free provenance. Tests: draft free/no LCA; unmarked/suppress-mark refused; mark present in
final_body_digest; caller cannot self-assert Tier-0 (claim ignored, touch still required); LCA
receipt mismatch / draft drift / recipient drift fail closed; successful fixture send consumes the
receipt and records no body.

**SLICE-2 GATE (real transmit replaces the fixture):** same standard as camera 1b — before any real
external transmit: (a) real provider adapter + per-channel mark rendering reviewed; (b) proof
transmit cannot fire without grant + exact draft_digest + exact target_binding + matching unconsumed
LCA receipt; (c) proof no body content recorded in provenance; (d) the relationship-verifier design
IF Tier-0 is to be introduced. Until (d) exists, Tier-1-only stays.

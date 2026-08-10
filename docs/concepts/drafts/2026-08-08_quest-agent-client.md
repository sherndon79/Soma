# Quest agent-interaction client — architecture & v1 plan

**Status: APPROVED ARCHITECTURE; v1a POSITIVE LIVE PATH VERIFIED, live negative cases pending.**
Produced by the `spec/quest3-agent-client` workflow (Claude + Codex, independent-first research →
convergence → review). Lives in Soma because **the client is Soma's** (it reaches the wearer and
carries perception, gated by Soma's consent/floor machinery) per Threshold `AGENTS.md` rule 6.
Threshold retains only the native toolchain and hardware probes (§12), which link here.

Supersession note (2026-08-09): the original header said no implementation was authorized. Seth
subsequently approved the architecture, placement, and v1a→v1b milestone through the workflow's
human gate. v1a now exists under `clients/quest-surface/`, `src/questSurface*.js`, and the disabled
catalog/provider entries. The 2026-08-09 device exercise verified mTLS, a fresh lease and snapshot,
composition, and the actual-bounds acknowledgement; it did not close the live negative-case suite.
Update (2026-08-10): **v1b is now built host-side** — the wire/consent machinery (armed episode,
four-leaf manifest, per-stream audio, fail-closed latch), the dual-mode answer matrix (armed leaf
selects the mode; text-local live, the other three cells inert), and the **real local answer route**
(Whisper STT → local Gemma → Kokoro TTS behind the abort-aware pipeline: interruptible, fail-closed,
transcript-firewalled, no-retention, voice-brief) — all verified host-side against injected-fetch
adapters (`npm run test:quest-v1b-loopback`). Remaining: the live-services loopback and the on-device
run (Gate 2, Seth-only). Barge-in / streaming-to-wire is a defined follow-on slice. See
`docs/runbooks/quest_surface_v1b.md` and `docs/design/2026-08-10_quest-v1b-item-i-scope.md`.

---

## 1. Goal and the open-endedness principle

Give an agent (via Soma, on the workstation) a **fairly open-ended interaction surface** on the
Quest 3 — not limited to a fixed UI or feature-specific RPC menu.

**Open-endedness comes from compositional TYPED DATA + content-addressed resources + negotiated
versioned extensions — NOT from arbitrary execution, and NOT from a fixed feature menu.** The Quest
is a thin, untrusted endpoint: it never accepts code, HTML/WebView, shaders, filesystem paths,
URLs, or model-authored executable commands. Anything requiring fetch/scan/transform happens on the
workstation under *its* egress authority; the Quest receives only bounded, content-addressed bytes.

## 2. Architecture split — what runs where

**Soma workstation owns** (authority + compute): policy gateway, exact capability grants, episode
state, audience/destination decisions, model routing, speech inference, content/resource validation
+ scanning, provenance, session revocation; a **`quest.surface` provider/broker** that compiles
agent/model output into a bounded, versioned **surface document**; asset/media preparation and an
optional stream encoder; the canonical presentation intent and input-event routing.

**Quest owns** only what latency and OpenXR require: the OpenXR instance/session/frame loop; focus +
presence state; swapchains + composition; local rendering/decoding; an asset cache with TTL + size
quotas; **semantic hit-testing against the locally displayed revision**; controller/hand/gaze/voice
sampling **only when negotiated and currently leased**.

**Head-pose invariant (absolute).** The **display-driving head-pose sample and its
display-time correlation never leave the device under ANY grant.** It exists solely to render
locally. There is **no** "raw display head-pose" capability in the authority inventory (§7), and
**no** future "render-pose export" option while this absolute holds. Any future *derived* head-state
perception channel, if ever designed, is a distinct sampled/derived capability and **cannot** be
used as remote-render pose. Local OpenXR lifecycle ownership is **necessity, not policy authority.**

## 3. The scene surface — a live, agent-authored Spatial Document

The protocol primitive is a versioned **Spatial Document**: a live scene the agent **authors** by
streaming ordered transactions (§5), not a shelf of pre-stored assets. **The medium is 3D space —
the world — and this surface is meant to be wider than our text channel, not a port of it.**
Panels/text are the cheapest first probe of the plumbing (§10), never the ceiling or the definition.

**Construction is open-ended within a versioned vocabulary and explicit render/comfort bounds** —
*not* "fully open." Shape variety is not the same as unlimited simultaneous complexity; that is an
honest property of a mobile GPU, not a flattening back to panels.

**Authoring vs render IR — the split that keeps the ambition without making the headset an
agent-code runtime:**
- **Arbitrary construction authoring lives on Soma/workstation** — a broad, extensible generative
  language, where the agent and the compute are. Constructive operations (extrude / boolean /
  remesh / tessellate / most procedural geometry) run **there** and emit mesh resources. This means
  open-ended authoring through Soma's **trusted compiler/tooling**; *executing model-authored code*
  is a separate Soma authority/sandbox design, out of scope here.
- **The Quest receives a finite, bounded, validated render IR** — the Spatial Document — that it
  validates and renders. (Rendering untrusted data still reaches parsers and the GPU driver;
  validation *reduces*, never *erases*, that risk.) The endpoint grammar stays finite even though
  authoring is arbitrary.
- **Only genuinely local time-evolution earns endpoint forms** (particles/fields, local
  animation/morph). High-rate *topological* change is the case for a **vetted bounded local
  generator** (implicit-surface/SDF or parametric evaluator, e.g. `generator.sdf.v1`) — a
  **negotiated render extension, not an authority capability**: advertised in the client's
  supported-render-extensions, usable only when negotiated inside the surface-presentation lease +
  device budget; **its GPU cost is a renderability decision, never consent** (no human gate for
  compute). It carries a cost manifest (domain/grid resolution, evaluations, output verts/tris,
  rebuild Hz, transient + resident bytes, CPU/GPU time class, numeric/displacement range), runs
  **off the OpenXR frame thread**, is **cancellable/preemptible**, validates generated
  bounds/topology, and **atomic-swaps** at a displayed revision / entity generation — on overrun it
  retains the prior coherent generation or a declared fallback (observable receipt), never a
  half-generated mesh. **If a generator ever reads a protected source** (hands/gaze/scene/depth/
  camera/audio/anchors), THAT input is a separate exact authority; a generator driven only by
  streamed parameters + local time adds no perception authority. Extension, not v1 — earns inclusion
  by measurement.
- **Unknown/negotiated extension nodes fail explicitly or render a declared fallback — never
  implicit code.**

**Spatial Document contents (five sets; illustrative, versioned):** entities (stable ids, hierarchy,
transforms, anchor/space refs, bounds, visibility); immutable **content-addressed resources**
(mesh/index buffers, textures, glyphs, media); presentation components (primitives, mesh instances,
lines/ribbons/splines, text/panels, lights, clipping, material refs); bounded dynamics
(keyframe/skeletal/morph, parameter animation, particle emitters/fields); semantics (hit geometry,
action bindings, labels/accessibility, ownership/audience/TTL/lease refs). Final set aligns with the
capability-matrix migration + Codex convergence.

**Materials via a constrained shader-graph — still treated as a program, not free text.** A typed
finite DAG over a closed versioned operator set with a known cost class: no loops, data-dependent
control flow, atomics/stores, arbitrary buffer access, feedback, external fetch, or agent-supplied
shader binary; texture sampling only from validated resources; bounded displacement; no agent
control of passes/pipeline/targets/view. Prefer mapping graphs to pre-authored uber-shaders or a
capped material bytecode in a vetted interpreter over compiling agent-provided source.
**Agent-supplied bounds are never trusted**; defenses run both sides (schema/overflow validation,
quotas, worst-case costing, GPU-time watchdogs, session recovery, fuzzing).

**Rendering is a client backend concern, virtualized** — the backend planner packs nodes into an
app-owned projection layer / atlas over passthrough (alpha-blend), and **the composition-layer limit
never leaks into the protocol as "max nodes"** (measured in Threshold as planner *policy*, §12).
**3D is rendered by our Vulkan renderer** from the Spatial Document, composited over passthrough.
Rendering agent geometry *in* the room is free; geometry that *understands* the real room (real
occlusion, resting on real surfaces) is depth/scene **perception**, Soma-gated —
`XR_FB_triangle_mesh` and runtime scene/entity meshes are perception/runtime features, not the
authoring path.

**Render-bounds & graceful degradation:** a negotiated device/profile envelope plus orthogonal hard
admission bounds (ingress / residency / per-frame estimate+measure / device-health) and a runtime
frame/thermal governor. Budgets are a **renderability contract, not authority**. Over budget, degrade
**density/fidelity, never the vocabulary** (cull → LOD → lower resolution → reduce particle rate →
coalesce → placeholder → reject). Hard-invalid input is rejected; valid-but-expensive input is
**predictably degraded**, and the degradation is **observable** in the applied receipt (revision,
actual bounds, selected LOD, omitted/substituted entities + reason). Semantic interaction targets
only what was actually displayed.

**Wearer-safety content limits (justified, not flattening):** bounded luminance/flicker, no extreme
full-field motion or unsafe near-eye geometry/audio, the local stop is never hidden, and the runtime
guardian/boundary is never suppressed.

## 4. Four logical planes (contracts over transport, not four sockets)

- **session/control** — hello; client capability advertisement; runtime extension support; episode
  binding; lease/authority manifest; focus/presence; keepalive; revoke; resync; errors.
- **presentation** — immutable full **snapshots** plus (deferred) ordered deltas of the surface graph.
- **resources/media** — content-addressed, bounded text/image/mesh/audio/video resources; optional
  video is *content on a surface*, not the runtime.
- **interaction** — semantic action events, plus separately-authorized raw-modality samples.

Transport mapping: a reliable control channel carries session + presentation + semantic events; a
content channel carries bounded bulk assets/media.

## 5. State & correlation invariants

- Every connection has a fresh **session epoch**; every document a **monotonic revision + content
  hash**. Snapshot envelope carries: session epoch, document revision + hash, authorizing lease
  refs, TTL, and a deterministic **actual-bounds acknowledgement**. Deltas name their base revision
  and trigger snapshot resync on stale/wrong base. **v1 = snapshot-only; deltas specified,
  implementation deferred.**
- **Mutation is multi-lane** (snapshot+delta stays canonical for recovery): **(A) reliable ordered
  graph transactions** — topology / semantics / leases / resource-refs — each with epoch + base
  revision + new revision/hash, applied **atomically** (reject or defer the whole transaction, or
  resnapshot; **never drop a structural delta**), with periodic compact snapshots bounding recovery;
  **(B) immutable content-addressed resource transfer** on the bulk plane — large geometry versions a
  new buffer and **atomic-swaps** the entity ref after validation (no half-patched buffers);
  **(C) replaceable time/state updates** — transforms, morph weights, material/emitter parameters,
  animation cursors — newest-valid-wins, superseded may drop (local declared animation carries most
  smooth high-rate evolution); **(D) media** on its own deadline plane. **Drop-oldest applies only to
  (C) replaceable state samples — never to (A) structural transactions.** The Quest reports its
  highest accepted graph revision + current state tick; hit/action events bind the displayed graph
  revision and, when semantics depend on dynamic state, the applied state tick / entity generation.
- **Hit-test locally against what was actually displayed.** NATIVE surfaces resolve fully
  single-clock (`surface_id + UV` in headset time; no frame id needed).
- **Interactive STREAMED surfaces** additionally require the event to carry the presented
  `content_frame_id` + document revision the compositor sampled, so Soma can map UV → its own UI
  state at that frame. A streamed surface with **no** frame/overlay mapping is **non-semantic media,
  not an input target.**
- A local input event names: episode/session epoch, displayed document revision, entity/action id,
  local monotonic event time, local frame/display correlation, source type, validity/tracked flags.
- Maintain a sampled **clock mapping** only for cross-host analysis/media scheduling; carry local
  time + server-time estimate + uncertainty/provenance; **never rewrite one clock as the other.**
- Streamed stereo units carry a common content/frame id, source render time, target headset display
  time, and **common-source L/R poses/FOV** — this is **fixed / content-camera source metadata,
  never actual Quest display-driving tracking** (§2). **Reject mismatched pairs** for
  interaction-critical composition; degrade to panel/video or last coherent frame with explicit
  stale state. WiVRn's independently-nearest-frame fallback is explicitly rejected.

## 6. Streaming boundary (stated limitation)

Under the absolute no-head-pose-export rule (§2), **workstation-rendered 6DoF immersive 3D is NOT
possible** — a remote renderer needs the display-driving head pose for parallax, and local late-warp
cannot synthesize missing parallax. Streaming is therefore limited to **2D / curved-texture /
fixed-reference-view media**. Real 3D is **native/data-driven** (§3). No future "render-pose export"
path is offered while the absolute holds. WiVRn is an implementation/source donor (OpenXR, audio,
decoder, frame-correlation machinery) behind Soma contracts — we do **not** inherit its
trusted-game-server protocol and do **not** auto-fork; any streaming spike is bounded to this role.

## 7. Authority & consent

- **mTLS** identifies the enrolled device/transport and **grants nothing**; it does **not** prove
  sensor truth, wearer identity, consent, or presence.
- **Lifecycle/presence reports are narrowing-only evidence.** Focus/presence/device-health reports
  from the Quest may **narrow or close** a lease and explain lifecycle; a positive report may
  **never widen or open consent, and never identify the wearer.** They are session-integrity
  evidence, not consent.
- Soma issues a **short-lived episode/session lease**: exact capability keys, constraints,
  audience/destination, expiry, grant ids. The client enforces the same narrowing (defense in
  depth); **Soma remains authority.** Effective modality = runtime support ∩ provider support ∩
  exact active grant ∩ episode allowlist ∩ focus/presence/lifecycle conditions.
- Per-surface metadata (owner, audience, content class, action bindings, TTL, lease/grant refs) is
  **enforcement/audit context, not per-surface approval ceremony.**

### 7.1 Capability inventory (logical; final names align with the capability-matrix migration)

Source access and downstream use are **separate** keys. At minimum:

- **session bind/control** — protocol function; not wearer authority by itself.
- **surface/text/image/mesh presentation** — with resource-class constraints.
- **wearer-directed audio presentation** (see §7.2 on "wearer-directed", not "private").
- **microphone capture/uplink.**
- **microphone-derived local transcription / model attachment / inference** — **separate from
  capture**, following Soma's "subscription does not authorize model delivery" rule.
- **semantic controller input**; **semantic hand input**; **semantic gaze input** — each distinct.
- **raw controller pose/trajectory**, **raw hand joints**, **raw gaze ray** — distinct higher-risk
  *future* streams, each separately granted.
- **video/media presentation**, and **interactive-stream semantic events** as separate reach from
  non-interactive media.
- **haptics output.**
- **episode-local anchor resolve/create** and **durable anchor persistence** — separate *future*
  authorities.
- **remote-model delivery, persistence, external egress** — **Soma sink authorities, not implied
  Quest modality keys.**

There is **no** raw display head-pose capability (§2). Focus/presence/health reporting is
narrowing-only session-integrity evidence, never consent.

### 7.2 Microphone ruling (preserved from reframe §3D) and "wearer-directed" audio

- **"Private audio" is incorrect.** Threshold proves **audibility**, not acoustic privacy; Quest
  speakers may be audible to others. Use **wearer-directed local audio** unless a private transducer
  is independently verified.
- The ruled voice+panel episode's **microphone-derived information IS delivered to a LOCAL model** —
  a sink — under **Seth's explicit operator risk acceptance + minimization**, which is *not*
  bystander consent. The ruling covers the **bounded wearer-directed voice/panel response**;
  **remote model delivery, persistence, egress, and outward actions remain excluded/floored**, and
  **derived products inherit the source class.**
- **Minimization is an obligation, not decoration:** armed window; local mute/resume; bounded
  capture (VAD / push-to-talk where appropriate); **no retention**; **local-only model destination.**

### 7.3 W-arc reuse — precise scoping (verified against live Soma code)

Reuse the **ratified pattern**: operator-only arm, explicit TTL (clamped 1s..24h, default 1h),
instant disarm, runtime scope (no durability), sink-time re-evaluation, restart-closes-all-windows.
**Do NOT reuse the existing `/model-visual/floor/*` API to govern Quest** — that API is specifically
a *raw-Sensorium-frame → remote-model-egress* floor with the four-fact solo gate (`seth_present`,
`seth_consented`, `active_control`, `no_other_person_in_frame`) re-evaluated per attachment
(`decideRawFrameVisionFloorGate`). Quest needs its **own** session capability leases + lifecycle
floor. **The four-fact solo gate applies ONLY to Quest modalities crossing the same raw-visual /
bystander sink** (passthrough camera frames, raw perception export to a remote model). **Wearer-
directed audio out and semantic controller input do NOT inherit `no_other_person_in_frame`
ceremony** without a concrete sink risk.

## 8. Disconnect / recovery / focus

- **FOCUSED is a hard validity precondition.** Deliver no capability content/input/output while
  VISIBLE-but-not-FOCUSED. This does **not** forbid the single bounded `focus_lost`/suspend
  lifecycle report needed to close the remote side (narrowing-only, §7).
- **On focus loss:** stop the mic and **all** capability content/input/output immediately; allow
  only minimal **non-authorizing** lifecycle/transport teardown; continue the OpenXR lifecycle calls
  the runtime requires.
- Fail to a local explicit **offline/suspended shell**; clear session resources + sensitive cache on
  lease expiry/revoke/disconnect.
- **No sensitive auto-resume.** Re-don alone **never** resumes; require **both** a fresh Soma
  lease/epoch **and** a deliberate local unmute/resume action. (Re-don may auto-unmute at the OS
  layer, so the client holds a separate **mic-off latch**.)
- Bounded retries only for idempotent control/resource fetch; **no blind replay** of voice, actions,
  haptics, or model output. The headset always retains a **local stop/mute affordance independent of
  workstation reachability.**

## 9. Provider / family naming

A **distinct Soma provider/family** (e.g. `interaction.quest.surface.*` / `soma.provider.quest-client`),
aligned with the capability-matrix migration. Do **not** stretch `desktop.remote_graphical` or the
Sensorium families — desktop observation/input authority must not leak into native spatial surfaces.

## 10. V1 — one approved milestone, two implementation increments

One human-approved v1 milestone (no extra ceremonial gates), staged:

- **v1a — panel session:** native shell + mTLS/session epoch + lease consumption + one snapshot
  panel + deterministic bounds ack + focus/presence suspend/offline/reconnect behavior, exercised
  against a Soma fixture/provider. No audio, no input beyond lifecycle.
- **v1b — ruled voice+panel episode:** add bounded **PCM I16 / 48 kHz** mic uplink + **wearer-
  directed** playback + local inference/answer + mic latch/minimization + full cleanup. Acceptance:
  **headset-on → ask → voice+panel answer → headset-off → nothing persists.**

Scope excludes hands, gaze, scene, camera/depth, body/face, persistence, and any external
(non-local) model.

### 10.1 V1 control/audio wire contract

This is the **v1 control/audio** envelope. Bulk content resources (images/meshes) exceeding the
message cap use a **deferred bounded content-chunk contract** — not needed for v1, which presents
only the ruled panel. Numeric bounds marked *(initial)* are tunable with measurement; the
**semantics** are committed.

**Message envelope:** `version` (u16), `type` (enum), `session_epoch` (u64), `stream_id` (u32),
`direction` (enum: uplink/downlink, or type-derived), `lease_ref` (id — **see binding below**),
`seq` (u64), `send_ts_ns` (i64, local monotonic — **observational/correlation only**), `payload_len`
(u32, bounded), `payload`. Max message size 64 KiB *(initial)*.

**Lease binding (bootstrap/narrowing exception):** `lease_ref` is **required** for all capability
content / audio / action messages. It is **optional only** for an enumerated pre-authority /
narrowing control set: `HELLO`, version negotiation, `FOCUS_LOST`/suspend, teardown ack, error.
**An unleased message may only establish transport or narrow/close — never present, capture, or
widen.**

**Version negotiation:** `HELLO` advertises a supported version **range/set**; both sides select the
**highest mutually supported compatible** version; no overlap closes the session.

**Encoding (measured, not assumed):**
- **Mic uplink:** PCM S16LE, 48 kHz, **mono**.
- **Wearer-directed playback:** PCM S16LE, 48 kHz, **stereo (2-channel)** — Threshold verified
  2-channel output.
- Packetization: 20 ms *(initial)* = **960 audio frames per channel** → uplink 960 mono samples =
  1920 B; playback 960 frames × 2 interleaved = 1920 samples = 3840 B. Hard cap ≤ 40 ms per packet.

**Sequence / replay / binding:** `seq` is monotonic per **(session_epoch, stream_id, direction)**.
The receiver drops any `seq` ≤ last-seen (**no replay**) and tolerates gaps (audio is real-time:
drop, do not wait). Any packet with a wrong `session_epoch` or an expired/absent *required*
`lease_ref` is rejected and tears down **that** stream.

**Queues / backpressure:** finite jitter buffers, ≤ 200 ms *(initial)*, **drop-oldest** under
overflow in both directions — latency is never traded for completeness (perception-latency
invariant). The capture callback never blocks: if the uplink send queue exceeds bound, the client
drops the oldest queued frame.

**Utterance state machine (per stream):** `UTTERANCE_START{utterance_id}` → `AUDIO_CHUNK*` →
`UTTERANCE_END`; `CANCEL{utterance_id}` flushes and stops **only its named stream/utterance**.
Stopping unrelated playback (barge-in) is an **explicit policy/action**, never an accidental
consequence of cancelling capture. Mic-capture control and playback-response control are separate
streams.

**Revocation is synchronous server-side.** On revoke / lease expiry / focus-close / transport loss,
Soma removes authority and marks the stream closed **immediately**; the client also stops locally
immediately. A missing client teardown ack can **never** extend a lease or keep a stream authorizing
during any timeout — the teardown-ack timeout governs only cleanup **reporting/reconciliation**, not
authority. On focus loss / revoke / disconnect the client stops capture, flushes, stops playback,
sends one narrowing `FOCUS_LOST`/suspend report (§8), and does **not** replay.

**Timestamps:** capture `send_ts_ns` is observational/correlation only; **playback timestamps are
NOT a scheduling guarantee** in v1 (best-effort playout) — a scheduled-presentation path would have
to be proven separately.

The concrete transport library (WebSocket / HTTP2 / QUIC) remains a short implementation spike; the
wire semantics above do not.

### 10.2 Acceptance criteria (proportional, incl. negative cases)

- **v1a:** panel renders at the intended pose with returned actual bounds; snapshot revision/hash
  honored. Negatives that must be handled cleanly: **wrong/stale lease**, **wrong epoch/revision**,
  **oversized/mismatched asset**, **focus/presence loss → suspend**, **disconnect → offline shell**,
  **no-Soma recovery**, **re-don → no auto-resume**.
- **v1b:** the on→ask→answer→off→nothing-persists path succeeds; **mic stop on focus loss/disconnect
  is immediate**; **no sensitive auto-resume**; **no persistence/retention**; local model
  destination only. Minimization mechanism for v1 (chosen, not implied): **armed episode window +
  VAD + an independent local mute latch.** Push-to-talk is an optional later mode requiring an
  authorized input surface (v1 has no controller/hand/gaze input); PTT does not itself establish
  consent in either case.

## 11. Sequencing after v1

1. Semantic controller input (semantic events only).
2. A **bounded** WiVRn-derived streaming/correlation spike — bounded to the §6 content role, never
   inheriting game-stream semantics.
3. Hands / gaze / spatial anchors as **separate capability slices** — not a generic `tracking=true`
   switch. The first anchor slice, when introduced, is episode-scoped/local + generation-tagged
   (v1 excludes anchors, §10/§14); durable/spatial persistence is a separate grant.

## 12. Threshold-lane prerequisites (measurement, not the client)

- **Probe: max simultaneous composition layers + behavior at the cap** — backend-planner *policy*
  input; **not** a prerequisite for the semantic multi-surface contract.
- **Confirm the native voice+panel app builds/deploys/reaches FOCUSED**, extending the
  `user-presence` probe (the 8 build traps + Shell-recovery are already documented in
  `Threshold/docs/dev/quest-native-toolchain.md`).

## 13. Open items for later resolution

- Exact capability-key vocabulary (capability-matrix migration owns final names).
- Precise lease schema (fields, signing, refresh).
- The v1 layout constraint language — kept **minimal** (absolute/anchored poses; constraint solving
  deferred; hybrid: Soma authors intent, Quest resolves deterministically and returns actual bounds).
- The workstation content validation/scan pipeline (egress authority; URL/asset dereferencing never
  on Quest).

## 14. Non-goals / explicit limitations

- No workstation-rendered 6DoF immersive 3D (§6); no future render-pose export while the absolute
  holds.
- No agent-supplied executable code or shader binaries on Quest (no arbitrary programs, no raw GPU
  shader code, no HTML/WebView, no URL/path dereference). The finite render IR, the constrained
  material graph, and any negotiated local generator are interpreted **only through vetted, total,
  resource-bounded operators** (§3) — which **reduces but does not erase** parser/renderer/driver
  risk.
- Construction is **open-ended within a versioned vocabulary + render/comfort bounds**, not unlimited
  simultaneous complexity; over budget the client degrades density/fidelity, never the vocabulary (§3).
- No arbitrary low-latency **interaction logic** on the device — rich local behavior only via vetted
  bounded state/constraint primitives; open-ended reasoning stays on Soma (and incurs network latency).
- The agent cannot command unsafe luminance/flicker/full-field-motion/near-eye geometry, hide the
  local stop, or suppress the runtime guardian/boundary (§3).
- No durable/spatial persistence in v1; no perception (camera/scene/body/face) in v1.
- No remote (non-local) model destination for v1 mic-derived data.
- The client is **not** authority — it enforces leases as defense in depth, and its lifecycle
  reports can only narrow, never widen, authority.

# Sensorium Integration

Status: draft concept

Sensorium is a separately-developed local-first sensor node that publishes raw
sensory streams (color video, depth, accel, gyro, status, location) over a
Zenoh pub/sub fabric. The first deployed instance runs on an NVIDIA Jetson
Orin Nano with an Intel RealSense D435i. Sensorium is consumer-agnostic by
design — its repository explicitly states "Sensorium publishes raw streams;
it does not interpret" — so Soma's role as a consumer is to decide what
preprocessing the agent finds useful and to author that preprocessing inside
its own governed model.

This draft positions Sensorium inside Soma's vocabulary: as an external
sensor-stream provider, with each published topic mapping to a Soma
capability that flows through the same policy gateway, grant store, and
provenance pipeline as every other restricted-class power.

## Why A Separate Doc

Soma already names "perception" in [Local AI Service
Plane](./local_ai_service_plane.md) and treats camera/microphone access as
Restricted in [Adaptable Harness](./adaptable_harness.md). What's missing is
the bridge between those high-level commitments and a concrete external
source of sensory streams that already exists and ships. This doc records
that bridge so future capability work on the Soma side can target the
existing contract rather than rediscover it.

It also captures one design decision that emerged from Sensorium's
development and should be load-bearing here: **the consumer dictates the
shape of preprocessing**. Sensorium does not run YOLO, does not produce
captions, does not segment, does not interpret. Soma — with its multimodal
foundation model (Gemma 4 E2B/E4B native vision/audio/video) — does the
interpretation. Anything in between is either a Soma capability (authored
by the agent under a grant) or it does not exist.

## Implementation Discipline

Two existing Soma docs are load-bearing for any work that lands from this
draft and should be re-read before implementation:

- [`implementation_guide.md`](../../implementation_guide.md) —
  particularly the Disabled-First Capability Pattern. Sensorium
  subscription is a Restricted-class perception capability; the
  nine-step disabled-first sequence applies in full. The first concrete
  slice is *not* a working subscriber — it is contract, validators,
  fixtures marked non-active, overreach tests, and provenance shape,
  with the public path fail-closed.
- [`desktop_helper_transport.md`](./desktop_helper_transport.md) —
  the existing answer to "when does Soma move past one-shot stdio to
  a long-lived helper?" One of its explicit migration triggers is
  *"visual perception streams or portal sessions need a long-lived
  handle."* Sensorium subscription matches that trigger exactly, so
  the transport question is pre-decided: JSON-RPC over stdio or a
  Unix socket, with a Rust helper, Node remaining the policy
  authority. Sensorium integration should not invent a new transport
  pattern.

## Sensorium In Soma's Vocabulary

| Soma concept | Sensorium analogue |
|---|---|
| Provider | A running Sensorium node on a known host, advertising stream topics |
| Capability | "Subscribe to live sensor topic X under scope Y with constraints Z" |
| Grant | User-approved authority for Soma to subscribe to a specific topic |
| Scope | once / session / persistent — same semantics as other capabilities |
| Provenance | Subscription start, frame counts, schema version, revocation |
| Disclosure | Active-mode indicator that Soma is currently consuming sensor X |
| Risk class | Camera and depth = Restricted; IMU/status/location = Sensitive |

Sensorium itself does not need to be aware of Soma's vocabulary. Soma reads
the published topics and applies its own governance to what gets consumed.
This is consistent with [Capability Catalog and
Providers](./capability_catalog_and_providers.md): a provider may advertise
capability; only the harness may grant authority.

## Topics And Capability Mapping

Sensorium publishes on a fixed namespace, hostname-scoped:

```text
sensor/<host>/realsense/color        # JPEG color frames
sensor/<host>/realsense/depth        # PNG 16-bit depth frames
sensor/<host>/realsense/imu/accel    # msgpack accelerometer samples
sensor/<host>/realsense/imu/gyro     # msgpack gyroscope samples
sensor/<host>/status                 # heartbeat + identity + stream list
sensor/<host>/location               # static lat/lon/alt + site
```

A first-pass capability mapping for the Soma side:

| Capability key | Risk class | Default | Notes |
|---|---|---|---|
| `perception.sensorium.color.subscribe` | restricted | disabled | Camera access; grant per host |
| `perception.sensorium.depth.subscribe` | restricted | disabled | Camera-class (spatial scene data) |
| `perception.sensorium.imu.subscribe` | sensitive | disabled | Motion, not identifying |
| `perception.sensorium.status.subscribe` | low | requestable | Liveness + topic discovery only |
| `perception.sensorium.location.subscribe` | sensitive | disabled | Static geo position |

The status topic is the lightest-risk subscription and the most useful
discovery surface — its payload includes the `enabled_streams` list, so a
Soma capability authoring agent can introspect what's available on a given
host without enumerating the topic namespace.

Camera-class capabilities (color, depth) should follow the existing
Restricted treatment: explicit assent, scoped grant, active-mode
disclosure, reversible drop. IMU and location are lower-risk but still
require a grant — neither is implicitly authorized by base harness.

## Provider Manifest Sketch

A Sensorium provider entry in Soma's provider registry might look like:

```json
{
  "id": "soma.provider.sensorium.jetsorano",
  "name": "Sensorium node on jetsorano",
  "version": "0.1.0",
  "runtime": "external-zenoh-publisher",
  "endpoint": {
    "transport": "zenoh-peer",
    "scout_address": "224.0.0.224:7446",
    "host_hint": "jetsorano.local.sthnet.org",
    "host_segment": "jetsorano"
  },
  "capabilities": [
    "perception.sensorium.color.subscribe",
    "perception.sensorium.depth.subscribe",
    "perception.sensorium.imu.subscribe",
    "perception.sensorium.status.subscribe",
    "perception.sensorium.location.subscribe"
  ],
  "local_only": true,
  "network_access": true,
  "network_scope": "lan-multicast",
  "requires": [
    "zenoh-client-1.x"
  ],
  "schema_versions": {
    "color_frame": 1,
    "depth_frame": 1,
    "imu_sample": 1,
    "location": 1,
    "status": 1
  },
  "canonical_types_at": "https://github.com/sherndon79/Sensorium/blob/main/crates/sensorium-core/src/lib.rs"
}
```

Two notes on shape:

- `host_segment` matches Sensorium's hostname-scoped topic namespace. A
  single provider entry corresponds to one Sensorium instance on one host;
  multi-host deployments register one provider per host.
- `schema_versions` records the expected payload versions at the time the
  manifest was written. The Soma subscriber should compare against the
  `schema_version` field in each received payload (see Schema Handshake
  below).

## Subscription Invocation Contract

Subscription is long-lived state — the helper that owns the Zenoh session
needs to stay running across many delivered frames, expose start/stop
control, and surface per-subscription health back to Node. This is the
case the [Desktop Helper Transport
draft](./desktop_helper_transport.md#migration-triggers) names as a
trigger for moving past one-shot stdio. Sensorium integration uses the
long-lived-helper path: a Rust sensor-broker process owns the Zenoh
client and exposes JSON-RPC-style methods over stdio or a Unix socket
(`sensorium.subscribe.start`, `sensorium.subscribe.stop`,
`sensorium.subscribe.status`, etc.); Node remains the policy authority,
validates requests, schema-checks results, and records provenance.

After policy clears a subscription grant, the actual subscribe call should
be bounded the same way other invocations are:

```json
{
  "invocation_id": "inv-456",
  "capability": "perception.sensorium.color.subscribe",
  "provider": "soma.provider.sensorium.jetsorano",
  "scope": "session",
  "constraints": {
    "max_fps": 5,
    "max_seconds": 600,
    "downsample_to": [384, 384],
    "format_required": "jpeg",
    "depth_aware": false
  },
  "request": {
    "topic": "sensor/jetsorano/realsense/color"
  },
  "provenance_context": {
    "caller_identity": "capability.agent_authored.scene_describer",
    "reason": "Driving the visual context channel for the active task.",
    "grant_id": "grant-456"
  }
}
```

The constraints field is where consumer-shape preprocessing gets specified.
A few that matter for the camera path:

- `max_fps` — Soma capabilities almost never need 30 fps. Throttling at
  the subscriber edge keeps the model's input within budget.
- `max_seconds` — bounded session length matches Soma's scoping model.
- `downsample_to` — frame size at the Soma-side decoder before handing
  to the model. Gemma's vision encoder has fixed input resolution; sending
  full-res frames is wasted decoding.
- `format_required` — pin the expected encoding; reject if Sensorium
  starts publishing something else.

These are subscriber-side knobs. Sensorium itself doesn't enforce or even
see them — it publishes once, all subscribers receive. The constraints
live inside the Soma capability code that wraps the subscription.

## Grant Review Surface

Sensorium grants should start as session-only grants. Durable perception
grants should wait until Soma has a stronger user-facing review surface,
active-mode disclosure, and revocation UX. A live camera or location stream
is too easy to normalize into ambient sensing if the first durable path is
implemented before the participant can inspect and revoke it comfortably.

The first review surface for any Sensorium grant should show:

- **Host**: the provider id and hostname-scoped segment, for example
  `soma.provider.sensorium.jetsorano` and `sensor/jetsorano/...`
- **Topic namespace**: the exact topic or topic family being authorized,
  such as `sensor/jetsorano/realsense/color`
- **Capability key**: the exact `perception.sensorium.*.subscribe`
  capability, not a bundled "Sensorium access" grant
- **Stream type**: color, depth, IMU, location, or status
- **Risk class**: restricted for color/depth, sensitive for IMU/location,
  low or requestable for status
- **Scope**: initially `session`; durable grants require a separate future
  review decision
- **Maximum duration**: `max_seconds`, with an explanation that the
  subscription ends or must be renewed after that bound
- **Maximum frame rate**: `max_fps` for video-like streams
- **Encoding**: `format_required`, such as `jpeg` for color or `png` for
  depth
- **Downsample bounds**: the maximum `[width, height]` allowed before frames
  are handed to the consumer
- **Recording posture**: currently no frame recording by default
- **Model-boundary warning**: frames already incorporated into a model turn
  cannot be withdrawn from that turn's working context
- **Active disclosure text**: the exact summary that will be visible while
  the stream is active
- **Revocation affordance**: how the participant stops the stream and what
  revocation does immediately
- **Provenance posture**: lifecycle metadata and aggregate counters are
  recorded; frame payloads and coordinates are not recorded by default

A proposed review summary might read:

```text
Allow Soma to receive color frames from Sensorium node jetsorano for this session.
Topic: sensor/jetsorano/realsense/color
Limits: up to 5 fps, up to 10 minutes, JPEG, downsampled no larger than 384x384.
Frames are not recorded. The live subscription can be revoked, but frames already
used in a model turn cannot be removed from that turn's reasoning.
Disclosure while active: "perception via Sensorium: color frames from jetsorano,
5 fps max, expires in 10 minutes."
```

Sensorium grant creation should map onto the existing grant lifecycle:

- proposal approval records intent only
- provider installation does not grant authority
- grant creation requires exact capability, provider, scope, constraints,
  reason, approval provenance, and a visible revocation affordance
- grant creation remains separate from subscription activation
- active subscription still requires the runtime request to pass topic,
  provider, host, and constraint enforcement

Durable Sensorium grants, when they are eventually considered, should require
stronger review than session grants:

- a named retention/review interval
- recurring active disclosure
- prominent revocation in the operator surface
- no automatic carryover across provider host changes
- no automatic carryover across topic namespace or stream schema changes
- no default remote routing of consumed perception

Migration rules for Sensorium grants should fail closed:

- provider id or `host_segment` changes require review
- topic namespace changes require review
- capability split/merge does not silently preserve authority
- stream schema version changes require review before interpretation
- risk-class increases require review
- missing or malformed grant constraints make the grant inactive until
  reviewed

### Non-Writing Proposal Template

`src/sensoriumGrantProposalTemplate.js` provides the first implementation
surface for preparing Sensorium grant review records. It is intentionally
non-writing:

- it does not create grants
- it does not add Sensorium grants to `config/grants.json`
- it does not approve proposals
- it does not activate subscriptions
- it emits `activation_performed: false`, `durable: false`, and
  `writable: false`

The template validates a proposed Sensorium grant against the capability
catalog, provider registry, topic shape, provider host segment, requested
scope, and required constraints. Current templates require `session` scope.

The output has three parts:

- `proposal`: current proposal-compatible fields such as `capability`,
  `reason`, `requested_scope`, `data_exposed`, `excluded_data`, `risk`, and
  `fallback`
- `review`: user-facing review fields including provider, host segment,
  topic, stream type, risk class, duration, FPS where applicable, encoding
  where applicable, downsample bounds where applicable, active disclosure,
  revocation behavior, recording posture, model-boundary warning, and
  provenance posture
- `grant_intent`: the exact future grant inputs that would still require
  explicit user approval before becoming authority

This keeps proposal preparation separate from authority creation. A future
route or operator UI may use the template output as the review surface, but
must still preserve the existing lifecycle rule: proposal is not approval,
approval is not grant creation, and grant creation is not activation.

## Schema Handshake

Every Sensorium payload carries `schema_version: u32` as its first field.
The current canonical values (all 1 at time of writing):

- `COLOR_FRAME_SCHEMA_VERSION`
- `DEPTH_FRAME_SCHEMA_VERSION`
- `IMU_SAMPLE_SCHEMA_VERSION`
- `LOCATION_SCHEMA_VERSION`
- `STATUS_SCHEMA_VERSION`

Sensorium's documented versioning policy (in its `AGENTS.md`):

- Bump on breaking changes (removed/renamed/type-changed fields)
- Do not bump on additive changes (new fields with serde defaults are
  silently ignored by rmp-serde on the decode side)

The Soma side should:

- Pin the expected version in the provider manifest (or in the capability
  definition, depending on where versioning is most useful to track)
- On each received payload, compare `payload.schema_version` to the
  expected version
- On mismatch, fail closed: stop consuming and surface a provider-error
  state. Do not attempt to interpret a payload from an unknown future
  schema as if it were the known one.

This is symmetric with Soma's own discipline: ambiguous authority state
should fail closed, not silently muddle through.

## Consumer-Shaped Preprocessing

The boundary decision that shaped both Sensorium's narrowed scope and the
shape of this doc:

**Sensorium publishes raw streams. Preprocessing is consumer-defined and
lives in Soma as agent-authored capabilities.**

The reasoning is recorded in Sensorium's `ROADMAP.md` Phase 4 entry and
its `AGENTS.md`. The short form: the consumer (Soma + Gemma 4) handles
vision/audio/video natively. Anything Sensorium did to interpret would
either duplicate the agent's own analysis or impose a preprocessing shape
the agent didn't choose. So Sensorium does neither.

What this implies on Soma's side:

- A first capability might be a thin "frame router" that throttles color
  to a few fps and downsamples to Gemma's input size, then exposes the
  result as a derived topic on the local fabric or a direct in-process
  channel.
- A second capability might gate on motion-detected events, producing
  short clips to feed Gemma's video path rather than continuous frames.
- A third might extract a depth-cropped foreground region around a
  detected subject and pair it with the color frame.

None of these are required up front. None of them should be designed
before the agent's actual usage of the raw streams reveals what's
worth materializing. The discipline is "ensure the glove fits": let
observed need pull capabilities into existence, rather than guessing.

Each such capability is its own catalog entry, its own grant, its own
disclosure. They subscribe to Sensorium topics with declared constraints
and publish derived signals on a separate namespace (Soma can decide
whether that's `perception/<host>/...` for re-broadcast on the fabric,
or kept in-process for capabilities that consume directly).

## Irreversibility At The Model Boundary

Sensorium subscriptions are reversible at the wire — stop the helper,
drop the grant, the frame flow stops. But once a frame has been pushed
into the foundation model's context for a turn, the model has reasoned
with it; that turn's reasoning cannot be retroactively unframed. This
is true for any perception-class capability whose output flows into
the agent's working context.

Soma's reversibility principle reads "prefer reversible actions;
disclose when an action cannot be fully undone." For perception
capabilities, the honest disclosure is:

- The *subscription* is reversible: it can be paused, narrowed, or
  revoked at any time and Sensorium stops being asked for frames.
- The *consumption* by the model is one-way at the model boundary:
  frames already incorporated into a turn's reasoning cannot be
  withdrawn from the model's working context.

Active-mode disclosure for perception capabilities should reflect
both: "Receiving X" describes the reversible part; the model's
already-reasoned-on context is the irreversible part. The capability
catalog entry's `reversible` field should be `false` for camera-class
perception precisely because of the model-boundary asymmetry, even
though the subscription mechanism itself is straightforward to stop.

This isn't a Sensorium-side concern (Sensorium doesn't know what its
consumers do with frames). It's a Soma-side discipline for any
capability that pipes external signal into the model.

## Location Handling

The location publisher is sensitive in ways that color/depth frames
are not. A color frame from a room is contextual; a lat/lon/alt with
a site name is *identifying* — it places the participant geographically
in a way that crosses several Soma principles simultaneously
(non-extraction, memory boundaries, remote-routing disclosure).

The discipline for location subscription:

- **Never flows to remote routing without explicit consent.** Even if
  the participant has approved a remote-model call for the current
  task, location should not ride along in the request context by
  default. A separate, explicit grant is required for location to
  cross the local boundary.
- **Provenance records the consumption shape, not the coordinates.**
  Logs should record that a `Location` payload was consumed at a
  given time under a given grant; they should not re-record the
  lat/lon/alt itself unless the capability explicitly authorizes that
  and the operator surface makes the retention clear.
- **Memory writes need explicit scope.** Soma's memory service may
  store "the agent knows it is at site X" only under a grant that
  names location-class data; the implicit memory-of-context path
  shouldn't pick up coordinates by accident.
- **Active-mode disclosure names the location class even when the
  coordinates are absent.** A participant who has approved a `site`-only
  subscription (no lat/lon) should still see "location: site name"
  in the disclosure surface so the channel's presence is visible.

The location publisher itself emits identity-only samples when no
coordinates are configured (Sensorium's deliberate fallback). Soma
should still treat the *capability* as Sensitive even in identity-only
mode, because the field shape is the same and the channel can be
upgraded later without a code change on the consumer side.

## Disclosure

Active subscription should appear in Soma's active-mode disclosure
surface the same way other restricted-class active capabilities do:

- "Soma is currently receiving color frames from `jetsorano` at 5 fps,
  this session, expires in 8 minutes."
- "Soma is currently receiving accel + gyro samples from `jetsorano`,
  this session, expires in 8 minutes."

Disclosure should ideally be grouped at the family level for
comprehension ("perception via Sensorium: 4 streams active") with
expandable detail per the [Capability Catalog
draft](./capability_catalog_and_providers.md#transparency-without-overload).

Frame counts and rough throughput visible in the disclosure surface help
the participant notice when a capability is consuming more than expected.

## Provenance Notes

Sensorium-side payloads include `timestamp` (unix seconds), `frame_number`
(monotonic device counter), and where applicable `depth_units` (meters
per sample). The Soma-side provenance log doesn't need to record every
frame, but it should record:

- subscription start (capability, provider, scope, grant, declared
  constraints)
- subscription end (clean stop, timeout, revocation, error)
- aggregate counters (frames consumed, average fps, schema_version
  observed, any schema mismatches)
- the *first* and *last* frame's `frame_number` and `timestamp` if useful
  for correlation

This is the same discipline as [Provider Invocation
Contract](./capability_catalog_and_providers.md#provider-invocation-contract):
provenance records the shape of consumption, not the consumed content.

## Open Questions

- **Where do agent-authored preprocessing capabilities run?** In the Soma
  Node service plane as JS modules? In a separate Soma-authored Rust
  worker? Both, with a contract between them? The answer probably depends
  on whether the capability needs to touch the model directly or just
  transform bytes.
- **Per-host vs cross-host provider semantics.** If multiple Sensorium
  instances appear on the fabric (a Jetson in one room, a NUC in another),
  is each a separate provider entry, or one provider with multiple
  hosts? The current sketch favors one-per-host (matches Sensorium's
  hostname-scoped topic model), but the grant UX may benefit from
  grouping.
- **Audio.** Sensorium currently has no audio crate. A future
  `sensorium-audio` would publish on `sensor/<host>/audio/...` (probably
  Opus or raw PCM). Gemma 4's native audio path makes this potentially
  the highest-utility addition. Should Soma-side capability work
  anticipate this, or wait until the producer ships?
- **~~Trust boundary on a multi-host LAN.~~ Resolved (substrate auth).**
  Earlier draft framed this as a Soma-side identity-verification problem
  to solve. Sensorium's Phase 5d (substrate-level access control on the
  Zenoh transport: `usrpwd` + TLS + ACLs, each a separate slice)
  provides the answer: only authenticated peers can join the fabric at
  all, ACLs restrict each authenticated peer to its declared
  publish/subscribe rights, TLS prevents passive observers from
  reading authenticated traffic. Soma's provider registry pins the
  expected credential (via `credentials_ref`) so a peer claiming to be
  a known Sensorium without the configured credential is rejected at
  the Zenoh layer before any Soma-side code sees the traffic. This is
  the consistent application of the "eye doesn't gate; substrate does;
  brain discerns" principle from Sensorium's `AGENTS.md`.
- **Schema-version pinning location.** Better placed in provider manifest
  or in capability definition? Provider manifest is more accurate (the
  provider produces the payload); capability definition is more useful at
  policy-check time. May want both, with the catalog declaring "this
  capability requires schema_version 1" and the provider manifest
  asserting "I produce schema_version 1."
- **Whether `perception/<host>/...` belongs to Soma or stays unused.**
  Sensorium reserved that namespace for downstream consumers but doesn't
  own it. If Soma capabilities re-broadcast derived signals, that's the
  natural place; if all Soma preprocessing stays in-process, the
  namespace can stay empty.

## Non-Goals

- **No Sensorium-side interpretation.** This integration is one-way:
  Soma is a consumer of Sensorium's raw streams. We do not push
  preprocessing back into the Sensorium repo, and we do not ask
  Sensorium to know about Soma's policy model.
- **No bypass of the policy gateway.** Subscribing to a Sensorium topic
  must flow through the same grant, scope, and provenance pipeline as
  any other restricted-class capability. Zenoh's open-fabric discovery
  is not authority.
- **No standing perpetual subscription as a base-harness default.** Even
  the lowest-risk topic (status) should be requestable, not automatic.
  The base harness does not assume the existence of any Sensorium
  instance.
- **No silent schema drift.** Pre-version Sensorium payloads (no
  `schema_version` field) must be refused at decode time, not coerced
  into the known shape.

## Related

- Sensorium repository: https://github.com/sherndon79/Sensorium (the
  canonical payload type definitions live in `crates/sensorium-core/src/lib.rs`;
  the topic-key constructors in the same file are the authoritative source
  for topic names)
- [Implementation Guide](../../implementation_guide.md) — Disabled-First
  Capability Pattern, authority boundary, validation-before-execution,
  provenance minimization. Load-bearing for the first-slice shape.
- [Desktop Helper Transport](./desktop_helper_transport.md) — pre-decided
  transport shape for long-lived helpers; explicit migration trigger for
  perception streams
- [Adaptable Harness](./adaptable_harness.md) — risk classes,
  unilateral narrowing / mutual widening, restricted treatment for
  perception-class capabilities
- [Capability Catalog and Providers](./capability_catalog_and_providers.md)
  — the catalog/provider/grant separation this draft maps Sensorium onto
- [Local AI Service Plane](./local_ai_service_plane.md) — where
  perception sits in Soma's service-plane sketch
- [Capability Proposals](./capability_proposals.md) — the proposal flow
  agent-authored preprocessing capabilities would enter through

## Current Implementation Status

Sensorium is shipping as a separate node (Phase 3 publishers complete,
Phase 5 hardening mostly complete, payload versioning live). Soma now has
the first integration path implemented through the disabled-first sequence
from the Implementation Guide.

Completed Soma-side slices:

1. Capability catalog entries for each Sensorium topic with
   `default_status: "disabled"` and `activation_policy: "explicit_grant"`.
   Lowest-risk (status) and Restricted (color, depth) all enter the
   catalog at the same time, all disabled.
2. Provider registry entry for the local Sensorium instance, declared
   non-active. Records the hostname-scoped topic namespace and the
   pinned `schema_versions` block but does not authorize anything.
3. Request-shape validators in the Node service plane that recognize
   `perception.sensorium.*.subscribe` capability keys and refuse them
   (no active grant, no helper) with stable error codes.
4. Overreach tests proving that requests with broader-than-declared
   constraints, unknown topic names, or future-shaped payloads are
   rejected before any helper is reached.
5. Provenance summary shape designed for subscription lifecycle
   (start/stop/error, counters, schema_version observed, schema
   mismatches) without recording frame content.
6. Disclosure surfaces ready: `GET /capability-view` shows the new
   capability keys as `requestable` (status) or `unsupported`/`forbidden`
   (camera) until grants exist; active-subscription disclosure shape
   sketched even though nothing can yet activate.
7. Rust sensor-broker scaffold built behind tests — JSON-RPC method
   support for `sensorium.subscribe.start` / `.stop` / `.status`.
8. Public capability path remained fail-closed while helper and Node-side
   composition landed behind tests.
9. Activation gates aligned through a Node-side helper manager,
   `SensoriumSubscriber` composition layer, and an HTTP subscription seam:
   `GET /sensorium/subscriptions`, `POST /sensorium/subscriptions`, and
   `DELETE /sensorium/subscriptions/:id`.

The HTTP seam is still fail-closed in the default service posture. If no
`sensoriumSubscriber` is configured, Sensorium routes return
`sensorium_subscriber_not_configured`. If a subscriber is configured but no
active grant authorizes the exact capability, the POST path returns
`sensorium_subscription_no_grant` before the helper is reached.

The route also checks that the active grant's provider exists, supports the
requested Sensorium capability, and matches the hostname-scoped topic
namespace. A grant for `soma.provider.sensorium.jetsorano` does not authorize
`sensor/othernode/...`.

The real `SensorBrokerManager` and `SensoriumSubscriber` are wired into
`src/server.js` only behind an operator-controlled opt-in:
`SOMA_SENSORIUM_ENABLED=1`. The default process continues to start with
Sensorium routes configured off. Operators may override the helper path with
`SOMA_SENSOR_BROKER`.

Active grant constraints now bound subscription requests before the subscriber
is invoked:

- requested `max_seconds` must be no greater than the grant's `max_seconds`
- requested `max_fps` must be no greater than the grant's `max_fps`
- requested `format_required` must match the grant's `format_required`
- requested `downsample_to` must fit within the grant's `[width, height]`

If a request omits one of those bounded values and the grant declares it, Soma
copies the grant value into the bounded request sent to the subscriber. If a
request includes a bounded key that the active grant does not declare, Soma
rejects before helper invocation. This keeps the successful path explicit while
avoiding accidental unbounded subscriptions.

Next implementation work should define how durable Sensorium grants are created
and reviewed. No Sensorium grants ship in `config/grants.json`.

The point of this ordering: a participant should never accidentally
receive sensor frames because someone forgot a check. The public path
stays disabled until *every* path it travels is gated correctly.

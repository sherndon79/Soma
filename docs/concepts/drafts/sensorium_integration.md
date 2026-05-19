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
discovery surface — its payload includes the `enabled_streams` list and
producer-side `stream_profiles`, so a Soma capability authoring agent can
introspect what's available on a given host and compare native color/depth
capture profiles against Soma's delivery bounds without enumerating the topic
namespace.

### Bounded Status Observation

Soma may decode the `sensor/<host>/status` payload after an explicit
`perception.sensorium.status.subscribe` grant because the status payload is
the low-risk discovery contract. The decoded surface is deliberately bounded:

- allowed: `schema_version`, `hostname`, `uptime_seconds`, `node_version`,
  `enabled_streams`, and `stream_profiles`
- excluded: raw `payload_bytes`, payload retention, frame contents, credentials,
  internal Sensorium telemetry, and timestamp persistence
- provenance: `schema_version_observed`, `schema_mismatches`, and the sanitized
  `status_summary_observed` may be recorded
- mismatch handling: malformed status payloads or unexpected status schema
  versions increment `schema_mismatches`; unexpected schema versions may record
  the observed schema number but must not record a status summary

This does not authorize color, depth, IMU, or location decoding. Those streams
need their own contracts before any payload-specific fields enter Soma
disclosure or provenance.

`stream_profiles` is disclosure, not control. Sensorium remains producer-only:
the node publishes its configured native profile, while Soma grants constrain
what a subscriber may consume downstream (`max_fps`, `downsample_to`, and
`format_required`). A status profile such as `realsense/color 1280x720 @ 30fps`
can coexist with a Soma grant allowing only `1fps` and `320x240` delivery.

Camera-class capabilities (color, depth) should follow the existing
Restricted treatment: explicit assent, scoped grant, active-mode
disclosure, reversible drop. IMU and location are lower-risk but still
require a grant — neither is implicitly authorized by base harness.

### Color Stream Contract

The first higher-risk stream contract is color. Sensorium publishes
`ColorFrame` as MessagePack with these fields:

- `schema_version`
- `timestamp`
- `frame_number`
- `width`
- `height`
- `format`
- `data`

Soma's initial color contract is metadata-only. It does not authorize delivery
of image bytes into a model turn and it does not authorize screenshots,
recording, or raw frame retention.

Allowed color summary fields:

- `schema_version`
- `frame_number`
- `width`
- `height`
- `format`
- `payload_size`

Excluded color fields:

- `data`
- `payload_bytes`
- `image_bytes`
- `image_content`
- `screenshot`
- `text_content`
- `raw_frame`
- `timestamp`
- cross-stream fields such as `depth_units`, `uptime_seconds`, and
  `enabled_streams`

The expected color schema version is `1` and the only allowed color format is
`jpeg`. The current color decoder emits only the allowed summary fields above,
rejects content-bearing or cross-stream fields through the stream contract, and
records the metadata summary as `stream_summary_observed` for active disclosure
and end provenance. It does not route image bytes to a model, retain raw frame
content, create screenshots, or perform image preprocessing.

The active `downsample_to` implementation path is specified separately in
[Sensorium Color Minimization Boundary](./sensorium_color_minimization_boundary.md). For color JPEG
subscriptions, `soma-sensor-broker` enforces that boundary before sample payload bytes are serialized
back to Node. The disclosure/provenance path remains metadata-only and still does not deliver image
bytes to model context.

If the helper cannot decode, validate, or transform a stream sample, it emits a bounded
`sensorium.subscription.error` notification with `subscription_id`, `topic`, and `error_class`. Node
copies only a sanitized `error_class` into active disclosure and subscription-ended provenance. It
does not copy malformed payload bytes, original full-resolution frames, helper diagnostics, or
content-bearing error text. Stopping a subscription after such a helper error defaults the end
summary to `termination_reason: "error"`.

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

- `max_fps` — Soma capabilities almost never need 30 fps. The current
  helper applies this at the delivery boundary before serializing sample
  payload bytes back to Node.
- `max_seconds` — bounded session length matches Soma's scoping model.
  `SensoriumSubscriber` schedules a local timeout when this is declared and
  stops the helper subscription with `termination_reason: "timeout"` when the
  bound elapses.
- `downsample_to` — frame size at the Soma-side decoder before handing
  to the model. Gemma's vision encoder has fixed input resolution; sending
  full-res frames is wasted decoding. For color JPEG subscriptions, the helper
  now enforces this before sample bytes are serialized back to Node; model-facing
  visual delivery still remains out of scope.
- `format_required` — pin the expected encoding; reject if Sensorium
  starts publishing something else.

These are subscriber-side knobs. Sensorium itself doesn't enforce or even
see them — it publishes once, all subscribers receive. The constraints
live inside the Soma capability code and bounded helper path that wrap the
subscription.

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

`POST /sensorium/proposal-template` and `soma sensorium proposal-template`
now expose the template for operator inspection. This is a review-only
surface:

- no Sensorium subscriber is required
- no proposal is stored
- no grant is written
- no subscription is activated
- no frame, coordinate, or sample payload is recorded

`POST /sensorium/proposals` and `soma sensorium propose` create a pending
capability proposal from the same validated template. This stores
`review_context` and `grant_intent` metadata on the proposal so the operator
can inspect the exact Sensorium host, topic, risk class, constraints,
disclosure, revocation, and provenance posture before deciding.

This proposal path is still non-activating:

- proposal creation records request intent only
- proposal approval remains non-activating
- no grant is written
- no subscription is activated
- provenance records review metadata only, not sensor payloads

`src/sensoriumGrantCreateCandidate.js` defines the first approved-proposal
bridge, still as a pure function. It can build a validated
`grant_create_input` from an approved Sensorium proposal only when:

- the proposal status and decision are approved
- the approver is the user
- approval provenance exists
- `review_context` and `grant_intent` are present
- capability, provider, scope, topic, and constraints still agree
- scope is `session`
- revocation declares immediate stop behavior
- the topic and constraints still pass Sensorium subscription request
  validation

The candidate includes the exact review topic in `constraints.topic` so grant
creation preserves topic authority. The active subscription route fails closed
when a grant carries `constraints.topic` and the requested topic does not
exactly match it, in addition to provider-host and bounded-constraint checks.

The candidate builder remains non-writing:

- it does not mutate `config/grants.json`
- it does not append to the in-memory grant store
- it does not activate a subscription
- it returns `grant_written: false` and `subscription_activated: false`

`POST /sensorium/grants` and `soma sensorium grant-create proposal-id`
now consume this candidate and append an in-memory session grant after the
proposal has been approved. This is the first Sensorium grant write path, but
it is still not subscription activation:

- the caller must provide `actor: "user"` or `--by user`
- the proposal must already be approved by the user
- approval provenance must exist
- the grant preserves provider, exact topic, and constraints from the
  validated candidate
- `config/grants.json` is not mutated
- no Sensorium subscription is started
- the response returns `activation_performed: false`,
  `subscription_activated: false`, and `file_written: false`

The active subscription route now fails closed when an active grant carries
`constraints.topic` and the requested topic does not exactly match it.

`POST /sensorium/grants/:id/revoke` and
`soma sensorium grant-revoke grant-id --reason text` provide the runtime
revocation path for Sensorium session grants:

- the caller must provide `actor: "user"` or `--by user`
- a participant-facing reason is required
- unknown grants fail closed before any subscription stop attempt
- the in-memory grant is marked `revoked`
- `config/grants.json` is not mutated
- active subscriptions tied to the grant are stopped with termination reason
  `revoked`
- revocation and subscription-ended provenance remain metadata-only
- the response returns `activation_performed: false`,
  `subscription_activated: false`, and `file_written: false`

The CLI exposes the existing subscription routes for operator use:

- `soma sensorium subscribe-start` calls `POST /sensorium/subscriptions`
- `soma sensorium subscriptions` calls `GET /sensorium/subscriptions`
- `soma sensorium subscribe-stop` calls `DELETE /sensorium/subscriptions/:id`

These commands do not create grants. Start requests still require an already
active grant and still pass through route-time provider, topic, exact-topic,
and bounded-constraint enforcement. Disclosure and stop summaries remain
metadata-only. Helper stream failures surface only as sanitized `error_class`
metadata on active disclosure and the eventual subscription end summary. Manual
stop and grant revocation clear any pending `max_seconds` timeout so a stale
timer cannot produce a second stop.

Automatic timeout stops are routed back into the app provenance log through the
subscriber's end-summary callback. The app applies a subscription-summary
allowlist before appending provenance, so callback payloads cannot add
`payload_bytes`, image contents, screenshots, raw frames, or other unexpected
fields. Recent automatic endings can be inspected through the existing bounded
provenance query surface, for example
`/provenance?event_type=perception.sensorium.subscription_ended&limit=5`.

`test/sensoriumCliIntegration.test.js` exercises the CLI command shapes against
`createRequestHandler` instead of a mocked request function. It covers:

- successful start, disclosure, and stop through the handler
- no-active-grant failure
- exact-topic mismatch failure
- grant-constraint failure
- stop-without-id CLI usage failure before HTTP
- payload-free disclosure after the subscription flow

`docs/runbooks/sensorium_live_smoke.md` defines the first real-runtime smoke
workflow. It is manual and opt-in, requires `SOMA_SENSORIUM_ENABLED=1`, starts
from `perception.sensorium.status.subscribe`, and preserves the same
metadata-only posture: no default grants, no recording, and no preprocessing.
Camera-class smoke targets such as color require an additional explicit camera
acknowledgement plus bounded video constraints before the wrapper will start the
subscription. The color smoke path validates `stream_summary_observed` and fails
if content-bearing fields appear.

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
10. Review-only proposal creation surfaces let an operator prepare, store,
    inspect, and approve Sensorium grant proposals without writing runtime or
    durable grants.
11. Approved proposals can be converted into runtime session grants through
    an explicit `POST /sensorium/grants` path and matching CLI command. This
    path writes only process-local session state and records metadata-only
    provenance.
12. Runtime Sensorium grants can be explicitly revoked through
    `POST /sensorium/grants/:id/revoke` and the matching CLI command. If
    active subscriptions are tied to the revoked grant, revocation stops them
    before reporting the grant as revoked.
13. CLI wrappers now cover the guarded operator path: proposal template,
    proposal creation, approval, runtime grant creation, subscription start,
    active-subscription disclosure, subscription stop, and runtime grant
    revocation.
14. A live smoke runbook documents the helper-backed workflow for bounded
    status-topic verification without recording payloads, decoding frames, or
    writing durable grants.
15. Soma decodes status payloads only into the bounded status observation
    summary: schema version, hostname, uptime, node version, and enabled stream
    tails. Raw payload bytes are not retained or surfaced; malformed or
    unexpected-version status payloads increment schema mismatch counters.
16. The color stream contract is documented and test-backed before activation:
    allowed fields are schema version, frame number, dimensions, format, and
    payload size; image bytes, screenshots, raw frames, timestamps, and
    cross-stream fields are explicitly rejected.
17. Color payloads can be decoded only into bounded stream metadata. The
    subscriber records schema version, first/last frame number, dimensions,
    format, and payload size for disclosure/provenance; malformed or
    unexpected-version color payloads increment schema mismatch counters and do
    not produce a stream summary.
18. The live smoke wrapper has a camera-class guard: color/depth smoke targets
    require an explicit camera acknowledgement plus `max_fps`, `format`, and
    `downsample` constraints. Color smoke validates that the ended subscription
    exposes only bounded `stream_summary_observed` metadata.
19. Helper stream errors are consumed as bounded metadata only. `error_class`
    may appear in active disclosure and end provenance, but helper error
    handling must not copy payload bytes, image contents, screenshots, raw
    frames, or free-form content-bearing diagnostics into Node-visible state.
20. `SensoriumSubscriber` enforces declared `max_seconds` duration bounds with
    local timers. Timeout stops use `termination_reason: "timeout"`, manual
    stops and revocation clear pending timers, and timer handles are unref'ed so
    inactive test or CLI processes are not kept alive by future expirations.
21. Automatic subscription endings are written to the app provenance log through
    a bounded callback path. The app whitelists subscription summary fields
    before logging, and the existing provenance query route provides bounded
    inspection without introducing durable writes.

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

Next implementation work should keep status as the only decoded stream until
the same contract-first treatment exists for any higher-risk stream. No
Sensorium grants ship in `config/grants.json`.

The point of this ordering: a participant should never accidentally
receive sensor frames because someone forgot a check. The public path
stays disabled until *every* path it travels is gated correctly.

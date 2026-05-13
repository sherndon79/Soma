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
- **Trust boundary on a multi-host LAN.** Zenoh peer-mode multicast
  discovery brings up any Sensorium instance on the same LAN. Soma's
  policy gateway needs to know which hosts are trusted; an untrusted
  Sensorium publishing realistic-looking topics shouldn't auto-flow to
  the agent. Probably handled by pinning provider entries to specific
  hostnames or device serials, but worth thinking through.
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

Nothing on the Soma side yet. Sensorium is shipping (Phase 3 publishers
complete, Phase 5 hardening mostly complete, payload versioning live).
The first Soma-side slice would likely be:

1. A provider registry entry for the local Sensorium instance
2. Capability catalog entries for the topics, starting with the lowest-risk
   (status), camera-class as restricted opt-in
3. A first thin Soma capability that subscribes to `sensor/<host>/status`,
   logs the heartbeat, and surfaces the topic-discovery list — proves the
   Zenoh-subscription substrate works inside Soma without any sensitive
   data flowing yet
4. Higher-risk camera/depth capabilities only after the substrate is
   exercised and the disclosure surfaces are in place

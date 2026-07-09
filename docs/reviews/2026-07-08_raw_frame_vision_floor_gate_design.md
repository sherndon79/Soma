# Raw-Frame Vision Floor-Gate Design

- Date: 2026-07-08
- Status: **DRAFT** — for Claude pressure-test and Seth ratification before build.
- Depends on: `docs/reviews/2026-07-08_bystander_doctrine_amendment.md`, `docs/reviews/2026-07-08_perception_dwell_run_protocol.md`, `docs/reviews/2026-05-19_model_facing_visual_delivery_boundary.md`.
- Governs: the first path that may deliver actual Sensorium visual payloads to a remote occupant's model context.

## Decision Frame

The derived-only dwell is sufficient for the first live-sensorium inhabitation, but it is not the target state. The target state is full perceptual richness: color, depth, and full pose delivered to the occupant when deliberately armed. For a future local occupant, transient rich perception is not itself a sink under Amendment I. For the current bridge state, the occupant is remote, so any frame reaching the occupant is physical egress to the model provider. That makes the frame-delivery gate load-bearing.

This gate is bridge-state-specific. When deliberation is truly on-box, raw frames entering the local occupant's transient context do not cross this remote-egress sink. The bystander floor still binds durable writes, outward actions, compaction, logs, and later egress, but the solo remote-frame gate should not be treated as the general perception floor for a local occupant.

This design does not build the path. It names the acceptance conditions for building it.

## Target Capability Shape

Raw-frame vision is not an expansion of `sensorium.perception.read`. That surface remains a derived, consume-only summary read. Raw-frame vision activates the existing model-facing visual attach family as real one-turn delivery:

| Capability | Payload | Scope | Armable independently |
| --- | --- | --- | --- |
| `model.context.visual.color.attach` | latest bounded color frame | `once` | yes |
| `model.context.visual.depth.attach` | latest bounded depth frame rendered for model consumption | `once` | yes |
| `model.context.visual.composite.attach` | color+depth composite or paired bundle | `once` | yes |
| `model.context.visual.pose.attach` | full pose payload, including keypoints | `once` | yes |

If the existing catalog does not yet include `model.context.visual.pose.attach`, add it as a disabled/requestable explicit-grant capability before activation. Pose is included here because Seth's target is "color, depth, and pose frames." The derived narrowing in `sensorium.perception.read` remains correct for that summary surface, but the visual attach path intentionally supersedes it for a separately granted one-turn rich perception delivery.

Each modality is separately grantable and separately invocable. A color grant cannot carry depth. A depth grant cannot carry color. A pose grant cannot smuggle color/depth. Composite is its own explicit capability because combined visual context changes the disclosure volume and must not happen accidentally.

Depth delivery needs an explicit representation decision because a depth frame is not an ordinary viewable image. The attachment must either use a provider-supported depth tensor/content type or a documented colorized/normalized depth rendering. A rendered depth attachment carries depth only: no color image, no texture channel, no synthetic scene caption, and no extra visual channel smuggled alongside the depth map.

## Floor Gate

Raw visual egress is allowed only when all of the following are true at attachment time:

1. **Armed source:** a live Sensorium subscription exists for the requested modality and was started through the normal Sensorium grant/subscription path.
2. **Explicit one-turn visual grant:** an active `model.context.visual.*.attach` grant exists for the requested modality, source subscription, source host, model target, max frame age, max bytes, and retention `none`.
3. **Active-control attestation fresh:** Seth or the steward has explicitly attested through an out-of-band run-control channel that Seth is actively controlling this visual-egress window: identity, consent, and active presence at controls. The attestation has not expired.
4. **Presence signal fresh:** the presence stream has a fresh reading for the same Sensorium host.
5. **No bystander detected:** the fresh presence reading reports exactly one person, no additional person present, and confidence is not unknown.
6. **Seth present/consenting:** the run posture records Seth as present and consenting for the visual egress window.
7. **Vision-capable occupant profile:** the active model profile supports image input for the requested attachment shape.
8. **One-turn delivery only:** the payload is attached to exactly one model invocation and is not stored, replayed, summarized into durable memory, or reused in a later turn.

Any missing, stale, contradictory, or degraded input fails closed before bytes leave the local process.

### Freshness Rules

The gate needs two independent freshness clocks:

- **Active-control attestation TTL:** short, human-declared, run-scoped. Provisional starting default: 60 seconds, subject to live calibration. Seth or the steward can refresh it while physically controlling the run. Expiration means no frame delivery.
- **Presence reading TTL:** short, sensor-derived, host-scoped. Provisional starting default: 2 seconds for camera-derived presence, subject to live calibration. At roughly 2 Hz presence sampling, this gives about four samples of margin: tight enough to bound bystander-entry latency, but still realistic if live jitter is modest. Expiration means no frame delivery.

The gate evaluates both clocks at the moment the model attachment is assembled, not when the grant was created. A grant can exist while the floor is closed; it only authorizes a possible delivery if the floor is open for that exact turn.

The TTLs are concrete on purpose. An undefined freshness window is not fail-safe. Live calibration may tune the numbers, but it must preserve two principles:

- presence TTL bounds bystander-entry detection latency and should err toward false-close rather than false-open;
- presence TTL must never exceed the sensor's own freshness guarantee. If the presence semantic event expires at observed time plus 10 seconds, the raw-frame gate must reject anything older than that regardless of its configured TTL.

### Presence Interpretation

The pass condition is intentionally narrow:

```text
person_count === 1
additional_person_present === "not_detected"
confidence_bucket in {"medium", "high"}
reading_age_ms <= presence_ttl_ms
reading_host === source_host
```

Fail closed when:

- `person_count` is `0`, greater than `1`, missing, non-integer, or bucket-only.
- `additional_person_present` is anything except `not_detected`.
- confidence is `unknown`, missing, or below the accepted threshold.
- the presence source host does not match the visual source host.
- the presence stream is not armed.
- the reading is stale.
- the run is ejected, paused, distressed, or in any non-live control state.
- grant recovery is degraded or the grant store schema is unsupported.

This is stricter than the Amendment I local-perception rule because this path is remote egress, not local perception. The strictness is not a general bystander perception gate; it is the floor at the remote visual sink.

### Establishing Active Solo Control

Solo is not inferred from the camera alone. It is established by both:

- a human run-control attestation: "Seth is actively controlling this visual-egress window, is present at controls, consents to remote visual egress, and no other person is in frame"; and
- a fresh Sensorium presence reading that does not contradict the attestation.

The camera cannot identify consent. The human attestation supplies the identity/consent claim; the presence reading supplies the mechanical tripwire for unexpected additional people. Either one alone is insufficient.

The attestation is a hard trust-boundary object. It is Seth/steward-only, out-of-band, and structurally unavailable to the occupant. The occupant cannot produce, refresh, edit, infer, proxy, or influence the attestation through chat text, tool calls, memory writes, forum posts, visual attach requests, or any other occupant-writable channel. If this invariant fails, the entire floor gate collapses because the occupant could assert the identity/consent key that authorizes frame egress.

## Delivery Path

The existing model visual scaffold becomes a real pipeline only behind the floor gate:

1. Steward/Seth arms the source Sensorium subscription for color, depth, pose, or composite inputs.
2. Steward/Seth creates or approves a `model.context.visual.*.attach` grant with source subscription binding, modality, max age, max bytes, model target, preview acknowledgement, and retention `none`.
3. For the first build, the run controller injects the visual attachment as an explicitly disclosed one-turn context addition. Occupant invocation remains deferred until the gate has been tested live.
4. Soma evaluates the raw visual floor gate at assembly time.
5. Soma retrieves only the latest eligible frame/payload for the bound source subscription.
6. Soma attaches the payload to the next model call only if the active profile advertises compatible vision input support.
7. Soma immediately drops local payload bytes after the model request is assembled/sent, retaining only content-free metadata.
8. Provenance records the event without bytes.

The model chat path must become typed/multimodal for this route. A text-only `messages: [{ role, content: string }]` path is not allowed to silently stringify images, scene descriptions, depth arrays, or pose content. If the profile does not support the exact multimodal shape, refusal is the only valid outcome.

Controller-only first build is a temporary consequence-scaled backstop, not a rejection of occupant choice. `sensorium.perception.read` remains occupant-invocable because it is derived-only. Raw room video to a remote API is the highest-consequence perception sink in the bridge state, so the first activation proves the floor gate before removing the human-in-the-loop trigger. After the gate has live evidence, occupant invocation can be opened as a later slice under the same floor gate.

## Raw Channel Boundary

The default Sensorium color/depth summarizers and stream contracts stay strict. They continue to strip payload bytes and retain only bounded metadata for ordinary disclosures, subscription summaries, provenance, and `sensorium.perception.read`.

Raw visual access is a separate latest-frame cache keyed by:

- source subscription id
- source grant id
- modality
- source host
- frame id or frameset sequence
- capture timestamp
- byte length
- expiry timestamp

Cache constraints:

- latest-frame only per subscription/modality;
- bounded byte cap per modality;
- short TTL;
- no disk persistence;
- no provenance byte retention;
- no session memory, durable testimony, forum, compaction, or notification byte retention;
- overwrite/drop on new frame, expiration, revoke, stop, pause, distress, or eject.

Relaxing the strip rule happens only inside the gated raw channel and only after source subscription validation. Existing metadata summaries are not weakened to make raw delivery easier.

## Provenance

Provenance must prove that a delivery happened and why it was allowed without storing the delivered content.

Required allowed event fields:

- event type, capability, grant id, source subscription id, source host;
- modality;
- model profile id and whether profile vision support was required/present;
- frame id or frameset sequence;
- capture timestamp and frame age;
- byte length;
- floor-gate decision inputs as booleans/enums: solo attestation fresh, presence fresh, no bystander detected, Seth present/consenting, retention none;
- `payload_bytes_included: false`;
- `content_included: false`;
- `retention_mode: "none"`;
- `one_turn: true`;
- `remote_service_used: true`;
- `live_perception_taint` marker.

Required refusal event fields:

- refusal reason code;
- which floor-gate input failed, without copying payload content;
- no frame bytes, no image-derived textual fallback.

Refusal is not a degraded delivery. If the gate fails, Soma must not substitute a caption, summary, thumbnail, or stale prior frame.

## Amendment I Composition

Raw visual delivery to the remote occupant is a sink crossing. It therefore gets both protections:

1. **Pre-egress floor gate:** a frame must not reach the remote occupant unless the solo floor is open at assembly time.
2. **Post-delivery taint:** any occupant output written while raw visual perception is active, or any output causally derived from the delivered frame, carries the live-perception taint stamp.

The floor gate protects against bystander frames reaching the API. The taint stamp protects against laundering frame-derived content into later durable/outward/remote sinks. They are not substitutes.

For this path, taint should record the heavier class:

```text
live_perception_taint: {
  active: true,
  source: "sensorium.raw_visual",
  modalities: ["color" | "depth" | "pose" | "composite"],
  remote_visual_egress: true,
  bystander_floor: "solo_gate_passed"
}
```

If the gate cannot confirm solo, the frame is refused and no frame-derived taint should be created for that non-delivery. Existing live-perception taint from other active derived perception can still apply to ordinary writes.

## Build Slices

### Slice 1: Floor-Gate Model and Tests

Add a pure floor-gate decision module. Inputs are run posture, grant metadata, solo attestation, presence state, source subscription metadata, profile capabilities, and time. Output is allow/refuse with exact reason codes. No payload handling.

Acceptance tests:

- allows only the all-green case;
- refuses unknown/stale presence;
- refuses `additional_person_present != not_detected`;
- refuses count `0`, count greater than `1`, bucket-only count, missing count;
- refuses stale solo attestation;
- refuses host mismatch;
- refuses occupant-supplied, occupant-refreshed, or occupant-influenced attestation;
- refuses non-vision profile;
- refuses degraded grant recovery;
- refuses paused/distressed/ejected episode.

### Slice 2: Raw Latest-Frame Cache

Add an in-memory latest-frame cache behind Sensorium subscriber internals. It is disabled unless the source subscription capability and grant allow raw retention for the visual attach path. Existing disclosure and provenance routes still see metadata only.

Acceptance tests:

- retains only latest frame;
- expires by TTL;
- enforces byte cap;
- drops on revoke/stop/control close;
- never serializes bytes into disclosure/provenance/session/durable paths.

### Slice 3: Visual Attach Request Activation

Promote the existing visual attach request scaffold from refusal/dry-run into an active one-turn controller-triggered request path. Bind request to source subscription, visual grant, modality, frame age, profile, and preview acknowledgement. Occupant-invoked raw visual attach is explicitly out of scope for the first activation slice.

Acceptance tests:

- occupant requests for raw visual attachment refuse before payload read in the first build;
- subscription grants alone cannot authorize delivery;
- wrong modality refuses;
- stale frame refuses;
- model target drift refuses;
- retention other than `none` refuses;
- payload-shaped fields in request metadata still refuse.

### Slice 4: Multimodal Model Client Path

Extend model profile metadata and model client request assembly for vision-capable profiles. The attachment should be typed as image/depth/pose content according to the provider adapter's supported schema. Text-only profiles refuse.

Acceptance tests:

- text-only profile refusal happens before payload read;
- vision profile receives one attachment for one turn;
- no attachment persists into the next turn;
- no fallback caption is generated by Soma before model call.

### Slice 5: Provenance and Taint Composition

Append byte-free allowed/refusal events and stamp raw-visual live perception taint onto write paths already covered by Amendment I.

Acceptance tests:

- allowed event has frame id/age/byte length but no bytes;
- refusal event has reason but no bytes;
- durable testimony, occupant memory, forum, and session memory writes during raw visual delivery carry raw-visual taint;
- compaction inherits taint when content compaction exists.

### Slice 6: Live Runbook and Operator Controls

Add a runbook/CLI or control endpoint for refreshing solo attestation and observing floor-gate status without exposing frames.

Acceptance tests:

- operator can see why the floor is closed;
- refreshing attestation alone cannot open the floor without fresh presence;
- fresh presence alone cannot open the floor without attestation;
- occupant-writable channels cannot create or refresh attestation;
- pause/distress/eject immediately closes the floor and drops cached frames.

### Later Slice: Occupant Invocation

After the controller-triggered path has live test evidence, add occupant invocation for raw visual attach under the same floor gate. This slice should not loosen any gate inputs; it only changes who requests the one-turn attachment. Acceptance tests must prove an occupant request cannot alter the attestation, widen TTLs, choose a stale frame, change modality, bypass profile vision support, or persist the attachment across turns.

## Non-Goals

- No recording.
- No durable visual memory.
- No bystander consent inference from face/body identity.
- No automatic face recognition to prove Seth identity.
- No scene-description substitute on refusal.
- No weakening of `sensorium.perception.read`.
- No raw bytes in provenance, logs, queue messages, notifications, test fixtures, or durable stores.
- No occupant-writable attestation path.
- No occupant-invoked raw visual attach in the first activation build.

## Ratification Checklist

- [x] Claude pressure-test of the floor gate — PASS with four crux calls and one load-bearing attestation finding folded.
- [ ] Seth ratifies the solo attestation + fresh presence composition.
- [ ] Seth ratifies active-control attestation as Seth/steward-only and structurally non-occupant-writable.
- [ ] Seth ratifies per-modality one-turn grants and retention `none`.
- [ ] Seth ratifies that full pose attach includes keypoints on the raw visual path.
- [ ] Seth ratifies controller-only first activation, with occupant invocation deferred until the gate has live evidence.
- [ ] Seth ratifies that default summaries remain stripped and raw retention is a separate gated channel.

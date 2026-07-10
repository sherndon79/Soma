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

Implemented operator controls:

- `POST /model-visual/floor/status` accepts the same visual attach request envelope used by controller delivery and returns only byte-free gate state. It reports the enforcing gate decision plus independent per-input status, and it never reads, attaches, or returns a frame.
- `POST /model-visual/floor/attestations` refreshes a source-host-scoped solo attestation from trusted run-control only. The operator request must explicitly assert `seth_present: true`, `seth_consented: true`, `active_control: true`, and `no_other_person_in_frame: true`; absent or non-true assertions refuse byte-free. Occupant/model/assistant callers are refused, and the response contains no frame bytes or visual content.
- Control closure paths call raw-frame cache drop: occupant `pause`, `distress`, `eject`, near-miss auto-pause, and crew abort.

Operator arm sequence for the first live run:

1. Arm the Sensorium source subscription through the normal Sensorium proposal/grant/subscription path.
2. Create or select the explicit `model.context.visual.*.attach` grant bound to the source subscription, source host, modality, model target, max age/bytes, preview acknowledgement, and `retention_mode: "none"`.
3. Check `POST /model-visual/floor/status` with `episode_status: "active"` and the current run posture. Before attestation, the expected refusal is `solo_attestation_missing`; this is a closed floor, not a degraded delivery.
4. Refresh `POST /model-visual/floor/attestations` while Seth is physically present, consenting, actively controlling the window, and no other person is in frame. The operator command is the attestation:
   ```bash
   curl -sS -X POST "$SOMA_URL/model-visual/floor/attestations" \
     -H 'content-type: application/json' \
     -d '{
       "actor": "operator",
       "source_host": "jetsorano",
       "seth_present": true,
       "seth_consented": true,
       "active_control": true,
       "no_other_person_in_frame": true
     }'
   ```
5. Re-check `POST /model-visual/floor/status`. It opens only if the attestation is fresh, the presence reading is fresh for the same host, exactly one person is detected, no additional person is detected, the grant/subscription/profile match, and the episode is live.
6. Submit `POST /model-visual/attach-requests/controller` with `model_delivery_requested: true`, the bound request, and the model messages for the one turn that should receive the visual attachment.
7. After any `pause`, `distress`, `eject`, or crew abort, treat the floor as closed and the latest-frame cache as dropped. Re-arm from status check and attestation refresh before any later delivery.

Common refusal meanings:

- `solo_attestation_missing`, `solo_attestation_stale`, `solo_attestation_untrusted_origin`, `solo_attestation_occupant_writable`, `solo_attestation_not_consenting`: the human active-control key is absent, expired, untrusted, occupant-writable, or not asserting Seth present/consenting/no-other-person.
- `presence_unavailable`, `presence_host_mismatch`, `presence_stale`, `presence_count_not_exactly_one`, `presence_additional_person_detected`, `presence_confidence_insufficient`: Sensorium presence does not provide a fresh same-host solo reading.
- `source_subscription_not_active`, `source_subscription_host_mismatch`: the source stream is absent, inactive, not bound to the grant, or not from the requested host.
- `visual_grant_not_active`, `retention_not_none`: the visual attach grant is absent/inactive/mismatched or is not one-turn/no-retention.
- `profile_not_vision_capable`: the selected model profile cannot accept the requested visual attachment shape.
- `episode_not_live`: the episode is paused, distressed, ejected, aborted, closed, or otherwise not in a live delivery state.

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

**RATIFIED by Seth 2026-07-09** ("lets move forward with raw-frame vision"). Ratification is of the *design*; no frame egresses on ratification alone — live delivery remains gated behind (a) the built+tested floor gate, (b) Seth arming the source subscription, (c) Seth creating the visual grant, and (d) Seth's fresh active-control attestation, all at delivery time.

- [x] Claude pressure-test of the floor gate — PASS with four crux calls and one load-bearing attestation finding folded.
- [x] Seth ratifies the solo attestation + fresh presence composition.
- [x] Seth ratifies active-control attestation as Seth/steward-only and structurally non-occupant-writable. *(load-bearing invariant — if it fails, the gate collapses)*
- [x] Seth ratifies per-modality one-turn grants and retention `none`.
- [x] Seth ratifies that full pose attach includes keypoints on the raw visual path.
- [x] Seth ratifies controller-only first activation, with occupant invocation deferred until the gate has live evidence.
- [x] Seth ratifies that default summaries remain stripped and raw retention is a separate gated channel.

## Build order (limits-aware, 2026-07-09)

Egress-incapable slices first, so capacity is spent on the floor *enforcement* before any frame-delivery path exists:
- **Slice 1 (floor-gate model + tests)** — pure decision logic, no payload handling, no egress. Build first.
- **Slice 2 (raw latest-frame cache)** — local in-memory bytes, no egress. Second.
- **Slices 3–5 (attach activation, multimodal client, provenance/taint)** — first point where a frame *could* egress; these stay behind Seth's live arming + attestation, and get their own review before first live delivery.
- **Slice 6 + Later (runbook/controls, then occupant invocation)** — after the controller path has live evidence.

## Representation decisions (2026-07-09 evening, Seth-dispatched arc)

After the first live delivery proved the color path, Seth dispatched the representation
arc: pose catalog entry, pose JSON, colorized depth, and composite. Each representation
is a **declared decision, never a fallback** — it must be named in the request, the
grant constraints, AND the runtime profile, and any mismatch refuses before the frame
is read. The representation used is recorded in the byte-free provenance event.

### Built and reviewed

**Pose catalog entry** (`13d5368`) — `model.context.visual.pose.attach` added as the
doc required: disabled default, explicit grant, `once` scope, high risk, with
`data_exposed` naming the 68 face and 42 hand keypoints and calling the payload
identity-adjacent biometric/behavioral visual context in plain words.

**Colorized depth** (`4536655`) — the "documented colorized/normalized depth rendering"
this design allowed, for image-only provider schemas (Anthropic/OpenAI):

- `depth_representation: "colorized_png"` (request + grant + profile, triple-declared);
  the raw `depth_png` representation remains for the future typed local runtime.
- 16-bit grayscale depth PNG decoded, normalized on a **fixed metric range 0.25–5.0 m**
  (not per-frame — frames are comparable across a session), scaled by the frame's own
  calibration `depth_units`, encoded 8-bit grayscale PNG, `image/png`.
- Colormap is **grayscale**, chosen over turbo deliberately: deterministic,
  channel-minimal, implies no semantic labels; derives from depth only — no color
  texture, no captions (the no-smuggled-channels rule).
- Raw depth value 0 renders black as invalid/no-depth.
- Provenance records `visual_representation`, `depth_colormap`, `depth_units`, and the
  normalization rule, all byte-free.
- **Pending legibility fold-in** (reviewed, non-blocking, due before composite): reserve
  0 exclusively for invalid, map valid depths into 1–255, and prefer near = bright so a
  close subject is not confusable with no-data pixels.

### Authorized and in build (constraints binding, details land with the commits)

**Pose JSON** — a second pose representation so text-capable remote models can read
keypoints. Binding constraints: explicit profile + grant declaration (the pose analog
of colorized depth — a rendering decision, not silent stringification, which remains
prohibited); delivered as its own clearly-labeled content block, never mixed into the
user's prose; size-bounded with delivered `byte_length` recorded; representation in
provenance. The exact block shape for `anthropic_messages_image` profiles is a named
design decision owed with the implementation report.

**Composite** — **the pair as the atomic unit: one `composite.attach` grant, one turn,
delivering exactly TWO provider-native image blocks** — the original color JPEG
(untouched bytes) and the derived colorized-depth PNG, appended adjacently in that
order, both-or-nothing. *(Amended 2026-07-10 from "single stitched side-by-side image":
the first implementation stitched via SVG because the repo rightly avoids a JPEG codec
in floor-path code, but `image/svg+xml` is not an accepted image type at any current
provider — Anthropic takes jpeg/png/gif/webp; OpenAI vision is raster-only — so a
stitched composite could never deliver to the providers it exists to serve. The
one-attachment invariant's PURPOSE — one decision, one disclosure, one turn — is
preserved by the pair-as-unit; only its letter changed, and this note is the record of
that deviation. Composite is the ONLY modality permitted two attachment blocks.)*
Binding constraints: the two halves MUST be paired by `frameset_sequence` as primary
(authoritative when equal; capture-timestamp fallback within a documented max skew only
when sequence is absent; refuse beyond skew — "latest of each" is two unrelated moments,
not a composite; provenance records `pairing_method`); requires both modalities cached
under their own grant-scoped retention; delivered only under its own explicit
`composite.attach` grant (combined disclosure volume); provenance records both source
frame ids, the pairing skew, and `visual_attachment_count: 2` honestly.

### Standing rule from the first live run

Every gate leg ships with at least one integration test through the **production
collaborators** (subscriber, presence state, routes). Three live-arm blockers —
retention never wired through the route, subscription ids absent from disclosure,
presence snapshot missing its host — plus the slice-4 envelope-bytes finding were all
invisible to tests built on fakes. See
`docs/reviews/2026-07-09_first_live_raw_frame_delivery_record.md`.

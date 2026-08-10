import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BoundedLineDecoder,
  QUEST_SURFACE_MAX_FRAME_BYTES,
  QUEST_SURFACE_CAPABILITY,
  QUEST_SURFACE_CAPABILITY_MIC_CAPTURE,
  QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT,
  QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH,
  QUEST_SURFACE_AUDIO_UPLINK_BYTES,
  QUEST_SURFACE_AUDIO_PLAYBACK_BYTES,
  createAudioChunkPayload,
  createLeaseManifestPayload,
  createPanelSnapshotPayload,
  createQuestSurfaceFrame,
  createQuestSurfaceLease,
  decodeAudioChunkPayload,
  decodeLeaseManifestPayload,
  decodePanelSnapshotPayload,
  parseQuestSurfaceFrame,
  selectHighestQuestSurfaceVersion,
  serializeQuestSurfaceFrame,
} from "../src/questSurfaceProtocol.js";

test("quest surface negotiation selects the highest mutual version from an advertised set", () => {
  assert.equal(selectHighestQuestSurfaceVersion([0, 2, 1]), 1);
  assert.equal(selectHighestQuestSurfaceVersion([0, 2]), null);
  assert.equal(selectHighestQuestSurfaceVersion(["1", 1.5]), null);
  assert.equal(selectHighestQuestSurfaceVersion(null), null);
});

test("quest surface frame preserves u64 values as decimal strings and exact payload bytes", () => {
  const frame = createQuestSurfaceFrame({
    type: "PANEL_SNAPSHOT",
    sessionEpoch: "18446744073709551615",
    streamId: 0,
    direction: "downlink",
    leaseRef: "lease-1",
    seq: "9007199254740993",
    sendTsNs: "123456789",
    payload: { answer: "bounded" },
  });
  const parsed = parseQuestSurfaceFrame(serializeQuestSurfaceFrame(frame).trimEnd());

  assert.equal(parsed.session_epoch, "18446744073709551615");
  assert.equal(parsed.seq, "9007199254740993");
  assert.deepEqual(parsed.payload, { answer: "bounded" });
});

test("quest surface frame rejects capability content without a lease", () => {
  assert.throws(
    () => createQuestSurfaceFrame({
      type: "PANEL_SNAPSHOT",
      sessionEpoch: "1",
      direction: "downlink",
      seq: "1",
      payload: {},
    }),
    (error) => error.code === "lease_ref_required",
  );
});

test("quest surface permits HELLO without a lease but rejects an unleased present message", () => {
  assert.doesNotThrow(() => createQuestSurfaceFrame({
    type: "HELLO",
    sessionEpoch: "0",
    direction: "uplink",
    seq: "1",
    payload: { supported_versions: [1] },
  }));
  assert.throws(
    () => createQuestSurfaceFrame({
      type: "ACTUAL_BOUNDS_ACK",
      sessionEpoch: "1",
      direction: "uplink",
      seq: "2",
      payload: {},
    }),
    (error) => error.code === "lease_ref_required",
  );
});

test("bounded line decoder accepts fragmentation and rejects oversized unterminated frames", () => {
  const decoder = new BoundedLineDecoder();
  assert.deepEqual(decoder.push(Buffer.from("{\"a\":")), []);
  assert.deepEqual(decoder.push(Buffer.from("1}\n")), ["{\"a\":1}"]);

  const oversized = new BoundedLineDecoder();
  assert.throws(
    () => oversized.push(Buffer.alloc(QUEST_SURFACE_MAX_FRAME_BYTES + 1, 0x61)),
    (error) => error.code === "frame_too_large",
  );
});

test("panel snapshot verifies both exact document bytes and inline resource bytes", () => {
  const payload = createPanelSnapshotPayload({
    revision: "7",
    leaseRef: "lease-7",
    text: "HELLO SETH",
  });
  const decoded = decodePanelSnapshotPayload(payload);

  assert.equal(decoded.document.revision, "7");
  assert.equal(decoded.document.lease_ref, "lease-7");
  assert.equal(decoded.document.surface.resource.text, "HELLO SETH");
  assert.equal(decoded.document_hash, payload.document_sha256);
});

test("panel snapshot rejects mismatched document hash, mismatched resource size, and unknown fields", () => {
  const payload = createPanelSnapshotPayload({
    revision: "1",
    leaseRef: "lease-1",
    text: "SOMA",
  });
  assert.throws(
    () => decodePanelSnapshotPayload({ ...payload, document_sha256: "0".repeat(64) }),
    (error) => error.code === "document_hash_mismatch",
  );

  const document = JSON.parse(Buffer.from(payload.document_b64, "base64").toString("utf8"));
  document.surface.resource.byte_length += 1;
  const bytes = Buffer.from(JSON.stringify(document), "utf8");
  const tampered = {
    ...payload,
    document_byte_length: bytes.length,
    document_sha256: createHash("sha256").update(bytes).digest("hex"),
    document_b64: bytes.toString("base64"),
  };
  assert.throws(
    () => decodePanelSnapshotPayload(tampered),
    (error) => error.code === "resource_length_mismatch",
  );

  assert.throws(
    () => parseQuestSurfaceFrame(JSON.stringify({
      ...createQuestSurfaceFrame({
        type: "HELLO",
        sessionEpoch: "0",
        direction: "uplink",
        seq: "1",
        payload: { supported_versions: [1] },
      }),
      surprise: true,
    })),
    (error) => error.code === "frame_fields_invalid",
  );
});

test("panel snapshot rejects non-normalized orientation and non-positive bounds", () => {
  assert.throws(
    () => createPanelSnapshotPayload({
      leaseRef: "lease-1",
      text: "SOMA",
      pose: {
        position: { x: 0, y: 0, z: -1.5 },
        orientation: { x: 0, y: 0, z: 0, w: 2 },
      },
    }),
    (error) => error.code === "orientation_not_normalized",
  );
  assert.throws(
    () => createPanelSnapshotPayload({
      leaseRef: "lease-1",
      text: "SOMA",
      bounds: { width_m: 0, height_m: 0.5 },
    }),
    (error) => error.code === "bounds_invalid",
  );
});

// ── v1b audio + manifest (disabled-first seam) ──────────────────────────────

test("audio chunk payload round-trips for mono 20ms and stereo 40ms", () => {
  const mono20 = createAudioChunkPayload({ utteranceId: "utt-1", answerId: "ans-1", pcmBytes: Buffer.alloc(QUEST_SURFACE_AUDIO_UPLINK_BYTES, 0x01), channels: 1 });
  assert.equal(mono20.pcm_bytes, QUEST_SURFACE_AUDIO_UPLINK_BYTES);
  assert.equal(mono20.frames, 960);
  assert.equal(mono20.chunk_ms, 20);
  assert.deepEqual(decodeAudioChunkPayload(mono20).pcm_bytes, Buffer.alloc(QUEST_SURFACE_AUDIO_UPLINK_BYTES, 0x01));

  const stereo20 = createAudioChunkPayload({ utteranceId: "utt-2", pcmBytes: Buffer.alloc(QUEST_SURFACE_AUDIO_PLAYBACK_BYTES, 0x02), channels: 2 });
  assert.equal(stereo20.channels, 2);
  assert.equal(stereo20.frames, 960);
  const stereo40 = createAudioChunkPayload({ utteranceId: "utt-3", pcmBytes: Buffer.alloc(QUEST_SURFACE_AUDIO_PLAYBACK_BYTES * 2, 0x03), channels: 2 });
  assert.equal(stereo40.frames, 1920);
  assert.equal(stereo40.chunk_ms, 40);
  assert.deepEqual(decodeAudioChunkPayload(stereo40).pcm_bytes.length, QUEST_SURFACE_AUDIO_PLAYBACK_BYTES * 2);
});

test("audio chunk rejects wrong hash, length, base64, and unknown fields", () => {
  const good = createAudioChunkPayload({ utteranceId: "utt-1", pcmBytes: Buffer.alloc(1920, 0x07), channels: 1 });
  assert.throws(() => decodeAudioChunkPayload({ ...good, pcm_sha256: "0".repeat(64) }), (e) => e.code === "pcm_hash_mismatch");
  assert.throws(() => decodeAudioChunkPayload({ ...good, pcm_bytes: 9999 }), (e) => e.code === "pcm_bytes_invalid" || e.code === "pcm_length_mismatch");
  assert.throws(() => decodeAudioChunkPayload({ ...good, pcm_b64: "!!!notb64!!!" }), (e) => e.code === "pcm_encoding_invalid");
  assert.throws(() => decodeAudioChunkPayload({ ...good, extra: 1 }), (e) => e.code === "audio_payload_fields_invalid");
  assert.throws(() => decodeAudioChunkPayload({ ...good, pcm_encoding: "raw" }), (e) => e.code === "pcm_encoding_invalid");
});

test("audio chunk enforces exact 960/20 or 1920/40 contract", () => {
  assert.throws(() => createAudioChunkPayload({ utteranceId: "u", pcmBytes: Buffer.alloc(2000, 0x01), channels: 1 }), (e) => e.code === "pcm_frames_invalid" || e.code === "pcm_bytes_size_invalid");
  const b2000 = Buffer.alloc(2000, 0x01);
  const h2000 = createAudioChunkPayload({ utteranceId: "u2", pcmBytes: Buffer.alloc(1920, 0x01), channels: 1 }).pcm_sha256;
  // use valid hash but wrong frames
  const good1920 = createAudioChunkPayload({ utteranceId: "u", pcmBytes: Buffer.alloc(1920, 0x01), channels: 1 });
  assert.throws(() => decodeAudioChunkPayload({ ...good1920, frames: 1000 }), (e) => e.code === "pcm_frames_invalid");
  assert.throws(() => decodeAudioChunkPayload({ ...good1920, chunk_ms: 40 }), (e) => e.code === "chunk_ms_mismatch");
});

test("lease creation rejects provider/scope mismatch and capability relabeling", () => {
  const epoch = "9999";
  const panelGrant = { id: "g-panel", capability: QUEST_SURFACE_CAPABILITY, provider: "soma.provider.quest-surface-fixture", scope: "session" };
  const micGrantWrongProvider = { id: "g-mic", capability: QUEST_SURFACE_CAPABILITY_MIC_CAPTURE, provider: "soma.provider.local-model", scope: "session" };
  const localGrantWrongScope = { id: "g-local", capability: QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH, provider: "soma.provider.local-model", scope: "session" };
  // correct grant passes
  assert.doesNotThrow(() => createQuestSurfaceLease({ sessionEpoch: epoch, sourceGrant: panelGrant }));
  // wrong provider for mic should fail
  assert.throws(() => createQuestSurfaceLease({ sessionEpoch: epoch, sourceGrant: micGrantWrongProvider }), (e) => e.code === "grant_provider_mismatch");
  // wrong scope for local_attach should fail (session not allowed)
  assert.throws(() => createQuestSurfaceLease({ sessionEpoch: epoch, sourceGrant: localGrantWrongScope }), (e) => e.code === "grant_scope_invalid");
  // relabeling: panel grant cannot mint mic lease — capability is taken from grant, so it will be panel not mic
  const panelLease = createQuestSurfaceLease({ sessionEpoch: epoch, sourceGrant: panelGrant });
  assert.equal(panelLease.capability, QUEST_SURFACE_CAPABILITY);
  assert.notEqual(panelLease.capability, QUEST_SURFACE_CAPABILITY_MIC_CAPTURE);
});

test("lease manifest enforces exact four-leaf set, ID uniqueness, and leaf validation", () => {
  const epoch = "12345";
  const issued = Date.now();
  const ttl = 60000;
  const mkGrant = (id, cap, prov, sc) => ({ id, capability: cap, provider: prov, scope: sc, constraints: {} });
  const gPanel = mkGrant("g-panel", QUEST_SURFACE_CAPABILITY, "soma.provider.quest-surface-fixture", "session");
  const gMic = mkGrant("g-mic", QUEST_SURFACE_CAPABILITY_MIC_CAPTURE, "soma.provider.quest-surface-fixture", "session");
  const gAudio = mkGrant("g-audio", QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT, "soma.provider.quest-surface-fixture", "session");
  const gLocal = mkGrant("g-local", QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH, "soma.provider.local-model", "once");
  const lPanel = createQuestSurfaceLease({ sessionEpoch: epoch, sourceGrant: gPanel, issuedAtMs: issued, ttlMs: ttl, leaseId: "lease-panel" });
  const lMic = createQuestSurfaceLease({ sessionEpoch: epoch, sourceGrant: gMic, issuedAtMs: issued, ttlMs: ttl, leaseId: "lease-mic" });
  const lAudio = createQuestSurfaceLease({ sessionEpoch: epoch, sourceGrant: gAudio, issuedAtMs: issued, ttlMs: ttl, leaseId: "lease-audio" });
  const lLocal = createQuestSurfaceLease({ sessionEpoch: epoch, sourceGrant: gLocal, issuedAtMs: issued, ttlMs: ttl, leaseId: "lease-local" });
  const manifest = createLeaseManifestPayload({ sessionEpoch: epoch, ttlMs: ttl, issuedAtMs: issued, leases: { panel: lPanel, mic_capture: lMic, audio_present: lAudio, local_attach: lLocal } });
  assert.equal(manifest.leases.panel.capability, QUEST_SURFACE_CAPABILITY);
  assert.doesNotThrow(() => decodeLeaseManifestPayload(JSON.parse(JSON.stringify(manifest))));
  // missing leaf
  assert.throws(() => createLeaseManifestPayload({ sessionEpoch: epoch, leases: { panel: lPanel, mic_capture: lMic, audio_present: lAudio } }), (e) => e.code === "manifest_leaves_extra" || e.code === "manifest_leases_missing");
  // extra leaf
  assert.throws(() => createLeaseManifestPayload({ sessionEpoch: epoch, leases: { panel: lPanel, mic_capture: lMic, audio_present: lAudio, local_attach: lLocal, extra: lPanel } }), (e) => e.code === "manifest_leaves_extra");
  // duplicate lease_id
  const dup = createQuestSurfaceLease({ sessionEpoch: epoch, sourceGrant: mkGrant("g-dup", QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH, "soma.provider.local-model", "window"), issuedAtMs: issued, ttlMs: ttl, leaseId: "lease-panel" });
  assert.throws(() => createLeaseManifestPayload({ sessionEpoch: epoch, ttlMs: ttl, issuedAtMs: issued, leases: { panel: lPanel, mic_capture: lMic, audio_present: lAudio, local_attach: dup } }), (e) => e.code === "manifest_duplicate_lease_id");
  // wrong capability in leaf position
  const wrongCap = { ...lLocal, capability: QUEST_SURFACE_CAPABILITY };
  assert.throws(() => createLeaseManifestPayload({ sessionEpoch: epoch, ttlMs: ttl, issuedAtMs: issued, leases: { panel: lPanel, mic_capture: lMic, audio_present: lAudio, local_attach: wrongCap } }), (e) => e.code === "manifest_capability_mismatch");
  // wrong epoch
  const lWrongEpoch = createQuestSurfaceLease({ sessionEpoch: "999", sourceGrant: gLocal, issuedAtMs: issued, ttlMs: ttl, leaseId: "lease-local2" });
  assert.throws(() => createLeaseManifestPayload({ sessionEpoch: epoch, ttlMs: ttl, issuedAtMs: issued, leases: { panel: lPanel, mic_capture: lMic, audio_present: lAudio, local_attach: lWrongEpoch } }), (e) => e.code === "manifest_epoch_mismatch");
  // decode with extra leaf and wrong provider
  const badManifest = JSON.parse(JSON.stringify(manifest));
  badManifest.leases.extra = badManifest.leases.panel;
  assert.throws(() => decodeLeaseManifestPayload(badManifest), (e) => e.code === "manifest_leaves_extra");
  const badProvider = JSON.parse(JSON.stringify(manifest));
  badProvider.leases.local_attach.provider = "soma.provider.quest-surface-fixture";
  assert.throws(() => decodeLeaseManifestPayload(badProvider), (e) => e.code === "manifest_provider_mismatch");
  const badEpoch = JSON.parse(JSON.stringify(manifest));
  badEpoch.leases.local_attach.session_epoch = "999";
  assert.throws(() => decodeLeaseManifestPayload(badEpoch), (e) => e.code === "manifest_epoch_mismatch");
  const badExpiry = JSON.parse(JSON.stringify(manifest));
  badExpiry.expires_at_ms = badExpiry.issued_at_ms + badExpiry.ttl_ms + 1;
  assert.throws(() => decodeLeaseManifestPayload(badExpiry), (e) => e.code === "manifest_expires_mismatch");
});

test("manifest expiry must not outlive leaves and leaf timing consistent", () => {
  const epoch = "555";
  const issued = 1000000;
  const ttl = 60000;
  const mk = (id, cap, prov, sc, leaseId) => createQuestSurfaceLease({ sessionEpoch: epoch, sourceGrant: { id, capability: cap, provider: prov, scope: sc, constraints: {} }, issuedAtMs: issued, ttlMs: ttl, leaseId });
  const lPanel = mk("g1", QUEST_SURFACE_CAPABILITY, "soma.provider.quest-surface-fixture", "session", "l1");
  const lMic = mk("g2", QUEST_SURFACE_CAPABILITY_MIC_CAPTURE, "soma.provider.quest-surface-fixture", "session", "l2");
  const lAudio = mk("g3", QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT, "soma.provider.quest-surface-fixture", "session", "l3");
  const lLocal = mk("g4", QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH, "soma.provider.local-model", "once", "l4");
  const manifest = createLeaseManifestPayload({ sessionEpoch: epoch, ttlMs: ttl, issuedAtMs: issued, leases: { panel: lPanel, mic_capture: lMic, audio_present: lAudio, local_attach: lLocal } });
  // tamper leaf expiry to be shorter than manifest
  const shortLeaf = { ...lLocal, expires_at_ms: issued + 1000 };
  assert.throws(() => createLeaseManifestPayload({ sessionEpoch: epoch, ttlMs: ttl, issuedAtMs: issued, leases: { panel: lPanel, mic_capture: lMic, audio_present: lAudio, local_attach: shortLeaf } }), (e) => e.code === "manifest_expires_mismatch" || e.code === "manifest_leaf_expires_mismatch");
});

test("lease creation requires exact provider and scope coordinates", () => {
  const epoch = "1";
  // missing provider
  assert.throws(() => createQuestSurfaceLease({ sessionEpoch: epoch, sourceGrant: { id: "g-mic", capability: QUEST_SURFACE_CAPABILITY_MIC_CAPTURE, constraints: {} } }), (e) => e.code === "grant_provider_missing");
  // missing scope
  assert.throws(() => createQuestSurfaceLease({ sessionEpoch: epoch, sourceGrant: { id: "g-mic", capability: QUEST_SURFACE_CAPABILITY_MIC_CAPTURE, provider: "soma.provider.quest-surface-fixture", constraints: {} } }), (e) => e.code === "grant_scope_missing");
  // empty provider
  assert.throws(() => createQuestSurfaceLease({ sessionEpoch: epoch, sourceGrant: { id: "g-mic", capability: QUEST_SURFACE_CAPABILITY_MIC_CAPTURE, provider: "", scope: "session", constraints: {} } }), (e) => e.code === "grant_provider_missing");
});

test("modality constraints are exact — non-panel rejects non-empty constraints and arrays", () => {
  const epoch = "1";
  const goodMic = { id: "g-mic", capability: QUEST_SURFACE_CAPABILITY_MIC_CAPTURE, provider: "soma.provider.quest-surface-fixture", scope: "session", constraints: {} };
  assert.doesNotThrow(() => createQuestSurfaceLease({ sessionEpoch: epoch, sourceGrant: goodMic }));
  const badMic = { id: "g-mic", capability: QUEST_SURFACE_CAPABILITY_MIC_CAPTURE, provider: "soma.provider.quest-surface-fixture", scope: "session", constraints: { armed_window_id: "window-1" } };
  assert.throws(() => createQuestSurfaceLease({ sessionEpoch: epoch, sourceGrant: badMic }), (e) => e.code === "lease_constraints_unsupported");
  const arrayConstraints = { id: "g-mic", capability: QUEST_SURFACE_CAPABILITY_MIC_CAPTURE, provider: "soma.provider.quest-surface-fixture", scope: "session", constraints: [] };
  assert.throws(() => createQuestSurfaceLease({ sessionEpoch: epoch, sourceGrant: arrayConstraints }), (e) => e.code === "lease_constraints_invalid");
  // manifest decode with array constraints should also fail
  const mk = (id, cap, prov, sc) => createQuestSurfaceLease({ sessionEpoch: epoch, sourceGrant: { id, capability: cap, provider: prov, scope: sc, constraints: {} }, leaseId: `l-${id}` });
  const lPanel = mk("g1", QUEST_SURFACE_CAPABILITY, "soma.provider.quest-surface-fixture", "session");
  const lMic = mk("g2", QUEST_SURFACE_CAPABILITY_MIC_CAPTURE, "soma.provider.quest-surface-fixture", "session");
  const lAudio = mk("g3", QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT, "soma.provider.quest-surface-fixture", "session");
  const lLocal = mk("g4", QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH, "soma.provider.local-model", "once");
  const manifest = createLeaseManifestPayload({ sessionEpoch: epoch, leases: { panel: lPanel, mic_capture: lMic, audio_present: lAudio, local_attach: lLocal } });
  const badArray = JSON.parse(JSON.stringify(manifest));
  badArray.leases.mic_capture.constraints = [];
  assert.throws(() => decodeLeaseManifestPayload(badArray), (e) => e.code === "manifest_constraints_invalid" || e.code === "lease_constraints_invalid");
  // creation-path regressions: createLeaseManifestPayload must also reject
  const epoch2 = "2";
  const issued2 = 1_000_000;
  const ttl2 = 60_000;
  const mk2 = (id, cap, prov, sc) => createQuestSurfaceLease({ sessionEpoch: epoch2, issuedAtMs: issued2, ttlMs: ttl2, sourceGrant: { id, capability: cap, provider: prov, scope: sc, constraints: {} }, leaseId: `l2-${id}` });
  const p2 = mk2("g1", QUEST_SURFACE_CAPABILITY, "soma.provider.quest-surface-fixture", "session");
  const m2 = mk2("g2", QUEST_SURFACE_CAPABILITY_MIC_CAPTURE, "soma.provider.quest-surface-fixture", "session");
  const a2 = mk2("g3", QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT, "soma.provider.quest-surface-fixture", "session");
  const lo2 = mk2("g4", QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH, "soma.provider.local-model", "once");
  const good2 = createLeaseManifestPayload({ sessionEpoch: epoch2, ttlMs: ttl2, issuedAtMs: issued2, leases: { panel: p2, mic_capture: m2, audio_present: a2, local_attach: lo2 } });
  const badCreateArray = JSON.parse(JSON.stringify(good2));
  badCreateArray.leases.mic_capture.constraints = [];
  assert.throws(() => createLeaseManifestPayload({ sessionEpoch: epoch2, ttlMs: ttl2, issuedAtMs: issued2, leases: badCreateArray.leases }), (e) => e.code === "manifest_constraints_invalid" || e.code === "lease_constraints_invalid");
  const badCreateNonEmpty = JSON.parse(JSON.stringify(good2));
  badCreateNonEmpty.leases.mic_capture.constraints = { armed_window_id: "w1" };
  assert.throws(() => createLeaseManifestPayload({ sessionEpoch: epoch2, ttlMs: ttl2, issuedAtMs: issued2, leases: badCreateNonEmpty.leases }), (e) => e.code === "lease_constraints_unsupported");
  const badCreatePanelUnknown = JSON.parse(JSON.stringify(good2));
  badCreatePanelUnknown.leases.panel.constraints = { unknown_field: 1 };
  assert.throws(() => createLeaseManifestPayload({ sessionEpoch: epoch2, ttlMs: ttl2, issuedAtMs: issued2, leases: badCreatePanelUnknown.leases }), (e) => e.code === "lease_constraints_unknown_field");
  // positive exact-panel constraint round trip
  const panelWithBytes = createQuestSurfaceLease({ sessionEpoch: epoch2, issuedAtMs: issued2, ttlMs: ttl2, sourceGrant: { id: "g-panel-512", capability: QUEST_SURFACE_CAPABILITY, provider: "soma.provider.quest-surface-fixture", scope: "session", constraints: { max_panel_text_bytes: 512 } }, leaseId: "l2-panel-512" });
  const goodPanel = createLeaseManifestPayload({ sessionEpoch: epoch2, ttlMs: ttl2, issuedAtMs: issued2, leases: { panel: panelWithBytes, mic_capture: m2, audio_present: a2, local_attach: lo2 } });
  assert.doesNotThrow(() => decodeLeaseManifestPayload(JSON.parse(JSON.stringify(goodPanel))));
});

test("direction/role binding: uplink mono, downlink stereo at frame seam", () => {
  const monoPayload = createAudioChunkPayload({ utteranceId: "u1", pcmBytes: Buffer.alloc(1920, 0x01), channels: 1 });
  const stereoPayload = createAudioChunkPayload({ utteranceId: "u2", pcmBytes: Buffer.alloc(3840, 0x02), channels: 2 });
  // correct bindings pass
  assert.doesNotThrow(() => createQuestSurfaceFrame({ type: "AUDIO_CHUNK", sessionEpoch: "1", streamId: 1, direction: "uplink", leaseRef: "lease-mic", seq: "1", payload: monoPayload }));
  assert.doesNotThrow(() => createQuestSurfaceFrame({ type: "AUDIO_CHUNK", sessionEpoch: "1", streamId: 2, direction: "downlink", leaseRef: "lease-audio", seq: "1", payload: stereoPayload }));
  // wrong bindings fail
  assert.throws(() => createQuestSurfaceFrame({ type: "AUDIO_CHUNK", sessionEpoch: "1", streamId: 1, direction: "uplink", leaseRef: "lease-mic", seq: "2", payload: stereoPayload }), (e) => e.code === "audio_direction_mismatch");
  assert.throws(() => createQuestSurfaceFrame({ type: "AUDIO_CHUNK", sessionEpoch: "1", streamId: 2, direction: "downlink", leaseRef: "lease-audio", seq: "2", payload: monoPayload }), (e) => e.code === "audio_direction_mismatch");
  // parse path also enforces
  const uplinkFrame = createQuestSurfaceFrame({ type: "AUDIO_CHUNK", sessionEpoch: "1", streamId: 1, direction: "uplink", leaseRef: "lease-mic", seq: "10", payload: monoPayload });
  const serialized = JSON.stringify({ ...uplinkFrame, payload_b64: Buffer.from(JSON.stringify(monoPayload), "utf8").toString("base64"), payload_len: Buffer.from(JSON.stringify(monoPayload), "utf8").length });
  // tamper to stereo but keep uplink direction via raw JSON
  const tampered = { ...uplinkFrame, payload_b64: Buffer.from(JSON.stringify(stereoPayload), "utf8").toString("base64"), payload_len: Buffer.from(JSON.stringify(stereoPayload), "utf8").length };
  assert.throws(() => parseQuestSurfaceFrame(JSON.stringify(tampered)), (e) => e.code === "audio_direction_mismatch");
});

test("answer_id strictness: non-string and over-256 rejected, empty allowed", () => {
  const mono = Buffer.alloc(1920, 0x01);
  assert.throws(() => createAudioChunkPayload({ utteranceId: "u", answerId: { unexpected: true }, pcmBytes: mono, channels: 1 }), (e) => e.code === "answer_id_invalid");
  assert.throws(() => createAudioChunkPayload({ utteranceId: "u", answerId: "a".repeat(257), pcmBytes: mono, channels: 1 }), (e) => e.code === "answer_id_invalid");
  assert.doesNotThrow(() => createAudioChunkPayload({ utteranceId: "u", answerId: "", pcmBytes: mono, channels: 1 }));
  assert.doesNotThrow(() => createAudioChunkPayload({ utteranceId: "u", answerId: "ans-123", pcmBytes: mono, channels: 1 }));
  const good = createAudioChunkPayload({ utteranceId: "u", answerId: "ans", pcmBytes: mono, channels: 1 });
  assert.throws(() => decodeAudioChunkPayload({ ...good, answer_id: { unexpected: true } }), (e) => e.code === "answer_id_invalid");
  assert.throws(() => decodeAudioChunkPayload({ ...good, answer_id: "a".repeat(257) }), (e) => e.code === "answer_id_invalid");
});

test("panel snapshot v1 and v2 schemas are exact and the Node fixture is reproducible", () => {
  const v1 = createPanelSnapshotPayload({
    revision: "1",
    leaseRef: "lease-v1",
    text: "HELLO V1",
  });
  const v1Document = decodePanelSnapshotPayload(v1).document;
  assert.equal(v1Document.schema_version, 1);
  assert.equal(Object.hasOwn(v1Document, "answer_id"), false);
  assert.equal(Object.hasOwn(v1Document, "utterance_id"), false);

  const fixture = JSON.parse(readFileSync(
    new URL("../clients/quest-surface/app/src/test/resources/questSurfaceV2Fixture.json", import.meta.url),
    "utf8",
  ));
  const generated = createPanelSnapshotPayload({
    revision: fixture.input.revision,
    leaseRef: fixture.input.lease_ref,
    text: fixture.input.text,
    surfaceId: fixture.input.surface_id,
    ttlMs: fixture.input.ttl_ms,
    answerId: fixture.input.answer_id,
    utteranceId: fixture.input.utterance_id,
  });
  assert.deepEqual(generated, fixture.payload, "fixture must remain byte-for-byte Node reproducible");

  const documentBytes = Buffer.from(generated.document_b64, "base64");
  assert.equal(documentBytes.length, generated.document_byte_length);
  assert.equal(createHash("sha256").update(documentBytes).digest("hex"), generated.document_sha256);
  const v2Document = decodePanelSnapshotPayload(generated).document;
  assert.equal(v2Document.schema_version, 2);
  assert.equal(v2Document.answer_id, fixture.expected.answer_id);
  assert.equal(v2Document.utterance_id, fixture.expected.utterance_id);
  assert.equal(v2Document.revision, fixture.expected.revision);
});

test("panel snapshot v2 creator rejects incomplete or non-token correlation", () => {
  const create = (answerId, utteranceId) => createPanelSnapshotPayload({
    revision: "1",
    leaseRef: "lease-v2",
    text: "HELLO V2",
    answerId,
    utteranceId,
  });

  assert.throws(() => create({ unexpected: true }, "utt"), (error) => error.code === "answer_id_invalid");
  assert.throws(() => create("ans", { unexpected: true }), (error) => error.code === "utterance_id_invalid");
  assert.throws(() => create(" a ", "utt"), (error) => error.code === "answer_id_invalid");
  assert.throws(() => create("ans", " u "), (error) => error.code === "utterance_id_invalid");
  assert.throws(() => create("", "utt"), (error) => error.code === "answer_id_invalid");
  assert.throws(() => create("ans", ""), (error) => error.code === "utterance_id_invalid");
  assert.throws(() => create("a".repeat(257), "utt"), (error) => error.code === "answer_id_invalid");
  assert.throws(() => create("ans", "u".repeat(257)), (error) => error.code === "utterance_id_invalid");
  assert.throws(() => create("ans", undefined), (error) => error.code === "answer_correlation_incomplete");
  assert.throws(() => create(undefined, "utt"), (error) => error.code === "answer_correlation_incomplete");
});

test("panel snapshot decoder rejects mis-versioned, incomplete, padded, and unknown v2 documents", () => {
  const v2 = createPanelSnapshotPayload({
    revision: "2",
    leaseRef: "lease-v2",
    text: "HELLO V2",
    answerId: "ans-v2",
    utteranceId: "utt-v2",
  });

  const rejects = (mutate, code) => assert.throws(
    () => decodePanelSnapshotPayload(rewritePanelDocument(v2, mutate)),
    (error) => error.code === code,
  );
  rejects((document) => { document.schema_version = 1; }, "document_schema_mismatch");
  rejects((document) => { delete document.answer_id; }, "answer_correlation_incomplete");
  rejects((document) => {
    delete document.answer_id;
    delete document.utterance_id;
  }, "answer_correlation_incomplete");
  rejects((document) => { document.schema_version = 3; }, "document_schema_unsupported");
  rejects((document) => { document.answer_id = " ans-v2 "; }, "answer_id_invalid");
  rejects((document) => { document.utterance_id = " utt-v2 "; }, "utterance_id_invalid");
  rejects((document) => { document.answer_id = { unexpected: true }; }, "answer_id_invalid");
  rejects((document) => { document.unexpected = true; }, "document_fields_invalid");
});

function rewritePanelDocument(payload, mutate) {
  const document = JSON.parse(Buffer.from(payload.document_b64, "base64").toString("utf8"));
  mutate(document);
  const documentBytes = Buffer.from(JSON.stringify(document), "utf8");
  return {
    ...payload,
    document_byte_length: documentBytes.length,
    document_sha256: createHash("sha256").update(documentBytes).digest("hex"),
    document_b64: documentBytes.toString("base64"),
  };
}

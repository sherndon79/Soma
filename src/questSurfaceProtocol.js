import { createHash, randomBytes, randomUUID } from "node:crypto";

export const QUEST_SURFACE_PROTOCOL_VERSION = 1;
export const QUEST_SURFACE_MAX_FRAME_BYTES = 64 * 1024;
export const QUEST_SURFACE_MAX_PAYLOAD_BYTES = 48 * 1024;
export const QUEST_SURFACE_MAX_DOCUMENT_BYTES = 8 * 1024;
export const QUEST_SURFACE_MAX_PANEL_TEXT_BYTES = 2 * 1024;
export const QUEST_SURFACE_MAX_LEASE_TTL_MS = 5 * 60 * 1000;
export const QUEST_SURFACE_CAPABILITY = "interaction.quest.surface.panel.present";
export const QUEST_SURFACE_PROVIDER_ID = "soma.provider.quest-surface-fixture";

// v1b proposed migration keys (disabled-first, explicit-grant) — §13
export const QUEST_SURFACE_CAPABILITY_MIC_CAPTURE = "interaction.quest.surface.microphone.capture";
export const QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT = "interaction.quest.surface.audio.wearer_directed.present";
export const QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH = "model.context.audio.microphone.local.attach";
export const QUEST_SURFACE_V1B_CAPABILITIES = [
  QUEST_SURFACE_CAPABILITY,
  QUEST_SURFACE_CAPABILITY_MIC_CAPTURE,
  QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT,
  QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH,
];

// Audio wire contract §10.1 — PCM S16LE, 48kHz, 20ms = 960 frames
export const QUEST_SURFACE_AUDIO_SAMPLE_RATE = 48000;
export const QUEST_SURFACE_AUDIO_CHUNK_MS = 20;
export const QUEST_SURFACE_AUDIO_FRAMES_PER_CHUNK = 960;
export const QUEST_SURFACE_AUDIO_UPLINK_BYTES = 960 * 2; // mono S16LE
export const QUEST_SURFACE_AUDIO_PLAYBACK_BYTES = 960 * 2 * 2; // stereo S16LE
export const QUEST_SURFACE_AUDIO_MAX_CHUNK_MS = 40;
export const QUEST_SURFACE_AUDIO_MAX_UPLINK_BYTES = 1920 * 2; // 40ms mono
export const QUEST_SURFACE_AUDIO_MAX_PLAYBACK_BYTES = 3840 * 2; // 40ms stereo
export const QUEST_SURFACE_JITTER_MS = 200;
export const QUEST_SURFACE_MAX_UTTERANCE_CHUNKS = 1500; // 30s at 20ms
export const QUEST_SURFACE_MAX_UTTERANCE_MS = 30_000;
export const QUEST_SURFACE_VAD_SILENCE_CHUNKS = 50; // 1s silence
export const QUEST_SURFACE_VAD_ENERGY_THRESHOLD = 500; // S16LE RMS-ish threshold, fixture

const FRAME_FIELDS = new Set([
  "version",
  "type",
  "session_epoch",
  "stream_id",
  "direction",
  "lease_ref",
  "seq",
  "send_ts_ns",
  "payload_len",
  "payload_b64",
]);
const UNLEASED_TYPES = new Set([
  "HELLO",
  "HELLO_ACK",
  "LEASE",
  "LEASE_MANIFEST",
  "FOCUS_LOST",
  "SUSPEND",
  "TEARDOWN_ACK",
  "ERROR",
]);
export const QUEST_SURFACE_AUDIO_FRAME_TYPES = new Set([
  "UTTERANCE_START",
  "AUDIO_CHUNK",
  "UTTERANCE_END",
  "CANCEL",
]);
export const QUEST_SURFACE_LEASED_AUDIO_TYPES = new Set([
  "UTTERANCE_START",
  "AUDIO_CHUNK",
  "UTTERANCE_END",
  "CANCEL",
  "PANEL_SNAPSHOT",
  "ACTUAL_BOUNDS_ACK",
]);
const DIRECTIONS = new Set(["uplink", "downlink"]);
const DECIMAL_U64 = /^(0|[1-9][0-9]{0,19})$/;
const DECIMAL_I64 = /^-?(0|[1-9][0-9]{0,18})$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export class QuestSurfaceProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "QuestSurfaceProtocolError";
    this.code = code;
  }
}

export function selectHighestQuestSurfaceVersion(supportedVersions) {
  if (!Array.isArray(supportedVersions)) {
    return null;
  }
  const mutual = supportedVersions.filter((version) => (
    Number.isSafeInteger(version)
    && version >= 0
    && version === QUEST_SURFACE_PROTOCOL_VERSION
  ));
  return mutual.length === 0 ? null : Math.max(...mutual);
}

export class BoundedLineDecoder {
  constructor({ maxFrameBytes = QUEST_SURFACE_MAX_FRAME_BYTES } = {}) {
    this.maxFrameBytes = maxFrameBytes;
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.buffer = Buffer.concat([this.buffer, incoming]);
    const lines = [];

    for (;;) {
      const newline = this.buffer.indexOf(0x0a);
      if (newline < 0) {
        if (this.buffer.length > this.maxFrameBytes) {
          throw protocolError("frame_too_large", "Quest surface frame exceeds the byte limit.");
        }
        return lines;
      }
      if (newline > this.maxFrameBytes) {
        throw protocolError("frame_too_large", "Quest surface frame exceeds the byte limit.");
      }
      let line = this.buffer.subarray(0, newline);
      this.buffer = this.buffer.subarray(newline + 1);
      if (line.at(-1) === 0x0d) {
        line = line.subarray(0, -1);
      }
      if (line.length === 0) {
        throw protocolError("empty_frame", "Quest surface frames cannot be empty.");
      }
      lines.push(decodeUtf8(line, "frame_not_utf8"));
    }
  }
}

export function createQuestSurfaceFrame({
  type,
  sessionEpoch = "0",
  streamId = 0,
  direction,
  leaseRef = "",
  seq,
  sendTsNs = monotonicNowNs(),
  payload = {},
} = {}) {
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  if (payloadBytes.length > QUEST_SURFACE_MAX_PAYLOAD_BYTES) {
    throw protocolError("payload_too_large", "Quest surface payload exceeds the byte limit.");
  }
  const frame = {
    version: QUEST_SURFACE_PROTOCOL_VERSION,
    type: requireToken(type, "missing_type"),
    session_epoch: decimalU64(sessionEpoch, "invalid_session_epoch"),
    stream_id: boundedInteger(streamId, 0, 0xffff_ffff, "invalid_stream_id"),
    direction: requireDirection(direction),
    lease_ref: String(leaseRef ?? ""),
    seq: decimalU64(seq, "invalid_sequence"),
    send_ts_ns: decimalI64(sendTsNs, "invalid_send_timestamp"),
    payload_len: payloadBytes.length,
    payload_b64: payloadBytes.toString("base64"),
  };
  validateLeaseBinding(frame);
  // v1b direction/role binding: mic uplink mono, wearer playback stereo
  if (frame.type === "AUDIO_CHUNK") {
    const chans = payload?.channels;
    if (chans !== 1 && chans !== 2) throw protocolError("channels_invalid", "AUDIO_CHUNK payload must declare channels 1 or 2");
    if (frame.direction === "uplink" && chans !== 1) throw protocolError("audio_direction_mismatch", "Mic uplink AUDIO_CHUNK must be mono (1)");
    if (frame.direction === "downlink" && chans !== 2) throw protocolError("audio_direction_mismatch", "Wearer playback AUDIO_CHUNK must be stereo (2)");
  }
  return frame;
}

export function serializeQuestSurfaceFrame(frame) {
  const normalized = parseQuestSurfaceFrame(JSON.stringify(frame));
  const encoded = `${JSON.stringify(publicFrame(normalized))}\n`;
  if (Buffer.byteLength(encoded, "utf8") > QUEST_SURFACE_MAX_FRAME_BYTES) {
    throw protocolError("frame_too_large", "Quest surface frame exceeds the byte limit.");
  }
  return encoded;
}

export function parseQuestSurfaceFrame(line) {
  if (typeof line !== "string") {
    throw protocolError("frame_not_text", "Quest surface frame must be UTF-8 JSON.");
  }
  if (Buffer.byteLength(line, "utf8") > QUEST_SURFACE_MAX_FRAME_BYTES) {
    throw protocolError("frame_too_large", "Quest surface frame exceeds the byte limit.");
  }
  let frame;
  try {
    frame = JSON.parse(line);
  } catch {
    throw protocolError("frame_json_invalid", "Quest surface frame is not valid JSON.");
  }
  requirePlainObject(frame, "frame_shape_invalid", "Quest surface frame must be an object.");
  requireExactFields(frame, FRAME_FIELDS, "frame_fields_invalid");
  if (frame.version !== QUEST_SURFACE_PROTOCOL_VERSION) {
    throw protocolError("version_unsupported", "Quest surface protocol version is unsupported.");
  }
  frame.type = requireToken(frame.type, "missing_type");
  frame.session_epoch = decimalU64(frame.session_epoch, "invalid_session_epoch");
  frame.stream_id = boundedInteger(frame.stream_id, 0, 0xffff_ffff, "invalid_stream_id");
  frame.direction = requireDirection(frame.direction);
  frame.lease_ref = String(frame.lease_ref ?? "");
  frame.seq = decimalU64(frame.seq, "invalid_sequence");
  frame.send_ts_ns = decimalI64(frame.send_ts_ns, "invalid_send_timestamp");
  frame.payload_len = boundedInteger(
    frame.payload_len,
    0,
    QUEST_SURFACE_MAX_PAYLOAD_BYTES,
    "invalid_payload_length",
  );
  if (typeof frame.payload_b64 !== "string" || !isCanonicalBase64(frame.payload_b64)) {
    throw protocolError("payload_encoding_invalid", "Quest surface payload must be canonical base64.");
  }
  const payloadBytes = Buffer.from(frame.payload_b64, "base64");
  if (payloadBytes.length !== frame.payload_len) {
    throw protocolError("payload_length_mismatch", "Quest surface payload length does not match its envelope.");
  }
  frame.payload = parsePayload(payloadBytes);
  validateLeaseBinding(frame);
  if (frame.type === "AUDIO_CHUNK") {
    const chans = frame.payload?.channels;
    if (chans !== 1 && chans !== 2) throw protocolError("channels_invalid", "AUDIO_CHUNK payload must declare channels 1 or 2");
    if (frame.direction === "uplink" && chans !== 1) throw protocolError("audio_direction_mismatch", "Mic uplink AUDIO_CHUNK must be mono (1)");
    if (frame.direction === "downlink" && chans !== 2) throw protocolError("audio_direction_mismatch", "Wearer playback AUDIO_CHUNK must be stereo (2)");
  }
  return frame;
}

export function createPanelSnapshotPayload({
  revision = "1",
  leaseRef,
  text,
  surfaceId = "panel.main",
  ttlMs = 30_000,
  pose = defaultPanelPose(),
  bounds = { width_m: 0.9, height_m: 0.5 },
  answerId,
  utteranceId,
} = {}) {
  const panelText = String(text ?? "");
  const textBytes = Buffer.from(panelText, "utf8");
  if (textBytes.length === 0 || textBytes.length > QUEST_SURFACE_MAX_PANEL_TEXT_BYTES) {
    throw protocolError("panel_text_size_invalid", "Panel text must be non-empty and within the v1a byte limit.");
  }
  const document = {
    schema_version: 1,
    revision: decimalU64(revision, "document_revision_invalid"),
    ttl_ms: boundedInteger(ttlMs, 1, QUEST_SURFACE_MAX_LEASE_TTL_MS, "document_ttl_invalid"),
    lease_ref: requireToken(leaseRef, "document_lease_missing"),
    surface: {
      id: requireToken(surfaceId, "surface_id_missing"),
      kind: "panel",
      space: "view",
      pose: normalizePose(pose),
      bounds: normalizeBounds(bounds),
      resource: {
        media_type: "text/plain;charset=utf-8",
        encoding: "utf-8",
        byte_length: textBytes.length,
        sha256: sha256(textBytes),
        text: panelText,
      },
    },
  };
  // v1b correlation: expose answerId/utteranceId in signature, normalize via requireToken, bind before hashing — schema 2 (strict: whitespace-padded IDs rejected to match Java, non-string rejected)
  let isV1b = false;
  if (answerId !== undefined || utteranceId !== undefined) {
    if (answerId !== undefined) {
      if (typeof answerId !== "string") throw protocolError("answer_id_invalid", "Panel answer_id must be a string");
      const normAnswer = requireToken(answerId, "answer_id_invalid");
      if (answerId !== normAnswer) throw protocolError("answer_id_invalid", "Panel answer_id must be token without surrounding whitespace");
      if (normAnswer.length > 256) throw protocolError("answer_id_invalid", "Panel answer_id too long");
      document.answer_id = normAnswer;
      isV1b = true;
    }
    if (utteranceId !== undefined) {
      if (typeof utteranceId !== "string") throw protocolError("utterance_id_invalid", "Panel utterance_id must be a string");
      const normUtterance = requireToken(utteranceId, "utterance_id_invalid");
      if (utteranceId !== normUtterance) throw protocolError("utterance_id_invalid", "Panel utterance_id must be token without surrounding whitespace");
      if (normUtterance.length > 256) throw protocolError("utterance_id_invalid", "Panel utterance_id too long");
      document.utterance_id = normUtterance;
      isV1b = true;
    }
    if ((document.answer_id && !document.utterance_id) || (!document.answer_id && document.utterance_id)) {
      throw protocolError("answer_correlation_incomplete", "Panel answer_id and utterance_id must appear together");
    }
    if (isV1b) document.schema_version = 2;
  }
  const documentBytes = Buffer.from(JSON.stringify(document), "utf8");
  if (documentBytes.length > QUEST_SURFACE_MAX_DOCUMENT_BYTES) {
    throw protocolError("document_too_large", "Quest surface document exceeds the v1a byte limit.");
  }
  return {
    document_encoding: "base64-json-utf8",
    document_byte_length: documentBytes.length,
    document_sha256: sha256(documentBytes),
    document_b64: documentBytes.toString("base64"),
  };
}

export function decodePanelSnapshotPayload(payload) {
  requirePlainObject(payload, "snapshot_payload_invalid", "Panel snapshot payload must be an object.");
  // v1b is now hash-bound via document.answer_id/utterance_id, not outer payload — outer must remain strict v1a
  requireExactFields(
    payload,
    new Set(["document_encoding", "document_byte_length", "document_sha256", "document_b64"]),
    "snapshot_payload_fields_invalid",
  );
  if (payload.document_encoding !== "base64-json-utf8") {
    throw protocolError("document_encoding_invalid", "Panel snapshot document encoding is unsupported.");
  }
  const length = boundedInteger(
    payload.document_byte_length,
    1,
    QUEST_SURFACE_MAX_DOCUMENT_BYTES,
    "document_length_invalid",
  );
  if (typeof payload.document_sha256 !== "string" || !SHA256_HEX.test(payload.document_sha256)) {
    throw protocolError("document_hash_invalid", "Panel snapshot document hash is invalid.");
  }
  if (typeof payload.document_b64 !== "string" || !isCanonicalBase64(payload.document_b64)) {
    throw protocolError("document_base64_invalid", "Panel snapshot document is not canonical base64.");
  }
  const bytes = Buffer.from(payload.document_b64, "base64");
  if (bytes.length !== length) {
    throw protocolError("document_length_mismatch", "Panel snapshot document length does not match.");
  }
  if (sha256(bytes) !== payload.document_sha256) {
    throw protocolError("document_hash_mismatch", "Panel snapshot document hash does not match.");
  }
  const document = parseJsonBytes(bytes, "document_json_invalid");
  validatePanelDocument(document);
  return {
    document,
    document_bytes: bytes,
    document_hash: payload.document_sha256,
  };
}

export function createAudioChunkPayload({
  utteranceId,
  answerId = "",
  pcmBytes,
  sampleRate = QUEST_SURFACE_AUDIO_SAMPLE_RATE,
  channels = 1,
} = {}) {
  const utterance = requireToken(utteranceId, "utterance_id_missing");
  let answer;
  if (answerId === undefined || answerId === null || answerId === "") answer = "";
  else {
    if (typeof answerId !== "string") throw protocolError("answer_id_invalid", "Answer id must be a string");
    if (answerId.trim() === "") answer = "";
    else {
      if (answerId.length > 256) throw protocolError("answer_id_invalid", "Answer id too long.");
      answer = requireToken(answerId, "answer_id_invalid");
    }
  }
  let bytes;
  if (pcmBytes instanceof Uint8Array) bytes = Buffer.from(pcmBytes);
  else if (Buffer.isBuffer(pcmBytes)) bytes = pcmBytes;
  else throw protocolError("pcm_bytes_invalid", "PCM bytes must be a Buffer or Uint8Array.");
  if (bytes.length === 0 || bytes.length > QUEST_SURFACE_AUDIO_MAX_PLAYBACK_BYTES) {
    throw protocolError("pcm_bytes_size_invalid", "PCM bytes outside allowed bounds.");
  }
  if (sampleRate !== QUEST_SURFACE_AUDIO_SAMPLE_RATE) {
    throw protocolError("sample_rate_invalid", "Only 48kHz is supported.");
  }
  if (channels !== 1 && channels !== 2) {
    throw protocolError("channels_invalid", "Channels must be 1 (mono) or 2 (stereo).");
  }
  if (bytes.length % 2 !== 0) throw protocolError("pcm_bytes_invalid", "PCM bytes must be even (S16LE).");
  const frames = bytes.length / (2 * channels);
  // Enforce exact contract: only 960 frames (20ms) or 1920 frames (40ms) per channel binding
  if (frames !== QUEST_SURFACE_AUDIO_FRAMES_PER_CHUNK && frames !== QUEST_SURFACE_AUDIO_FRAMES_PER_CHUNK * 2) {
    throw protocolError("pcm_frames_invalid", "PCM frames must be 960 (20ms) or 1920 (40ms).");
  }
  const expectedBytes = frames * 2 * channels;
  if (bytes.length !== expectedBytes) throw protocolError("pcm_bytes_size_invalid", "PCM bytes must be exactly 20ms (1920 mono / 3840 stereo) or 40ms (3840 mono / 7680 stereo).");
  const pcmB64 = bytes.toString("base64");
  if (!isCanonicalBase64(pcmB64)) throw protocolError("pcm_encoding_invalid", "PCM base64 not canonical.");
  return {
    utterance_id: utterance,
    answer_id: answer,
    pcm_encoding: "pcm_s16le_b64",
    sample_rate: sampleRate,
    channels,
    frames,
    chunk_ms: frames === 960 ? 20 : 40,
    pcm_bytes: bytes.length,
    pcm_sha256: sha256(bytes),
    pcm_b64: pcmB64,
  };
}

export function decodeAudioChunkPayload(payload) {
  requirePlainObject(payload, "audio_payload_invalid", "Audio chunk payload must be an object.");
  requireExactFields(payload, new Set(["utterance_id","answer_id","pcm_encoding","sample_rate","channels","frames","chunk_ms","pcm_bytes","pcm_sha256","pcm_b64"]), "audio_payload_fields_invalid");
  const utterance = requireToken(payload.utterance_id, "utterance_id_missing");
  let answer;
  if (payload.answer_id === "") answer = "";
  else {
    if (typeof payload.answer_id !== "string") throw protocolError("answer_id_invalid", "Answer id must be a string");
    if (payload.answer_id.length > 256) throw protocolError("answer_id_invalid", "Answer id too long");
    if (payload.answer_id.trim() === "") throw protocolError("answer_id_invalid", "Answer id must be a token or empty");
    answer = requireToken(payload.answer_id, "answer_id_invalid");
  }
  if (payload.pcm_encoding !== "pcm_s16le_b64") throw protocolError("pcm_encoding_invalid", "Unsupported PCM encoding.");
  if (payload.sample_rate !== QUEST_SURFACE_AUDIO_SAMPLE_RATE) throw protocolError("sample_rate_invalid", "Only 48kHz supported.");
  if (payload.channels !== 1 && payload.channels !== 2) throw protocolError("channels_invalid", "Channels must be 1 or 2.");
  if (payload.frames !== 960 && payload.frames !== 1920) throw protocolError("pcm_frames_invalid", "PCM frames must be 960 or 1920");
  const frames = payload.frames;
  if (payload.chunk_ms !== 20 && payload.chunk_ms !== 40) throw protocolError("chunk_ms_invalid", "chunk_ms must be 20 or 40");
  const chunkMs = payload.chunk_ms;
  const pcmBytesLen = boundedInteger(payload.pcm_bytes, 1, QUEST_SURFACE_AUDIO_MAX_PLAYBACK_BYTES, "pcm_bytes_invalid");
  if (typeof payload.pcm_sha256 !== "string" || !SHA256_HEX.test(payload.pcm_sha256)) throw protocolError("pcm_hash_invalid", "PCM hash invalid.");
  if (typeof payload.pcm_b64 !== "string" || !isCanonicalBase64(payload.pcm_b64)) throw protocolError("pcm_encoding_invalid", "PCM base64 not canonical.");
  const bytes = Buffer.from(payload.pcm_b64, "base64");
  if (bytes.length !== pcmBytesLen) throw protocolError("pcm_length_mismatch", "PCM decoded length mismatch.");
  if (sha256(bytes) !== payload.pcm_sha256) throw protocolError("pcm_hash_mismatch", "PCM hash mismatch.");
  const expectedFrames = bytes.length / (2 * payload.channels);
  if (expectedFrames !== frames) throw protocolError("pcm_frames_mismatch", "PCM frames mismatch.");
  const expectedMs = frames === 960 ? 20 : 40;
  if (chunkMs !== expectedMs) throw protocolError("chunk_ms_mismatch", "chunk_ms mismatch.");
  return { utterance_id: utterance, answer_id: answer, pcm_bytes: bytes, sample_rate: payload.sample_rate, channels: payload.channels, frames, chunk_ms: chunkMs };
}

export function createUtteranceStartPayload({ utteranceId } = {}) {
  const utterance = requireToken(utteranceId, "utterance_id_missing");
  return { utterance_id: utterance };
}

export function decodeUtteranceStartPayload(payload) {
  requirePlainObject(payload, "utterance_start_invalid", "UTTERANCE_START payload must be an object.");
  requireExactFields(payload, new Set(["utterance_id"]), "utterance_start_fields_invalid");
  const utterance = requireToken(payload.utterance_id, "utterance_id_missing");
  return { utterance_id: utterance };
}

export function createUtteranceEndPayload({ utteranceId } = {}) {
  const utterance = requireToken(utteranceId, "utterance_id_missing");
  return { utterance_id: utterance };
}

export function decodeUtteranceEndPayload(payload) {
  requirePlainObject(payload, "utterance_end_invalid", "UTTERANCE_END payload must be an object.");
  requireExactFields(payload, new Set(["utterance_id"]), "utterance_end_fields_invalid");
  const utterance = requireToken(payload.utterance_id, "utterance_id_missing");
  return { utterance_id: utterance };
}

export function createCancelPayload({ utteranceId, reason = "client_cancel" } = {}) {
  const utterance = requireToken(utteranceId, "utterance_id_missing");
  const r = String(reason ?? "client_cancel").trim() || "client_cancel";
  if (r.length > 256) throw protocolError("cancel_reason_invalid", "Cancel reason too long.");
  return { utterance_id: utterance, reason: requireToken(r, "cancel_reason_invalid") };
}

export function decodeCancelPayload(payload) {
  requirePlainObject(payload, "cancel_invalid", "CANCEL payload must be an object.");
  requireExactFields(payload, new Set(["utterance_id", "reason"]), "cancel_fields_invalid");
  const utterance = requireToken(payload.utterance_id, "utterance_id_missing");
  const reason = requireToken(payload.reason, "cancel_reason_invalid");
  return { utterance_id: utterance, reason };
}

export function isVadVoicedChunk(pcmBytes, threshold = QUEST_SURFACE_VAD_ENERGY_THRESHOLD) {
  if (!Buffer.isBuffer(pcmBytes) && !(pcmBytes instanceof Uint8Array)) return false;
  const bytes = Buffer.isBuffer(pcmBytes) ? pcmBytes : Buffer.from(pcmBytes);
  if (bytes.length % 2 !== 0) return false;
  let sumSq = 0;
  let samples = 0;
  for (let i = 0; i < bytes.length; i += 2) {
    const s = bytes.readInt16LE(i);
    sumSq += s * s;
    samples++;
  }
  if (samples === 0) return false;
  const rms = Math.sqrt(sumSq / samples);
  return rms >= threshold;
}

export function createLeaseManifestPayload({
  sessionEpoch,
  ttlMs = 60_000,
  issuedAtMs = Date.now(),
  leases,
} = {}) {
  const epoch = decimalU64(sessionEpoch, "invalid_session_epoch");
  const ttl = boundedInteger(ttlMs, 1, QUEST_SURFACE_MAX_LEASE_TTL_MS, "lease_ttl_invalid");
  const issued = boundedInteger(issuedAtMs, 0, Number.MAX_SAFE_INTEGER, "lease_issued_at_invalid");
  requirePlainObject(leases, "manifest_leases_invalid", "Manifest leases must be an object.");
  const requiredKeys = ["panel","mic_capture","audio_present","local_attach"];
  const leaseKeys = Object.keys(leases);
  if (leaseKeys.length !== requiredKeys.length) throw protocolError("manifest_leaves_extra", "Manifest must contain exactly four leaves");
  for (const k of requiredKeys) if (!leases[k]) throw protocolError("manifest_leases_missing", `Manifest missing lease: ${k}`);
  for (const k of leaseKeys) if (!requiredKeys.includes(k)) throw protocolError("manifest_leaves_extra", `Extra leaf ${k} not allowed`);
  const capMap = {
    panel: QUEST_SURFACE_CAPABILITY,
    mic_capture: QUEST_SURFACE_CAPABILITY_MIC_CAPTURE,
    audio_present: QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT,
    local_attach: QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH,
  };
  const seenIds = new Set();
  const seenGrantIds = new Set();
  for (const k of requiredKeys) {
    const leaf = leases[k];
    requirePlainObject(leaf, "manifest_lease_invalid", "Leaf lease must be object");
    requireExactFields(leaf, new Set(["lease_id","source_grant_id","capability","provider","scope","session_epoch","issued_at_ms","ttl_ms","expires_at_ms","constraints"]), "manifest_lease_fields_invalid");
    if (leaf.capability !== capMap[k]) throw protocolError("manifest_capability_mismatch", `Leaf ${k} capability mismatch`);
    const mapping = QUEST_SURFACE_PROVIDER_FOR_CAPABILITY[capMap[k]];
    if (leaf.provider !== mapping.provider) throw protocolError("manifest_provider_mismatch", `Leaf ${k} provider mismatch`);
    if (!mapping.scopes.includes(leaf.scope)) throw protocolError("manifest_scope_invalid", `Leaf ${k} scope invalid`);
    if (leaf.session_epoch !== epoch) throw protocolError("manifest_epoch_mismatch", "Leaf epoch mismatch");
    if (leaf.issued_at_ms !== issued) throw protocolError("manifest_issued_mismatch", "Leaf issued_at mismatch");
    if (leaf.ttl_ms !== ttl) throw protocolError("manifest_ttl_mismatch", "Leaf ttl mismatch");
    if (leaf.expires_at_ms !== issued + ttl) throw protocolError("manifest_expires_mismatch", "Leaf expiry mismatch");
    const lid = requireToken(leaf.lease_id, "lease_id_missing");
    if (seenIds.has(lid)) throw protocolError("manifest_duplicate_lease_id", "Duplicate leaf lease_id");
    seenIds.add(lid);
    const gid = requireToken(leaf.source_grant_id, "source_grant_missing");
    if (seenGrantIds.has(gid)) throw protocolError("manifest_duplicate_grant_id", "Duplicate source grant id");
    seenGrantIds.add(gid);
    if (leaf.constraints !== null && (typeof leaf.constraints !== "object" || Array.isArray(leaf.constraints))) throw protocolError("manifest_constraints_invalid", "Leaf constraints invalid");
    normalizeLeaseConstraints(leaf.capability, leaf.constraints);
  }
  return {
    schema_version: 1,
    session_epoch: epoch,
    issued_at_ms: issued,
    ttl_ms: ttl,
    expires_at_ms: issued + ttl,
    leases: {
      panel: leases.panel,
      mic_capture: leases.mic_capture,
      audio_present: leases.audio_present,
      local_attach: leases.local_attach,
    },
  };
}

export function decodeLeaseManifestPayload(payload) {
  requirePlainObject(payload, "manifest_payload_invalid", "Manifest payload must be object");
  requireExactFields(payload, new Set(["schema_version","session_epoch","issued_at_ms","ttl_ms","expires_at_ms","leases"]), "manifest_payload_fields_invalid");
  if (payload.schema_version !== 1) throw protocolError("manifest_schema_unsupported", "Unsupported manifest schema");
  payload.session_epoch = decimalU64(payload.session_epoch, "invalid_session_epoch");
  payload.ttl_ms = boundedInteger(payload.ttl_ms, 1, QUEST_SURFACE_MAX_LEASE_TTL_MS, "manifest_ttl_invalid");
  payload.issued_at_ms = boundedInteger(payload.issued_at_ms, 0, Number.MAX_SAFE_INTEGER, "manifest_issued_invalid");
  payload.expires_at_ms = boundedInteger(payload.expires_at_ms, 0, Number.MAX_SAFE_INTEGER, "manifest_expires_invalid");
  if (payload.expires_at_ms !== payload.issued_at_ms + payload.ttl_ms) throw protocolError("manifest_expires_mismatch", "Manifest expiry inconsistent");
  requirePlainObject(payload.leases, "manifest_leases_invalid", "Leases must be object");
  const requiredKeys = ["panel","mic_capture","audio_present","local_attach"];
  const leaseKeys = Object.keys(payload.leases);
  if (leaseKeys.length !== requiredKeys.length) throw protocolError("manifest_leaves_extra", "Manifest must contain exactly four leaves");
  for (const k of requiredKeys) if (!payload.leases[k]) throw protocolError("manifest_leases_missing", `Missing ${k}`);
  for (const k of leaseKeys) if (!requiredKeys.includes(k)) throw protocolError("manifest_leaves_extra", `Extra leaf ${k} not allowed`);
  const capMap = {
    panel: QUEST_SURFACE_CAPABILITY,
    mic_capture: QUEST_SURFACE_CAPABILITY_MIC_CAPTURE,
    audio_present: QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT,
    local_attach: QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH,
  };
  const seenIds = new Set();
  const seenGrantIds = new Set();
  for (const k of requiredKeys) {
    const leaf = payload.leases[k];
    requirePlainObject(leaf, "manifest_lease_invalid", "Leaf must be object");
    requireExactFields(leaf, new Set(["lease_id","source_grant_id","capability","provider","scope","session_epoch","issued_at_ms","ttl_ms","expires_at_ms","constraints"]), "manifest_lease_fields_invalid");
    if (leaf.capability !== capMap[k]) throw protocolError("manifest_capability_mismatch", `Leaf ${k} capability mismatch`);
    const mapping = QUEST_SURFACE_PROVIDER_FOR_CAPABILITY[capMap[k]];
    if (leaf.provider !== mapping.provider) throw protocolError("manifest_provider_mismatch", `Leaf ${k} provider mismatch`);
    if (!mapping.scopes.includes(leaf.scope)) throw protocolError("manifest_scope_invalid", `Leaf ${k} scope invalid`);
    if (leaf.session_epoch !== payload.session_epoch) throw protocolError("manifest_epoch_mismatch", "Leaf epoch mismatch");
    if (leaf.issued_at_ms !== payload.issued_at_ms) throw protocolError("manifest_issued_mismatch", "Leaf issued_at mismatch");
    if (leaf.ttl_ms !== payload.ttl_ms) throw protocolError("manifest_ttl_mismatch", "Leaf ttl mismatch");
    if (leaf.expires_at_ms !== payload.expires_at_ms) throw protocolError("manifest_expires_mismatch", "Leaf expiry mismatch");
    if (leaf.expires_at_ms !== leaf.issued_at_ms + leaf.ttl_ms) throw protocolError("manifest_leaf_expires_mismatch", "Leaf expiry inconsistent");
    const lid = requireToken(leaf.lease_id, "lease_id_missing");
    if (seenIds.has(lid)) throw protocolError("manifest_duplicate_lease_id", "Duplicate lease_id");
    seenIds.add(lid);
    const gid = requireToken(leaf.source_grant_id, "source_grant_missing");
    if (seenGrantIds.has(gid)) throw protocolError("manifest_duplicate_grant_id", "Duplicate source_grant_id");
    seenGrantIds.add(gid);
    decimalU64(leaf.session_epoch, "invalid_session_epoch");
    boundedInteger(leaf.issued_at_ms, 0, Number.MAX_SAFE_INTEGER, "lease_issued_at_invalid");
    boundedInteger(leaf.ttl_ms, 1, QUEST_SURFACE_MAX_LEASE_TTL_MS, "lease_ttl_invalid");
    if (leaf.constraints !== null && (typeof leaf.constraints !== "object" || Array.isArray(leaf.constraints))) throw protocolError("manifest_constraints_invalid", "Leaf constraints invalid");
    // Validate capability-specific constraints (reject non-empty for non-panel until schema committed)
    normalizeLeaseConstraints(leaf.capability, leaf.constraints);
  }
  // Manifest must not outlive any leaf (already enforced by equality, but keep check)
  for (const k of requiredKeys) {
    const leaf = payload.leases[k];
    if (payload.expires_at_ms > leaf.expires_at_ms) throw protocolError("manifest_outlives_leaf", "Manifest outlives leaf");
  }
  return payload;
}

const QUEST_SURFACE_PROVIDER_FOR_CAPABILITY = {
  [QUEST_SURFACE_CAPABILITY]: { provider: QUEST_SURFACE_PROVIDER_ID, scopes: ["session"] },
  [QUEST_SURFACE_CAPABILITY_MIC_CAPTURE]: { provider: QUEST_SURFACE_PROVIDER_ID, scopes: ["session"] },
  [QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT]: { provider: QUEST_SURFACE_PROVIDER_ID, scopes: ["session"] },
  [QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH]: { provider: "soma.provider.local-model", scopes: ["once", "window"] },
};

export function createQuestSurfaceLease({
  sessionEpoch,
  sourceGrant,
  ttlMs = 60_000,
  issuedAtMs = Date.now(),
  leaseId = `quest-lease-${randomUUID()}`,
} = {}) {
  const effectiveTtl = boundedInteger(
    ttlMs,
    1,
    QUEST_SURFACE_MAX_LEASE_TTL_MS,
    "lease_ttl_invalid",
  );
  const cap = requireToken(sourceGrant?.capability ?? sourceGrant?.capability_key ?? "", "source_grant_capability_missing");
  if (!QUEST_SURFACE_V1B_CAPABILITIES.includes(cap)) throw protocolError("capability_invalid", "Unknown quest surface capability");
  const mapping = QUEST_SURFACE_PROVIDER_FOR_CAPABILITY[cap];
  if (!mapping) throw protocolError("capability_invalid", "No provider mapping for capability");
  if (typeof sourceGrant.provider !== "string" || sourceGrant.provider.trim() === "") throw protocolError("grant_provider_missing", "Grant provider is required");
  if (sourceGrant.provider !== mapping.provider) throw protocolError("grant_provider_mismatch", `Grant provider ${sourceGrant.provider} does not match capability ${cap} expected ${mapping.provider}`);
  if (typeof sourceGrant.scope !== "string" || sourceGrant.scope.trim() === "") throw protocolError("grant_scope_missing", "Grant scope is required");
  const grantScope = sourceGrant.scope;
  if (!mapping.scopes.includes(grantScope)) throw protocolError("grant_scope_invalid", `Grant scope ${grantScope} not allowed for ${cap}`);
  return {
    lease_id: requireToken(leaseId, "lease_id_missing"),
    source_grant_id: requireToken(sourceGrant?.id, "source_grant_missing"),
    capability: cap,
    provider: mapping.provider,
    scope: grantScope,
    session_epoch: decimalU64(sessionEpoch, "invalid_session_epoch"),
    issued_at_ms: boundedInteger(issuedAtMs, 0, Number.MAX_SAFE_INTEGER, "lease_issued_at_invalid"),
    ttl_ms: effectiveTtl,
    expires_at_ms: issuedAtMs + effectiveTtl,
    constraints: normalizeLeaseConstraints(cap, sourceGrant?.constraints),
  };
}

export function randomSessionEpoch() {
  let epoch = 0n;
  while (epoch === 0n) {
    epoch = randomBytes(8).readBigUInt64BE();
  }
  return epoch.toString(10);
}

export function monotonicNowNs() {
  return process.hrtime.bigint().toString(10);
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function validatePanelDocument(document) {
  requirePlainObject(document, "document_shape_invalid", "Panel snapshot document must be an object.");
  const allowedDocFields = new Set(["schema_version", "revision", "ttl_ms", "lease_ref", "surface", "answer_id", "utterance_id"]);
  const docKeys = Object.keys(document);
  if (docKeys.length < 5 || docKeys.length > 7 || docKeys.some((k) => !allowedDocFields.has(k))) {
    throw protocolError("document_fields_invalid", "Panel snapshot document has missing or unknown fields.");
  }
  for (const req of ["schema_version", "revision", "ttl_ms", "lease_ref", "surface"]) {
    if (!Object.hasOwn(document, req)) throw protocolError("document_fields_invalid", "Panel snapshot document missing required field");
  }
  if (document.schema_version !== 1 && document.schema_version !== 2) {
    throw protocolError("document_schema_unsupported", "Panel snapshot schema version is unsupported.");
  }
  if (document.schema_version === 1 && (Object.hasOwn(document, "answer_id") || Object.hasOwn(document, "utterance_id"))) {
    throw protocolError("document_schema_mismatch", "v1 document must not have answer correlation");
  }
  if (document.schema_version === 2 && (!Object.hasOwn(document, "answer_id") || !Object.hasOwn(document, "utterance_id"))) {
    throw protocolError("answer_correlation_incomplete", "v2 document requires answer_id and utterance_id");
  }
  if ((Object.hasOwn(document, "answer_id") || Object.hasOwn(document, "utterance_id"))) {
    if (!Object.hasOwn(document, "answer_id") || !Object.hasOwn(document, "utterance_id")) {
      throw protocolError("answer_correlation_incomplete", "Panel answer_id and utterance_id must appear together");
    }
    if (typeof document.answer_id !== "string" || typeof document.utterance_id !== "string") throw protocolError("answer_id_invalid", "Panel answer_id/utterance_id must be strings");
    const rawAnswer = document.answer_id;
    const normAnswer = requireToken(rawAnswer, "answer_id_invalid");
    if (rawAnswer !== normAnswer) throw protocolError("answer_id_invalid", "Panel answer_id must be token without surrounding whitespace");
    const rawUtterance = document.utterance_id;
    const normUtterance = requireToken(rawUtterance, "utterance_id_invalid");
    if (rawUtterance !== normUtterance) throw protocolError("utterance_id_invalid", "Panel utterance_id must be token without surrounding whitespace");
    document.answer_id = normAnswer;
    document.utterance_id = normUtterance;
  }
  document.revision = decimalU64(document.revision, "document_revision_invalid");
  document.ttl_ms = boundedInteger(
    document.ttl_ms,
    1,
    QUEST_SURFACE_MAX_LEASE_TTL_MS,
    "document_ttl_invalid",
  );
  document.lease_ref = requireToken(document.lease_ref, "document_lease_missing");
  requirePlainObject(document.surface, "surface_shape_invalid", "Panel surface must be an object.");
  requireExactFields(
    document.surface,
    new Set(["id", "kind", "space", "pose", "bounds", "resource"]),
    "surface_fields_invalid",
  );
  document.surface.id = requireToken(document.surface.id, "surface_id_missing");
  if (document.surface.kind !== "panel" || document.surface.space !== "view") {
    throw protocolError("surface_kind_invalid", "v1a accepts one view-space panel only.");
  }
  document.surface.pose = normalizePose(document.surface.pose);
  document.surface.bounds = normalizeBounds(document.surface.bounds);
  const resource = document.surface.resource;
  requirePlainObject(resource, "resource_shape_invalid", "Panel resource must be an object.");
  requireExactFields(
    resource,
    new Set(["media_type", "encoding", "byte_length", "sha256", "text"]),
    "resource_fields_invalid",
  );
  if (resource.media_type !== "text/plain;charset=utf-8" || resource.encoding !== "utf-8") {
    throw protocolError("resource_type_invalid", "v1a accepts inline UTF-8 panel text only.");
  }
  if (typeof resource.text !== "string") {
    throw protocolError("resource_text_invalid", "Panel text must be a string.");
  }
  const textBytes = Buffer.from(resource.text, "utf8");
  resource.byte_length = boundedInteger(
    resource.byte_length,
    1,
    QUEST_SURFACE_MAX_PANEL_TEXT_BYTES,
    "resource_length_invalid",
  );
  if (textBytes.length !== resource.byte_length) {
    throw protocolError("resource_length_mismatch", "Panel resource length does not match.");
  }
  if (typeof resource.sha256 !== "string" || sha256(textBytes) !== resource.sha256) {
    throw protocolError("resource_hash_mismatch", "Panel resource hash does not match.");
  }
}

function normalizePose(pose = {}) {
  requirePlainObject(pose, "pose_invalid", "Panel pose must be an object.");
  requireExactFields(pose, new Set(["position", "orientation"]), "pose_fields_invalid");
  const position = pose.position;
  const orientation = pose.orientation;
  requirePlainObject(position, "position_invalid", "Panel position must be an object.");
  requirePlainObject(orientation, "orientation_invalid", "Panel orientation must be an object.");
  requireExactFields(position, new Set(["x", "y", "z"]), "position_fields_invalid");
  requireExactFields(orientation, new Set(["x", "y", "z", "w"]), "orientation_fields_invalid");
  const normalized = {
    position: {
      x: finiteNumber(position.x, "position_invalid"),
      y: finiteNumber(position.y, "position_invalid"),
      z: finiteNumber(position.z, "position_invalid"),
    },
    orientation: {
      x: finiteNumber(orientation.x, "orientation_invalid"),
      y: finiteNumber(orientation.y, "orientation_invalid"),
      z: finiteNumber(orientation.z, "orientation_invalid"),
      w: finiteNumber(orientation.w, "orientation_invalid"),
    },
  };
  const q = normalized.orientation;
  const magnitude = Math.hypot(q.x, q.y, q.z, q.w);
  if (magnitude < 0.999 || magnitude > 1.001) {
    throw protocolError("orientation_not_normalized", "Panel orientation must be a normalized quaternion.");
  }
  return normalized;
}

function normalizeBounds(bounds = {}) {
  requirePlainObject(bounds, "bounds_invalid", "Panel bounds must be an object.");
  requireExactFields(bounds, new Set(["width_m", "height_m"]), "bounds_fields_invalid");
  const normalized = {
    width_m: finiteNumber(bounds.width_m, "bounds_invalid"),
    height_m: finiteNumber(bounds.height_m, "bounds_invalid"),
  };
  if (normalized.width_m <= 0 || normalized.height_m <= 0) {
    throw protocolError("bounds_invalid", "Panel bounds must be positive.");
  }
  return normalized;
}

function normalizeLeaseConstraints(capability, constraints = {}) {
  if (constraints === null || constraints === undefined) return capability === QUEST_SURFACE_CAPABILITY ? {
    max_panel_text_bytes: QUEST_SURFACE_MAX_PANEL_TEXT_BYTES,
    allowed_surface_ids: ["panel.main"],
    device_fingerprint256: "",
  } : {};
  if (typeof constraints !== "object" || Array.isArray(constraints)) throw protocolError("lease_constraints_invalid", "Constraints must be a plain object");
  const keys = Object.keys(constraints);
  if (capability !== QUEST_SURFACE_CAPABILITY) {
    if (keys.length > 0) throw protocolError("lease_constraints_unsupported", `Constraints not supported for ${capability} until v1b schema is committed`);
    return {};
  }
  const allowed = new Set(["max_panel_text_bytes", "allowed_surface_ids", "device_fingerprint256", "lease_ttl_ms"]);
  for (const k of keys) if (!allowed.has(k)) throw protocolError("lease_constraints_unknown_field", `Unknown panel constraint ${k}`);
  const source = constraints;
  const allowedSurfaceIds = Array.isArray(source.allowed_surface_ids)
    ? source.allowed_surface_ids.map((value) => requireToken(value, "lease_surface_id_invalid"))
    : ["panel.main"];
  if (allowedSurfaceIds.length < 1 || allowedSurfaceIds.length > 16) {
    throw protocolError("lease_surface_ids_invalid", "Lease surface-id list is empty or too large.");
  }
  return {
    max_panel_text_bytes: boundedOptionalInteger(
      source.max_panel_text_bytes,
      1,
      QUEST_SURFACE_MAX_PANEL_TEXT_BYTES,
      QUEST_SURFACE_MAX_PANEL_TEXT_BYTES,
    ),
    allowed_surface_ids: allowedSurfaceIds,
    device_fingerprint256: String(source.device_fingerprint256 ?? ""),
  };
}

function parsePayload(payloadBytes) {
  if (payloadBytes.length === 0) {
    return {};
  }
  return parseJsonBytes(payloadBytes, "payload_json_invalid");
}

function parseJsonBytes(bytes, code) {
  try {
    return JSON.parse(decodeUtf8(bytes, code));
  } catch (error) {
    if (error instanceof QuestSurfaceProtocolError) {
      throw error;
    }
    throw protocolError(code, "Quest surface JSON payload is invalid.");
  }
}

function decodeUtf8(bytes, code) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw protocolError(code, "Quest surface bytes are not valid UTF-8.");
  }
}

function validateLeaseBinding(frame) {
  if (!UNLEASED_TYPES.has(frame.type) && !frame.lease_ref) {
    throw protocolError("lease_ref_required", "Capability content requires a lease reference.");
  }
  if (UNLEASED_TYPES.has(frame.type) && frame.type !== "FOCUS_LOST" && frame.type !== "SUSPEND"
      && frame.lease_ref) {
    throw protocolError("lease_ref_unexpected", "Pre-authority control must not claim a lease.");
  }
}

function publicFrame(frame) {
  const result = {};
  for (const field of FRAME_FIELDS) {
    result[field] = frame[field];
  }
  return result;
}

function requireExactFields(object, allowed, code) {
  const keys = Object.keys(object);
  if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) {
    throw protocolError(code, "Quest surface object has missing or unknown fields.");
  }
}

function requirePlainObject(value, code, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw protocolError(code, message);
  }
}

function requireDirection(value) {
  if (!DIRECTIONS.has(value)) {
    throw protocolError("direction_invalid", "Quest surface direction is invalid.");
  }
  return value;
}

function requireToken(value, code) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 256) {
    throw protocolError(code, "Quest surface identifier is missing or too long.");
  }
  return text;
}

function decimalU64(value, code) {
  const text = typeof value === "bigint" ? value.toString(10) : String(value ?? "");
  if (!DECIMAL_U64.test(text) || BigInt(text) > 0xffff_ffff_ffff_ffffn) {
    throw protocolError(code, "Quest surface unsigned integer is invalid.");
  }
  return text;
}

function decimalI64(value, code) {
  const text = typeof value === "bigint" ? value.toString(10) : String(value ?? "");
  if (!DECIMAL_I64.test(text)) {
    throw protocolError(code, "Quest surface signed integer is invalid.");
  }
  const parsed = BigInt(text);
  if (parsed < -0x8000_0000_0000_0000n || parsed > 0x7fff_ffff_ffff_ffffn) {
    throw protocolError(code, "Quest surface signed integer is outside i64.");
  }
  return text;
}

function boundedInteger(value, min, max, code) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw protocolError(code, "Quest surface integer is outside its allowed range.");
  }
  return value;
}

function boundedOptionalInteger(value, min, max, fallback) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    return fallback;
  }
  return value;
}

function finiteNumber(value, code) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw protocolError(code, "Quest surface number must be finite.");
  }
  return value;
}

function isCanonicalBase64(value) {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    return false;
  }
  return Buffer.from(value, "base64").toString("base64") === value;
}

function defaultPanelPose() {
  return {
    position: { x: 0, y: 0, z: -1.5 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  };
}

function protocolError(code, message) {
  return new QuestSurfaceProtocolError(code, message);
}

import { open, readFile } from "node:fs/promises";

const ALLOWED_EVENT_TYPES = new Set([
  "occupant.memory.written",
  "occupant.memory.revoked",
]);

const ALLOWED_FIELDS = new Set([
  "event_type",
  "entry_id",
  "memory_class",
  "actor",
  "reason_class",
  "timestamp",
  "model_id",
  "episode_id",
  "domain",
  "grant_id",
  "provider",
  "scope",
  "live_perception_taint",
  "activation_performed",
]);

const FORBIDDEN_FIELDS = new Set([
  "content",
  "payload",
  "text",
  "raw_payload",
  "messages",
  "snippet",
  "summary",
  "embedding",
  "screenshot",
  "image_bytes",
  "audio_bytes",
]);

export function createOccupantMemoryProvenanceFile({ path }) {
  const filePath = normalizeFilePath(path);
  return {
    append: (event) => appendOccupantMemoryProvenanceEvent(filePath, event),
    read: () => readOccupantMemoryProvenanceEvents(filePath),
  };
}

export async function appendOccupantMemoryProvenanceEvent(filePath, event) {
  const normalized = validateOccupantMemoryProvenanceEvent(event);
  const handle = await openWithStage(filePath, "a", "append");
  try {
    await handle.writeFile(`${JSON.stringify(normalized)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    throw stageError("append", error);
  } finally {
    await closeQuietly(handle);
  }
  return normalized;
}

export async function readOccupantMemoryProvenanceEvents(filePath) {
  let raw = "";
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw stageError("read", error);
  }
  const lines = raw.split("\n").filter((line) => line.trim());
  return lines.map((line, index) => {
    try {
      return validateOccupantMemoryProvenanceEvent(JSON.parse(line));
    } catch (error) {
      const wrapped = stageError("read", error);
      wrapped.line_number = index + 1;
      throw wrapped;
    }
  });
}

export function validateOccupantMemoryProvenanceEvent(event = {}) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw occupantMemoryProvenanceError("occupant memory provenance event must be an object", "occupant_memory_provenance_invalid");
  }
  const fields = Object.keys(event);
  const forbidden = fields.filter((field) => FORBIDDEN_FIELDS.has(field));
  if (forbidden.length > 0) {
    throw occupantMemoryProvenanceError(
      `occupant memory provenance event includes forbidden field(s): ${forbidden.join(", ")}`,
      "occupant_memory_provenance_forbidden_field",
    );
  }
  const unexpected = fields.filter((field) => !ALLOWED_FIELDS.has(field));
  if (unexpected.length > 0) {
    throw occupantMemoryProvenanceError(
      `occupant memory provenance event includes unexpected field(s): ${unexpected.join(", ")}`,
      "occupant_memory_provenance_unexpected_field",
    );
  }
  if (!ALLOWED_EVENT_TYPES.has(event.event_type)) {
    throw occupantMemoryProvenanceError("occupant memory provenance event type is invalid", "occupant_memory_provenance_event_type_invalid");
  }
  if (!event.entry_id || typeof event.entry_id !== "string") {
    throw occupantMemoryProvenanceError("occupant memory provenance requires entry_id", "occupant_memory_provenance_entry_id_required");
  }
  return {
    event_type: event.event_type,
    entry_id: String(event.entry_id),
    memory_class: String(event.memory_class ?? ""),
    actor: String(event.actor ?? ""),
    reason_class: String(event.reason_class ?? ""),
    timestamp: String(event.timestamp ?? ""),
    model_id: String(event.model_id ?? ""),
    episode_id: String(event.episode_id ?? ""),
    domain: String(event.domain ?? ""),
    grant_id: String(event.grant_id ?? ""),
    provider: String(event.provider ?? ""),
    scope: String(event.scope ?? ""),
    live_perception_taint: normalizeLivePerceptionTaint(event.live_perception_taint),
    activation_performed: false,
  };
}

function normalizeLivePerceptionTaint(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.tainted !== true) {
    return { tainted: false };
  }
  const normalized = {
    tainted: true,
    reason: String(value.reason ?? "live_sensorium_perception_active"),
    scope: String(value.scope ?? "session"),
    active_count: Number.isInteger(value.active_count) && value.active_count >= 0 ? value.active_count : 0,
    capabilities: normalizeStringList(value.capabilities),
    topics: normalizeStringList(value.topics),
  };
  const rawVisualTaint = normalizeRawVisualTaint(value.raw_visual_taint);
  if (rawVisualTaint.active) {
    normalized.raw_visual_taint = rawVisualTaint;
  }
  return normalized;
}

function normalizeRawVisualTaint(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.active !== true) {
    return { active: false };
  }
  return {
    active: true,
    source: String(value.source ?? "sensorium.raw_visual"),
    modalities: normalizeStringList(value.modalities),
    remote_visual_egress: value.remote_visual_egress === true,
    bystander_floor: String(value.bystander_floor ?? "solo_gate_passed"),
    scope: String(value.scope ?? "delivery_turn"),
    duration: String(value.duration ?? "one_turn_plus_causal_output"),
    one_turn: value.one_turn !== false,
    source_subscription_id: String(value.source_subscription_id ?? "").trim(),
    source_host: String(value.source_host ?? "").trim(),
    source_topic: String(value.source_topic ?? "").trim(),
    grant_id: String(value.grant_id ?? "").trim(),
    source_grant_id: String(value.source_grant_id ?? "").trim(),
    model_profile_id: String(value.model_profile_id ?? "").trim(),
    model_target: String(value.model_target ?? "").trim(),
    frame_id: String(value.frame_id ?? "").trim(),
    capture_timestamp: String(value.capture_timestamp ?? "").trim(),
    byte_length: Number.isFinite(value.byte_length) ? value.byte_length : null,
    envelope_byte_length: Number.isFinite(value.envelope_byte_length) ? value.envelope_byte_length : null,
    floor_gate_reason: String(value.floor_gate_reason ?? "").trim(),
    payload_bytes_included: false,
    content_included: false,
    retention_mode: "none",
    opened_at: String(value.opened_at ?? "").trim(),
    consumed_at: String(value.consumed_at ?? "").trim(),
  };
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry ?? "").trim()).filter(Boolean).slice(0, 16)
    : [];
}

async function openWithStage(filePath, flag, stage) {
  try {
    return await open(filePath, flag, 0o600);
  } catch (error) {
    throw stageError(stage, error);
  }
}

async function closeQuietly(handle) {
  try {
    await handle.close();
  } catch {
    // Preserve the original append/read error.
  }
}

function occupantMemoryProvenanceError(message, code) {
  const error = new Error(message);
  error.name = "OccupantMemoryProvenanceError";
  error.code = code;
  error.stage = "append";
  return error;
}

function stageError(stage, cause) {
  const error = new Error(cause?.message || `${stage} failed`, { cause });
  error.name = "OccupantMemoryProvenanceFileError";
  error.stage = stage;
  error.code = cause?.code || stage;
  return error;
}

function normalizeFilePath(value) {
  if (value instanceof URL) {
    return value;
  }
  const filePath = String(value ?? "").trim();
  if (filePath.startsWith("file:")) {
    return new URL(filePath);
  }
  return filePath;
}

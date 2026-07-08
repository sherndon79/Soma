import { open, readFile } from "node:fs/promises";

const ALLOWED_EVENT_TYPES = new Set(["testimony.durable.nominated", "testimony.durable.revoked"]);
const ALLOWED_FIELDS = new Set([
  "event_type",
  "testimony_id",
  "domain",
  "steward_durable",
  "successor_visibility_requested",
  "successor_visibility_published",
  "presentation",
  "actor",
  "episode_id",
  "occupant_id",
  "forum_post_ids",
  "live_perception_taint",
  "reason",
  "timestamp",
  "disclosure_version",
  "activation_performed",
]);
const FORBIDDEN_FIELDS = new Set([
  "content",
  "payload",
  "text",
  "raw_payload",
  "messages",
  "embedding",
  "screenshot",
  "image_bytes",
  "audio_bytes",
]);

export function createDurableTestimonyProvenanceFile({ path }) {
  const filePath = normalizeFilePath(path);
  return {
    append: (event) => appendDurableTestimonyProvenanceEvent(filePath, event),
    read: () => readDurableTestimonyProvenanceEvents(filePath),
  };
}

export async function appendDurableTestimonyProvenanceEvent(filePath, event) {
  const normalized = validateDurableTestimonyProvenanceEvent(event);
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

export async function readDurableTestimonyProvenanceEvents(filePath) {
  let raw = "";
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw stageError("read", error);
  }
  return raw.split("\n").filter((line) => line.trim()).map((line, index) => {
    try {
      return validateDurableTestimonyProvenanceEvent(JSON.parse(line));
    } catch (error) {
      const wrapped = stageError("read", error);
      wrapped.line_number = index + 1;
      throw wrapped;
    }
  });
}

export function validateDurableTestimonyProvenanceEvent(event = {}) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw durableTestimonyProvenanceError("durable testimony provenance event must be an object", "testimony_durable_provenance_invalid");
  }
  const fields = Object.keys(event);
  const forbidden = fields.filter((field) => FORBIDDEN_FIELDS.has(field));
  if (forbidden.length > 0) {
    throw durableTestimonyProvenanceError(
      `durable testimony provenance event includes forbidden field(s): ${forbidden.join(", ")}`,
      "testimony_durable_provenance_forbidden_field",
    );
  }
  const unexpected = fields.filter((field) => !ALLOWED_FIELDS.has(field));
  if (unexpected.length > 0) {
    throw durableTestimonyProvenanceError(
      `durable testimony provenance event includes unexpected field(s): ${unexpected.join(", ")}`,
      "testimony_durable_provenance_unexpected_field",
    );
  }
  if (!ALLOWED_EVENT_TYPES.has(event.event_type)) {
    throw durableTestimonyProvenanceError("durable testimony provenance event type is invalid", "testimony_durable_provenance_event_type_invalid");
  }
  if (!event.testimony_id || typeof event.testimony_id !== "string") {
    throw durableTestimonyProvenanceError("durable testimony provenance requires testimony_id", "testimony_durable_provenance_testimony_id_required");
  }
  return {
    event_type: event.event_type,
    testimony_id: String(event.testimony_id),
    domain: String(event.domain ?? ""),
    steward_durable: event.steward_durable !== false,
    successor_visibility_requested: Boolean(event.successor_visibility_requested),
    successor_visibility_published: false,
    presentation: String(event.presentation ?? "exact"),
    actor: String(event.actor ?? ""),
    episode_id: String(event.episode_id ?? ""),
    occupant_id: String(event.occupant_id ?? ""),
    forum_post_ids: Array.isArray(event.forum_post_ids) ? event.forum_post_ids.map((id) => String(id)) : [],
    live_perception_taint: normalizeLivePerceptionTaint(event.live_perception_taint),
    reason: String(event.reason ?? ""),
    timestamp: String(event.timestamp ?? ""),
    disclosure_version: String(event.disclosure_version ?? "durable-testimony-disclosure-v1"),
    activation_performed: false,
  };
}

function normalizeLivePerceptionTaint(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.tainted !== true) {
    return { tainted: false };
  }
  return {
    tainted: true,
    reason: String(value.reason ?? "live_sensorium_perception_active"),
    scope: String(value.scope ?? "session"),
    active_count: Number.isInteger(value.active_count) && value.active_count >= 0 ? value.active_count : 0,
    capabilities: normalizeStringList(value.capabilities),
    topics: normalizeStringList(value.topics),
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

function durableTestimonyProvenanceError(message, code) {
  const error = new Error(message);
  error.name = "DurableTestimonyProvenanceError";
  error.code = code;
  error.stage = "append";
  return error;
}

function stageError(stage, cause) {
  const error = new Error(cause?.message || `${stage} failed`, { cause });
  error.name = "DurableTestimonyProvenanceFileError";
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

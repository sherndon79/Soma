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
    activation_performed: false,
  };
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

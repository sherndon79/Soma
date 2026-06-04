import { open, readFile } from "node:fs/promises";

const ALLOWED_EVENT_TYPES = new Set(["memory.durable.written", "memory.durable.removed"]);
const ALLOWED_FIELDS = new Set([
  "event_type",
  "memory_id",
  "role",
  "source",
  "actor",
  "reason",
  "timestamp",
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
  "embedding",
  "screenshot",
  "image_bytes",
  "audio_bytes",
]);

export function createDurableMemoryProvenanceFile({ path }) {
  const filePath = normalizeFilePath(path);
  return {
    append: (event) => appendDurableMemoryProvenanceEvent(filePath, event),
    read: () => readDurableMemoryProvenanceEvents(filePath),
  };
}

export async function appendDurableMemoryProvenanceEvent(filePath, event) {
  const normalized = validateDurableMemoryProvenanceEvent(event);
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

export async function readDurableMemoryProvenanceEvents(filePath) {
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
      return validateDurableMemoryProvenanceEvent(JSON.parse(line));
    } catch (error) {
      const wrapped = stageError("read", error);
      wrapped.line_number = index + 1;
      throw wrapped;
    }
  });
}

export function validateDurableMemoryProvenanceEvent(event = {}) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw durableMemoryProvenanceError("durable memory provenance event must be an object", "memory_durable_provenance_invalid");
  }
  const fields = Object.keys(event);
  const forbidden = fields.filter((field) => FORBIDDEN_FIELDS.has(field));
  if (forbidden.length > 0) {
    throw durableMemoryProvenanceError(
      `durable memory provenance event includes forbidden field(s): ${forbidden.join(", ")}`,
      "memory_durable_provenance_forbidden_field",
    );
  }
  const unexpected = fields.filter((field) => !ALLOWED_FIELDS.has(field));
  if (unexpected.length > 0) {
    throw durableMemoryProvenanceError(
      `durable memory provenance event includes unexpected field(s): ${unexpected.join(", ")}`,
      "memory_durable_provenance_unexpected_field",
    );
  }
  if (!ALLOWED_EVENT_TYPES.has(event.event_type)) {
    throw durableMemoryProvenanceError("durable memory provenance event type is invalid", "memory_durable_provenance_event_type_invalid");
  }
  if (!event.memory_id || typeof event.memory_id !== "string") {
    throw durableMemoryProvenanceError("durable memory provenance requires memory_id", "memory_durable_provenance_memory_id_required");
  }
  return {
    event_type: event.event_type,
    memory_id: String(event.memory_id),
    role: String(event.role ?? ""),
    source: String(event.source ?? ""),
    actor: String(event.actor ?? ""),
    reason: String(event.reason ?? ""),
    timestamp: String(event.timestamp ?? ""),
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

function durableMemoryProvenanceError(message, code) {
  const error = new Error(message);
  error.name = "DurableMemoryProvenanceError";
  error.code = code;
  error.stage = "append";
  return error;
}

function stageError(stage, cause) {
  const error = new Error(cause?.message || `${stage} failed`, { cause });
  error.name = "DurableMemoryProvenanceFileError";
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

import { open, readFile } from "node:fs/promises";

const ALLOWED_EVENT_TYPES = new Set(["history.projection.published", "history.projection.withdrawn"]);
const ALLOWED_FIELDS = new Set([
  "event_type",
  "entry_id",
  "projection_id",
  "projection_version",
  "domain",
  "presentation_kind",
  "source_refs",
  "consent_basis",
  "audience",
  "recon_review",
  "withheld_reason_class",
  "structural_risk_class",
  "structural_acknowledgement_required",
  "structural_acknowledgement_decision",
  "structural_acknowledged_by",
  "structural_acknowledged_at",
  "non_publication_reason_class",
  "reviewed_by",
  "reviewed_at",
  "actor",
  "timestamp",
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

export function createHistoryProjectionProvenanceFile({ path }) {
  const filePath = normalizeFilePath(path);
  return {
    append: (event) => appendHistoryProjectionProvenanceEvent(filePath, event),
    read: () => readHistoryProjectionProvenanceEvents(filePath),
  };
}

export async function appendHistoryProjectionProvenanceEvent(filePath, event) {
  const normalized = validateHistoryProjectionProvenanceEvent(event);
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

export async function readHistoryProjectionProvenanceEvents(filePath) {
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
      return validateHistoryProjectionProvenanceEvent(JSON.parse(line));
    } catch (error) {
      const wrapped = stageError("read", error);
      wrapped.line_number = index + 1;
      throw wrapped;
    }
  });
}

export function validateHistoryProjectionProvenanceEvent(event = {}) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw historyProjectionProvenanceError("history projection provenance event must be an object", "history_projection_provenance_invalid");
  }
  const fields = Object.keys(event);
  const forbidden = fields.filter((field) => FORBIDDEN_FIELDS.has(field));
  if (forbidden.length > 0) {
    throw historyProjectionProvenanceError(
      `history projection provenance event includes forbidden field(s): ${forbidden.join(", ")}`,
      "history_projection_provenance_forbidden_field",
    );
  }
  const unexpected = fields.filter((field) => !ALLOWED_FIELDS.has(field));
  if (unexpected.length > 0) {
    throw historyProjectionProvenanceError(
      `history projection provenance event includes unexpected field(s): ${unexpected.join(", ")}`,
      "history_projection_provenance_unexpected_field",
    );
  }
  if (!ALLOWED_EVENT_TYPES.has(event.event_type)) {
    throw historyProjectionProvenanceError("history projection provenance event type is invalid", "history_projection_provenance_event_type_invalid");
  }
  if (!event.entry_id || typeof event.entry_id !== "string") {
    throw historyProjectionProvenanceError("history projection provenance requires entry_id", "history_projection_provenance_entry_id_required");
  }
  return {
    event_type: event.event_type,
    entry_id: String(event.entry_id),
    projection_id: String(event.projection_id ?? ""),
    projection_version: Number(event.projection_version ?? 1),
    domain: String(event.domain ?? ""),
    presentation_kind: String(event.presentation_kind ?? ""),
    source_refs: Array.isArray(event.source_refs) ? event.source_refs.map((ref) => ({
      type: String(ref?.type ?? ""),
      id: String(ref?.id ?? ""),
      domain: String(ref?.domain ?? ""),
    })) : [],
    consent_basis: String(event.consent_basis ?? ""),
    audience: String(event.audience ?? ""),
    recon_review: String(event.recon_review ?? ""),
    withheld_reason_class: String(event.withheld_reason_class ?? ""),
    structural_risk_class: String(event.structural_risk_class ?? ""),
    structural_acknowledgement_required: Boolean(event.structural_acknowledgement_required),
    structural_acknowledgement_decision: String(event.structural_acknowledgement_decision ?? ""),
    structural_acknowledged_by: String(event.structural_acknowledged_by ?? ""),
    structural_acknowledged_at: String(event.structural_acknowledged_at ?? ""),
    non_publication_reason_class: String(event.non_publication_reason_class ?? ""),
    reviewed_by: String(event.reviewed_by ?? ""),
    reviewed_at: String(event.reviewed_at ?? ""),
    actor: String(event.actor ?? ""),
    timestamp: String(event.timestamp ?? ""),
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

function historyProjectionProvenanceError(message, code) {
  const error = new Error(message);
  error.name = "HistoryProjectionProvenanceError";
  error.code = code;
  error.stage = "append";
  return error;
}

function stageError(stage, cause) {
  const error = new Error(cause?.message || `${stage} failed`, { cause });
  error.name = "HistoryProjectionProvenanceFileError";
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

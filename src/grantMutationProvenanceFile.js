import { open, readFile } from "node:fs/promises";

import { assertGrantMutationProvenanceEvent } from "./grantMutationProvenance.js";

const ALLOWED_GRANT_MUTATION_EVENT_FIELDS = new Set([
  "event_type",
  "grant_id",
  "capability",
  "provider",
  "scope",
  "actor",
  "reason",
  "timestamp",
  "source_proposal_id",
  "approval_provenance_id",
  "replacement_grant_id",
  "activation_performed",
]);

const FORBIDDEN_GRANT_MUTATION_EVENT_FIELDS = new Set([
  "constraints",
  "payload",
  "payload_bytes",
  "provider_output",
  "result",
  "raw_payload",
  "screenshot",
  "image_bytes",
  "frame_bytes",
  "audio_bytes",
  "text_content",
]);

export function createGrantMutationProvenanceFile({ path }) {
  const filePath = String(path ?? "").trim();
  return {
    append: (event) => appendGrantMutationProvenanceEvent(filePath, event),
    read: () => readGrantMutationProvenanceEvents(filePath),
  };
}

export async function appendGrantMutationProvenanceEvent(filePath, event) {
  const normalized = validateDurableGrantMutationEvent(event);
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

export async function readGrantMutationProvenanceEvents(filePath) {
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
      return validateDurableGrantMutationEvent(JSON.parse(line));
    } catch (error) {
      const wrapped = stageError("read", error);
      wrapped.line_number = index + 1;
      throw wrapped;
    }
  });
}

export function validateDurableGrantMutationEvent(event = {}) {
  const validated = assertGrantMutationProvenanceEvent(event);
  const fields = Object.keys(validated);
  const forbidden = fields.filter((field) => FORBIDDEN_GRANT_MUTATION_EVENT_FIELDS.has(field));
  if (forbidden.length > 0) {
    throw durableProvenanceError(
      `grant mutation provenance event includes forbidden field(s): ${forbidden.join(", ")}`,
      "grant_mutation_provenance_forbidden_field",
    );
  }
  const unexpected = fields.filter((field) => !ALLOWED_GRANT_MUTATION_EVENT_FIELDS.has(field));
  if (unexpected.length > 0) {
    throw durableProvenanceError(
      `grant mutation provenance event includes unexpected field(s): ${unexpected.join(", ")}`,
      "grant_mutation_provenance_unexpected_field",
    );
  }
  return {
    event_type: validated.event_type,
    grant_id: validated.grant_id,
    capability: validated.capability,
    provider: validated.provider,
    scope: validated.scope,
    actor: validated.actor,
    reason: validated.reason,
    timestamp: validated.timestamp,
    source_proposal_id: String(validated.source_proposal_id ?? ""),
    approval_provenance_id: String(validated.approval_provenance_id ?? ""),
    replacement_grant_id: String(validated.replacement_grant_id ?? ""),
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
    // Close failures during append cleanup should not mask write or sync errors.
  }
}

function durableProvenanceError(message, code) {
  const error = new Error(message);
  error.name = "GrantMutationDurableProvenanceError";
  error.code = code;
  error.stage = "append";
  return error;
}

function stageError(stage, cause) {
  const error = new Error(cause?.message || `${stage} failed`, { cause });
  error.name = "GrantMutationProvenanceFileError";
  error.stage = stage;
  error.code = cause?.code || stage;
  return error;
}

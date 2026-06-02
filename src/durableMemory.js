import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const DEFAULT_DURABLE_MEMORY_PATH = new URL("../config/durable-memory.json", import.meta.url);
const MAX_CONTENT_LENGTH = 4000;

export async function loadDurableMemoryStore(path = DEFAULT_DURABLE_MEMORY_PATH) {
  const raw = await readFile(path, "utf8");
  return normalizeDurableMemoryStore(JSON.parse(raw));
}

export function normalizeDurableMemoryStore(store = {}) {
  return {
    schema_version: store.schema_version ?? 1,
    entries: Array.isArray(store.entries) ? store.entries.map(publicDurableMemoryEntry) : [],
  };
}

export function listDurableMemoryEntries(store = {}) {
  return normalizeDurableMemoryStore(store).entries;
}

export function addDurableMemoryEntry(store = {}, input = {}, context = {}) {
  const entry = durableMemoryEntryFromInput(input, context);
  return {
    ...normalizeDurableMemoryStore(store),
    entries: [
      ...listDurableMemoryEntries(store),
      entry,
    ],
  };
}

export function removeDurableMemoryEntry(store = {}, input = {}, context = {}) {
  const id = String(input.id ?? input.memory_id ?? "").trim();
  if (!id) {
    throw durableMemoryError("memory_durable_entry_id_required", "Durable memory removal requires an entry id.");
  }
  const normalized = normalizeDurableMemoryStore(store);
  const existing = normalized.entries.find((entry) => entry.id === id);
  if (!existing) {
    throw durableMemoryError("memory_durable_entry_not_found", "Durable memory entry was not found.");
  }
  return {
    ...normalized,
    entries: normalized.entries.filter((entry) => entry.id !== id),
    mutation: {
      entry: existing,
      removed_by: String(input.actor ?? input.removed_by ?? "user").trim() || "user",
      reason: String(input.reason ?? "").trim(),
      removed_at: context.now ? context.now() : new Date().toISOString(),
    },
  };
}

export function durableMemoryEntryFromInput(input = {}, context = {}) {
  const role = boundedString(input.role ?? "note", "role", 64);
  const source = boundedString(input.source ?? "manual", "source", 64);
  const content = boundedString(input.content, "content", MAX_CONTENT_LENGTH);
  if (!content.trim()) {
    throw durableMemoryError("memory_durable_content_required", "Durable memory content is required.");
  }
  return publicDurableMemoryEntry({
    id: String(input.id ?? context.createId?.() ?? `memory-durable-${randomUUID()}`).trim(),
    role,
    content,
    source,
    created_at: String(input.created_at ?? context.now?.() ?? new Date().toISOString()),
    created_by: String(input.actor ?? input.created_by ?? "user").trim() || "user",
    grant_id: String(input.grant_id ?? context.grant?.id ?? "").trim(),
    provider: String(input.provider ?? context.grant?.provider ?? "").trim(),
    scope: String(input.scope ?? context.grant?.scope ?? "").trim(),
  });
}

export function publicDurableMemoryEntry(entry = {}) {
  return {
    id: String(entry.id ?? ""),
    role: String(entry.role ?? "note"),
    content: String(entry.content ?? ""),
    source: String(entry.source ?? "manual"),
    created_at: String(entry.created_at ?? ""),
    created_by: String(entry.created_by ?? ""),
    grant_id: String(entry.grant_id ?? ""),
    provider: String(entry.provider ?? ""),
    scope: String(entry.scope ?? ""),
  };
}

export function summarizeDurableMemoryStore(store = {}) {
  const entries = listDurableMemoryEntries(store);
  const byRole = {};
  const bySource = {};
  for (const entry of entries) {
    byRole[entry.role] = (byRole[entry.role] ?? 0) + 1;
    bySource[entry.source] = (bySource[entry.source] ?? 0) + 1;
  }
  return {
    total: entries.length,
    by_role: byRole,
    by_source: bySource,
  };
}

function boundedString(value, field, maxLength) {
  if (typeof value !== "string") {
    throw durableMemoryError(`memory_durable_${field}_invalid`, `Durable memory ${field} must be a string.`);
  }
  if (value.length > maxLength) {
    throw durableMemoryError(`memory_durable_${field}_too_large`, `Durable memory ${field} is too large.`);
  }
  return value;
}

function durableMemoryError(code, message) {
  const error = new Error(message);
  error.name = "DurableMemoryError";
  error.code = code;
  return error;
}

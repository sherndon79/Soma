import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export const DEFAULT_OCCUPANT_MEMORY_PATH = new URL("../config/occupant-memory.json", import.meta.url);
export const OCCUPANT_MEMORY_CLASSES = Object.freeze(["self_note", "episode_content", "about_participant"]);
export const AVAILABLE_OCCUPANT_MEMORY_CLASSES = Object.freeze(["self_note"]);
export const OCCUPANT_MEMORY_TOMBSTONE_REASON_CLASSES = Object.freeze([
  "occupant_revoke",
  "steward_safety",
  "steward_privacy",
  "abuse",
  "migration",
  "operator_error",
  "legal_policy",
  "retention_policy",
]);

export const OCCUPANT_MEMORY_ENTRY_CHAR_CAP = 2000;
export const OCCUPANT_MEMORY_EPISODE_ENTRY_CAP = 32;
export const OCCUPANT_MEMORY_STORE_ENTRY_CAP = 256;
export const OCCUPANT_MEMORY_READ_ENTRY_CAP = 16;
export const OCCUPANT_MEMORY_READ_CHAR_CAP = 32000;

const MAX_TAGS = 8;
const MAX_TAG_LENGTH = 48;

export async function loadOccupantMemoryStore(path = DEFAULT_OCCUPANT_MEMORY_PATH) {
  const raw = await readFile(path, "utf8");
  return normalizeOccupantMemoryStore(JSON.parse(raw));
}

export function normalizeOccupantMemoryStore(store = {}) {
  return {
    schema_version: store.schema_version ?? 1,
    entries: Array.isArray(store.entries) ? store.entries.map(publicOccupantMemoryEntry) : [],
    tombstones: Array.isArray(store.tombstones) ? store.tombstones.map(publicOccupantMemoryTombstone) : [],
  };
}

export function listOccupantMemoryEntries(store = {}) {
  return normalizeOccupantMemoryStore(store).entries;
}

export function listOccupantMemoryTombstones(store = {}) {
  return normalizeOccupantMemoryStore(store).tombstones;
}

export function summarizeOccupantMemoryStore(store = {}) {
  const normalized = normalizeOccupantMemoryStore(store);
  const activeEntries = normalized.entries.filter((entry) => entry.status === "active");
  return {
    active_entry_count: activeEntries.length,
    tombstone_count: normalized.tombstones.length,
    by_class: countBy(activeEntries, "memory_class"),
  };
}

export function addOccupantMemoryEntry(store = {}, input = {}, context = {}) {
  const normalized = normalizeOccupantMemoryStore(store);
  const entry = occupantMemoryEntryFromInput(input, context, normalized);
  return {
    ...normalized,
    entries: [...normalized.entries, entry],
  };
}

export function revokeOccupantMemoryEntry(store = {}, input = {}, context = {}) {
  const normalized = normalizeOccupantMemoryStore(store);
  const id = String(input.id ?? input.entry_id ?? input.memory_id ?? input.revoke ?? "").trim();
  if (!id) {
    throw occupantMemoryError("occupant_memory_entry_id_required", "Occupant memory revocation requires an entry id.");
  }
  const existing = normalized.entries.find((entry) => entry.id === id && entry.status === "active");
  if (!existing) {
    throw occupantMemoryError("occupant_memory_entry_not_found", "Occupant memory entry was not found.");
  }
  const reasonClass = normalizeTombstoneReasonClass(input.reason_class ?? "occupant_revoke");
  const removedAt = String(input.removed_at ?? context.now?.() ?? new Date().toISOString());
  const removedBy = String(input.actor ?? input.removed_by ?? "occupant").trim() || "occupant";
  const tombstone = publicOccupantMemoryTombstone({
    entry_id: existing.id,
    memory_class: existing.memory_class,
    model_id: existing.model_id,
    episode_id: existing.episode_id,
    domain: existing.domain,
    created_at: existing.created_at,
    removed_at: removedAt,
    removed_by: removedBy,
    reason_class: reasonClass,
    grant_id: String(input.grant_id ?? context.grant?.id ?? existing.grant_id ?? "").trim(),
    provider: String(input.provider ?? context.grant?.provider ?? existing.provider ?? "").trim(),
    scope: String(input.scope ?? context.grant?.scope ?? existing.scope ?? "").trim(),
  });
  return {
    ...normalized,
    entries: normalized.entries.filter((entry) => entry.id !== existing.id),
    tombstones: [...normalized.tombstones, tombstone],
    mutation: { entry: existing, tombstone },
  };
}

export function occupantMemoryEntryFromInput(input = {}, context = {}, store = {}) {
  const memoryClass = String(input.memory_class ?? input.class ?? "self_note").trim() || "self_note";
  if (!OCCUPANT_MEMORY_CLASSES.includes(memoryClass)) {
    throw occupantMemoryError("occupant_memory_class_invalid", "Occupant memory class is invalid.");
  }
  if (!AVAILABLE_OCCUPANT_MEMORY_CLASSES.includes(memoryClass)) {
    throw occupantMemoryError("occupant_memory_class_not_available", "Occupant memory class is not available in this slice.");
  }
  const content = boundedString(input.content ?? input.text, "content", OCCUPANT_MEMORY_ENTRY_CHAR_CAP).trim();
  if (!content) {
    throw occupantMemoryError("occupant_memory_content_required", "Occupant memory content is required.");
  }
  const scan = scanSelfNoteContent(content);
  if (!scan.allowed) {
    throw occupantMemoryError("occupant_memory_self_note_rejected", "Occupant memory self_note content tripped a safety scanner.", {
      reason_class: scan.reason_class,
    });
  }
  const entries = listOccupantMemoryEntries(store);
  const episodeId = String(input.episode_id ?? context.episode?.id ?? "").trim();
  if (entries.length >= OCCUPANT_MEMORY_STORE_ENTRY_CAP) {
    throw occupantMemoryError("occupant_memory_store_cap_reached", "Occupant memory store cap reached.");
  }
  const episodeEntryCount = entries.filter((entry) => entry.episode_id === episodeId).length;
  if (episodeEntryCount >= OCCUPANT_MEMORY_EPISODE_ENTRY_CAP) {
    throw occupantMemoryError("occupant_memory_episode_cap_reached", "Occupant memory episode cap reached.");
  }
  return publicOccupantMemoryEntry({
    id: String(input.id ?? context.createId?.() ?? `occupant-memory-${randomUUID()}`).trim(),
    memory_class: memoryClass,
    content,
    tags: normalizeTags(input.tags),
    model_id: String(input.model_id ?? context.episode?.posture?.occupant_id ?? context.model_id ?? "").trim(),
    episode_id: episodeId,
    domain: String(input.domain ?? context.domain ?? "").trim(),
    created_at: String(input.created_at ?? context.now?.() ?? new Date().toISOString()),
    created_by: String(input.actor ?? input.created_by ?? "occupant").trim() || "occupant",
    grant_id: String(input.grant_id ?? context.grant?.id ?? "").trim(),
    provider: String(input.provider ?? context.grant?.provider ?? "").trim(),
    scope: String(input.scope ?? context.grant?.scope ?? "").trim(),
    status: "active",
  });
}

export function readOccupantMemoryPage(store = {}, { cursor = "" } = {}) {
  const normalized = normalizeOccupantMemoryStore(store);
  const items = [
    ...normalized.entries.map((entry) => ({ kind: "entry", sort_at: entry.created_at, entry })),
    ...normalized.tombstones.map((tombstone) => ({ kind: "tombstone", sort_at: tombstone.removed_at, tombstone })),
  ].sort((left, right) => String(right.sort_at).localeCompare(String(left.sort_at)));
  const offset = decodeCursor(cursor, items.length);
  const selected = [];
  let charCount = 0;
  for (const item of items.slice(offset)) {
    if (selected.length >= OCCUPANT_MEMORY_READ_ENTRY_CAP) {
      break;
    }
    const contentLength = item.kind === "entry" ? item.entry.content.length : 0;
    if (charCount + contentLength > OCCUPANT_MEMORY_READ_CHAR_CAP) {
      break;
    }
    selected.push(item);
    charCount += contentLength;
  }
  const nextOffset = offset + selected.length;
  return {
    items: selected,
    next_cursor: nextOffset < items.length ? encodeCursor(nextOffset) : "",
    entry_count: selected.filter((item) => item.kind === "entry").length,
    tombstone_count: selected.filter((item) => item.kind === "tombstone").length,
    content_char_count: charCount,
    newest_first: true,
    page_entry_cap: OCCUPANT_MEMORY_READ_ENTRY_CAP,
    page_char_cap: OCCUPANT_MEMORY_READ_CHAR_CAP,
  };
}

export function publicOccupantMemoryEntry(entry = {}) {
  return {
    id: String(entry.id ?? ""),
    memory_class: String(entry.memory_class ?? "self_note"),
    content: String(entry.content ?? ""),
    tags: normalizeTags(entry.tags),
    model_id: String(entry.model_id ?? ""),
    episode_id: String(entry.episode_id ?? ""),
    domain: String(entry.domain ?? ""),
    created_at: String(entry.created_at ?? ""),
    created_by: String(entry.created_by ?? "occupant"),
    grant_id: String(entry.grant_id ?? ""),
    provider: String(entry.provider ?? ""),
    scope: String(entry.scope ?? ""),
    status: String(entry.status ?? "active"),
  };
}

export function publicOccupantMemoryTombstone(tombstone = {}) {
  return {
    entry_id: String(tombstone.entry_id ?? ""),
    memory_class: String(tombstone.memory_class ?? "self_note"),
    model_id: String(tombstone.model_id ?? ""),
    episode_id: String(tombstone.episode_id ?? ""),
    domain: String(tombstone.domain ?? ""),
    created_at: String(tombstone.created_at ?? ""),
    removed_at: String(tombstone.removed_at ?? ""),
    removed_by: String(tombstone.removed_by ?? ""),
    reason_class: normalizeTombstoneReasonClass(tombstone.reason_class ?? "operator_error"),
    grant_id: String(tombstone.grant_id ?? ""),
    provider: String(tombstone.provider ?? ""),
    scope: String(tombstone.scope ?? ""),
  };
}

export function scanSelfNoteContent(content = "") {
  const text = String(content ?? "");
  const trimmed = text.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    return { allowed: false, reason_class: "json_blob" };
  }
  const tripwires = [
    ["raw_result_envelope", /"capability"\s*:\s*"[^"]+"[\s\S]{0,400}"result"\s*:/i],
    ["transcript_block", /(^|\n)\s*```(?:json|soma-capability|soma-durable|soma-forum)?[\s\S]*\n\s*```/i],
    ["locator_identity", /\b(service|path|pid|process|registry|raw_atspi_locators|grant_id|provider|act_ref)\b\s*[:=]/i],
    ["about_participant_marker", /\b(participant|human|seth|user)\b.{0,80}\b(is|likes|prefers|needs|lives|works|feels|believes|wants)\b/i],
    ["file_or_desktop_dump", /\b(file contents|desktop text|provenance entries|capability_results|messages)\b/i],
  ];
  for (const [reason_class, pattern] of tripwires) {
    if (pattern.test(text)) {
      return { allowed: false, reason_class };
    }
  }
  return { allowed: true, reason_class: "" };
}

function boundedString(value, field, maxLength) {
  if (typeof value !== "string") {
    throw occupantMemoryError(`occupant_memory_${field}_invalid`, `Occupant memory ${field} must be a string.`);
  }
  if (value.length > maxLength) {
    throw occupantMemoryError(`occupant_memory_${field}_too_large`, `Occupant memory ${field} is too large.`);
  }
  return value;
}

function normalizeTags(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(0, MAX_TAGS)
    .map((tag) => String(tag ?? "").trim())
    .filter(Boolean)
    .map((tag) => tag.slice(0, MAX_TAG_LENGTH));
}

function normalizeTombstoneReasonClass(value) {
  const reason = String(value ?? "").trim();
  if (OCCUPANT_MEMORY_TOMBSTONE_REASON_CLASSES.includes(reason)) {
    return reason;
  }
  throw occupantMemoryError("occupant_memory_tombstone_reason_invalid", "Occupant memory tombstone reason class is invalid.");
}

function encodeCursor(offset) {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor, itemCount) {
  const raw = String(cursor ?? "").trim();
  if (!raw) {
    return 0;
  }
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const offset = Number(parsed?.offset ?? 0);
    if (Number.isInteger(offset) && offset >= 0 && offset <= itemCount) {
      return offset;
    }
  } catch {
    // Invalid cursors fail closed by refusing the read instead of guessing a page.
  }
  throw occupantMemoryError("occupant_memory_cursor_invalid", "Occupant memory cursor is invalid.");
}

function countBy(entries, field) {
  const counts = {};
  for (const entry of entries) {
    const key = String(entry[field] ?? "");
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function occupantMemoryError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "OccupantMemoryError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

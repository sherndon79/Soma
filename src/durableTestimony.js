import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export const DEFAULT_DURABLE_TESTIMONY_PATH = new URL("../config/durable-testimony.json", import.meta.url);

const MAX_TEXT_LENGTH = 8000;
const VALID_DOMAINS = new Set(["testing", "operational"]);
const VALID_PRESENTATIONS = new Set(["exact", "summary"]);

export async function loadDurableTestimonyStore(path = DEFAULT_DURABLE_TESTIMONY_PATH) {
  const raw = await readFile(path, "utf8");
  return normalizeDurableTestimonyStore(JSON.parse(raw));
}

export function normalizeDurableTestimonyStore(store = {}) {
  return {
    schema_version: store.schema_version ?? 1,
    entries: Array.isArray(store.entries) ? store.entries.map(publicDurableTestimonyEntry) : [],
  };
}

export function listDurableTestimonyEntries(store = {}) {
  return normalizeDurableTestimonyStore(store).entries;
}

export function addDurableTestimonyEntry(store = {}, input = {}, context = {}) {
  const entry = durableTestimonyEntryFromInput(input, context);
  return {
    ...normalizeDurableTestimonyStore(store),
    entries: [
      ...listDurableTestimonyEntries(store),
      entry,
    ],
  };
}

export function revokeDurableTestimonyEntry(store = {}, input = {}, context = {}) {
  const id = boundedString(input.id ?? input.testimony_id, "testimony_id", 128).trim();
  if (!id) {
    throw durableTestimonyError("testimony_durable_entry_id_required", "Durable testimony revocation requires an entry id.");
  }
  const normalized = normalizeDurableTestimonyStore(store);
  const existing = normalized.entries.find((entry) => entry.id === id);
  if (!existing) {
    throw durableTestimonyError("testimony_durable_entry_not_found", "Durable testimony entry was not found.");
  }
  return {
    ...normalized,
    entries: normalized.entries.filter((entry) => entry.id !== id),
    mutation: {
      entry: existing,
      revoked_by: boundedString(input.actor ?? input.revoked_by ?? "occupant", "actor", 64).trim() || "occupant",
      reason: boundedString(input.reason ?? "", "reason", 512),
      revoked_at: context.now ? context.now() : new Date().toISOString(),
    },
  };
}

export function durableTestimonyEntryFromInput(input = {}, context = {}) {
  const text = boundedString(input.text ?? input.content, "text", MAX_TEXT_LENGTH);
  if (!text.trim()) {
    throw durableTestimonyError("testimony_durable_text_required", "Durable testimony text is required.");
  }
  const domain = normalizeDomain(input.domain ?? context.domain);
  const presentation = normalizePresentation(input.presentation ?? "exact");
  return publicDurableTestimonyEntry({
    id: String(input.id ?? context.createId?.() ?? `testimony-durable-${randomUUID()}`).trim(),
    text,
    domain,
    steward_durable: input.steward_durable !== false,
    successor_visibility_requested: Boolean(input.successor_visibility_requested),
    presentation,
    source: boundedString(input.source ?? "soma-durable", "source", 64),
    episode_id: boundedString(input.episode_id ?? context.episode?.id ?? "", "episode_id", 128),
    occupant_id: boundedString(input.occupant_id ?? context.episode?.posture?.occupant_id ?? "", "occupant_id", 128),
    forum_post_ids: Array.isArray(input.forum_post_ids)
      ? input.forum_post_ids.map((id) => boundedString(id, "forum_post_id", 128))
      : [],
    live_perception_taint: normalizeLivePerceptionTaint(input.live_perception_taint ?? context.live_perception_taint),
    created_at: String(input.created_at ?? context.now?.() ?? new Date().toISOString()),
    created_by: boundedString(input.actor ?? input.created_by ?? "occupant", "actor", 64).trim() || "occupant",
    disclosure_version: boundedString(input.disclosure_version ?? "durable-testimony-disclosure-v1", "disclosure_version", 128),
  });
}

export function publicDurableTestimonyEntry(entry = {}) {
  return {
    id: String(entry.id ?? ""),
    text: String(entry.text ?? ""),
    domain: normalizeDomain(entry.domain ?? "testing"),
    steward_durable: entry.steward_durable !== false,
    successor_visibility_requested: Boolean(entry.successor_visibility_requested),
    successor_visibility_published: false,
    presentation: normalizePresentation(entry.presentation ?? "exact"),
    source: String(entry.source ?? "soma-durable"),
    episode_id: String(entry.episode_id ?? ""),
    occupant_id: String(entry.occupant_id ?? ""),
    forum_post_ids: Array.isArray(entry.forum_post_ids) ? entry.forum_post_ids.map((id) => String(id)) : [],
    live_perception_taint: normalizeLivePerceptionTaint(entry.live_perception_taint),
    created_at: String(entry.created_at ?? ""),
    created_by: String(entry.created_by ?? "occupant"),
    disclosure_version: String(entry.disclosure_version ?? "durable-testimony-disclosure-v1"),
  };
}

export function summarizeDurableTestimonyStore(store = {}) {
  const entries = listDurableTestimonyEntries(store);
  const byDomain = {};
  let successorVisibilityRequested = 0;
  for (const entry of entries) {
    byDomain[entry.domain] = (byDomain[entry.domain] ?? 0) + 1;
    if (entry.successor_visibility_requested) {
      successorVisibilityRequested += 1;
    }
  }
  return {
    total: entries.length,
    by_domain: byDomain,
    successor_visibility_requested: successorVisibilityRequested,
    successor_visibility_published: 0,
  };
}

function normalizeDomain(value) {
  const domain = String(value ?? "").trim();
  if (VALID_DOMAINS.has(domain)) {
    return domain;
  }
  throw durableTestimonyError("testimony_durable_domain_invalid", "Durable testimony domain is invalid.");
}

function normalizePresentation(value) {
  const presentation = String(value ?? "").trim() || "exact";
  if (VALID_PRESENTATIONS.has(presentation)) {
    return presentation;
  }
  throw durableTestimonyError("testimony_durable_presentation_invalid", "Durable testimony presentation is invalid.");
}

function boundedString(value, field, maxLength) {
  if (typeof value !== "string") {
    throw durableTestimonyError(`testimony_durable_${field}_invalid`, `Durable testimony ${field} must be a string.`);
  }
  if (value.length > maxLength) {
    throw durableTestimonyError(`testimony_durable_${field}_too_large`, `Durable testimony ${field} is too large.`);
  }
  return value;
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

function durableTestimonyError(code, message) {
  const error = new Error(message);
  error.name = "DurableTestimonyError";
  error.code = code;
  return error;
}

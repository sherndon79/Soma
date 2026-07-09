import { randomUUID } from "node:crypto";

export class SessionMemory {
  constructor({ maxEntries = 100 } = {}) {
    this.maxEntries = maxEntries;
    this.entries = [];
  }

  loadDurable(entries = []) {
    for (const entry of entries) {
      this.entries.push({
        id: entry.id,
        role: entry.role,
        content: entry.content,
        source: entry.source || "durable",
        durable: true,
        durable_memory_id: entry.id,
        created_at: entry.created_at,
        live_perception_taint: normalizeLivePerceptionTaint(entry.live_perception_taint),
      });
    }
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    return entries.length;
  }

  list() {
    return [...this.entries];
  }

  add({ role, content, source = "manual", live_perception_taint: livePerceptionTaint = null }) {
    const entry = {
      id: randomUUID(),
      role,
      content,
      source,
      created_at: new Date().toISOString(),
      live_perception_taint: normalizeLivePerceptionTaint(livePerceptionTaint),
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    return entry;
  }

  clear() {
    const removed = this.entries.length;
    this.entries = [];
    return removed;
  }

  asContext() {
    if (this.entries.length === 0) {
      return "";
    }
    return this.entries.map((entry) => `- ${entry.role}: ${entry.content}`).join("\n");
  }
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

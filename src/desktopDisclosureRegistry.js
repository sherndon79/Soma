import { randomUUID } from "node:crypto";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 512;

export class DesktopDisclosureRegistry {
  constructor({
    ttlMs = DEFAULT_TTL_MS,
    maxEntries = DEFAULT_MAX_ENTRIES,
    now = () => new Date(),
    idFactory = randomUUID,
  } = {}) {
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
      throw new TypeError("ttlMs must be a positive integer");
    }
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw new TypeError("maxEntries must be a positive integer");
    }
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.idFactory = idFactory;
    this.records = new Map();
    this.index = new Map();
  }

  recordFromAccessibilityTree({
    inspection,
    provenanceId,
    capability = "desktop.inspect.accessibility_tree",
  } = {}) {
    const entries = [];
    if (!inspection?.tree || !Array.isArray(inspection.tree.applications)) {
      return entries;
    }

    for (const application of inspection.tree.applications) {
      if (isObjectRef({ service: application?.service, path: application?.root_object?.path })) {
        entries.push(this.record({
          sourceType: "application_root",
          service: application.service,
          path: application.root_object.path,
          provenanceId,
          capability,
          desktopSession: inspection.desktop_session,
          sessionType: inspection.session_type,
        }));
      }

      const children = application?.root_object?.children_sample;
      if (Array.isArray(children)) {
        for (const child of children) {
          if (!isObjectRef(child)) {
            continue;
          }
          entries.push(this.record({
            sourceType: "root_child_sample",
            service: child.service,
            path: child.path,
            provenanceId,
            capability,
            desktopSession: inspection.desktop_session,
            sessionType: inspection.session_type,
          }));
        }
      }
    }

    return entries;
  }

  recordFromFocusedInspection({
    inspection,
    provenanceId,
    capability = "desktop.inspect.focus",
  } = {}) {
    if (inspection?.focus_available !== true || !isObjectRef(inspection.focused_object)) {
      return [];
    }

    const entries = [
      this.record({
        sourceType: "focused_object",
        service: inspection.focused_object.service,
        path: inspection.focused_object.path,
        provenanceId,
        capability,
        desktopSession: inspection.desktop_session,
        sessionType: inspection.session_type,
      }),
    ];

    if (isObjectRef(inspection.focused_object.application)) {
      entries.push(this.record({
        sourceType: "focused_application",
        service: inspection.focused_object.application.service,
        path: inspection.focused_object.application.path,
        provenanceId,
        capability,
        desktopSession: inspection.desktop_session,
        sessionType: inspection.session_type,
      }));
    }

    return entries;
  }

  record({
    sourceType,
    service,
    path,
    provenanceId,
    capability,
    desktopSession,
    sessionType,
  }) {
    if (!isObjectRef({ service, path })) {
      throw new TypeError("service and path are required");
    }
    this.clearExpired();

    const now = asDate(this.now());
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    const key = indexKey(service, path);
    const existingId = this.index.get(key);

    if (existingId && this.records.has(existingId)) {
      const existing = this.records.get(existingId);
      const updated = {
        ...existing,
        source_event_id: provenanceId ?? existing.source_event_id,
        source_capability: capability ?? existing.source_capability,
        source_type: sourceType ?? existing.source_type,
        desktop_session: stringOrEmpty(desktopSession) || existing.desktop_session,
        session_type: stringOrEmpty(sessionType) || existing.session_type,
        expires_at: expiresAt.toISOString(),
        revoked: false,
      };
      this.records.set(existingId, updated);
      return cloneRecord(updated);
    }

    const record = {
      id: this.idFactory(),
      source_event_id: stringOrEmpty(provenanceId),
      source_capability: stringOrEmpty(capability),
      source_type: stringOrEmpty(sourceType),
      service,
      path,
      desktop_session: stringOrEmpty(desktopSession),
      session_type: stringOrEmpty(sessionType),
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      revoked: false,
    };

    this.records.set(record.id, record);
    this.index.set(key, record.id);
    this.evictOverflow();
    return cloneRecord(record);
  }

  authorizeRootRef({ rootRef, capability } = {}) {
    const record = this.records.get(rootRef);
    if (!record) {
      return { ok: false, error: "desktop_traversal_root_not_disclosed" };
    }
    if (record.revoked) {
      return { ok: false, error: "desktop_traversal_root_revoked" };
    }
    if (new Date(record.expires_at).getTime() <= asDate(this.now()).getTime()) {
      this.deleteRecord(record.id);
      return { ok: false, error: "desktop_traversal_root_expired" };
    }
    if (capability && record.source_capability !== capability) {
      return { ok: false, error: "desktop_traversal_root_capability_inactive" };
    }
    return {
      ok: true,
      service: record.service,
      path: record.path,
      source_event_id: record.source_event_id,
      source_type: record.source_type,
    };
  }

  revokeByCapability(capability) {
    for (const record of this.records.values()) {
      if (record.source_capability === capability) {
        record.revoked = true;
      }
    }
  }

  revokeAllDesktop() {
    for (const record of this.records.values()) {
      if (record.source_capability.startsWith("desktop.inspect.")) {
        record.revoked = true;
      }
    }
  }

  clearExpired() {
    const nowMs = asDate(this.now()).getTime();
    for (const record of [...this.records.values()]) {
      if (new Date(record.expires_at).getTime() <= nowMs) {
        this.deleteRecord(record.id);
      }
    }
  }

  summary() {
    this.clearExpired();
    return {
      total: this.records.size,
      entries: [...this.records.values()].map((record) => ({
        id: record.id,
        source_event_id: record.source_event_id,
        source_capability: record.source_capability,
        source_type: record.source_type,
        created_at: record.created_at,
        expires_at: record.expires_at,
        revoked: record.revoked,
      })),
    };
  }

  snapshot() {
    this.clearExpired();
    return [...this.records.values()].map(cloneRecord);
  }

  deleteRecord(id) {
    const record = this.records.get(id);
    if (!record) {
      return;
    }
    this.records.delete(id);
    this.index.delete(indexKey(record.service, record.path));
  }

  evictOverflow() {
    while (this.records.size > this.maxEntries) {
      const oldest = this.records.keys().next().value;
      this.deleteRecord(oldest);
    }
  }
}

function isObjectRef(value) {
  return typeof value?.service === "string" && typeof value?.path === "string";
}

function indexKey(service, path) {
  return `${service}\u0000${path}`;
}

function asDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function stringOrEmpty(value) {
  return typeof value === "string" ? value : "";
}

function cloneRecord(record) {
  return { ...record };
}

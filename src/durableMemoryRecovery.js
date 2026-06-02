import { listDurableMemoryEntries, normalizeDurableMemoryStore } from "./durableMemory.js";

export function inspectDurableMemoryRecovery({ store, provenanceEvents = [] } = {}) {
  const normalized = normalizeDurableMemoryStore(store);
  const events = Array.isArray(provenanceEvents) ? provenanceEvents : [];
  const findings = [];

  for (const entry of listDurableMemoryEntries(normalized)) {
    const created = events.find((event) => (
      event?.event_type === "memory.durable.written"
      && event?.memory_id === entry.id
    ));
    if (!created) {
      findings.push(finding("missing_memory_durable_written_provenance", entry));
      continue;
    }
    for (const field of ["role", "source", "grant_id", "provider", "scope"]) {
      if (String(created[field] ?? "") !== String(entry[field] ?? "")) {
        findings.push(finding("memory_durable_provenance_metadata_mismatch", entry, {
          field,
          store_value: String(entry[field] ?? ""),
          event_value: String(created[field] ?? ""),
        }));
      }
    }
    if (created.activation_performed !== false) {
      findings.push(finding("memory_durable_provenance_claims_activation", entry));
    }
  }

  return {
    ok: findings.length === 0,
    degraded: findings.length > 0,
    entry_count: normalized.entries.length,
    finding_count: findings.length,
    findings,
  };
}

function finding(code, entry, details = {}) {
  return {
    code,
    memory_id: entry.id,
    role: entry.role,
    source: entry.source,
    grant_id: entry.grant_id,
    provider: entry.provider,
    scope: entry.scope,
    authorizing_safe: false,
    ...details,
  };
}

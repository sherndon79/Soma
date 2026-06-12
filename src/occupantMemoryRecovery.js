import { listOccupantMemoryEntries, listOccupantMemoryTombstones } from "./occupantMemory.js";

export function inspectOccupantMemoryRecovery({ store = {}, provenanceEvents = [] } = {}) {
  const entries = listOccupantMemoryEntries(store);
  const tombstones = listOccupantMemoryTombstones(store);
  const findings = [];
  const eventByEntry = new Map();
  for (const event of provenanceEvents) {
    const id = String(event.entry_id ?? "");
    if (!id) {
      continue;
    }
    const list = eventByEntry.get(id) ?? [];
    list.push(event);
    eventByEntry.set(id, list);
  }
  for (const entry of entries) {
    const events = eventByEntry.get(entry.id) ?? [];
    if (!events.some((event) => event.event_type === "occupant.memory.written")) {
      findings.push({
        code: "occupant_memory_write_provenance_missing",
        entry_id: entry.id,
        memory_class: entry.memory_class,
        model_id: entry.model_id,
        episode_id: entry.episode_id,
        domain: entry.domain,
        grant_id: entry.grant_id,
        provider: entry.provider,
        scope: entry.scope,
        authorizing_safe: false,
      });
    }
  }
  for (const tombstone of tombstones) {
    const events = eventByEntry.get(tombstone.entry_id) ?? [];
    if (!events.some((event) => event.event_type === "occupant.memory.revoked")) {
      findings.push({
        code: "occupant_memory_revocation_provenance_missing",
        entry_id: tombstone.entry_id,
        memory_class: tombstone.memory_class,
        model_id: tombstone.model_id,
        episode_id: tombstone.episode_id,
        domain: tombstone.domain,
        grant_id: tombstone.grant_id,
        provider: tombstone.provider,
        scope: tombstone.scope,
        authorizing_safe: false,
      });
    }
  }
  return {
    ok: findings.length === 0,
    degraded: findings.length > 0,
    entry_count: entries.length,
    tombstone_count: tombstones.length,
    finding_count: findings.length,
    findings,
  };
}

import { fileURLToPath } from "node:url";

import {
  loadOccupantMemoryStore,
  normalizeOccupantMemoryStore,
} from "./occupantMemory.js";
import { createOccupantMemoryProvenanceFile } from "./occupantMemoryProvenanceFile.js";
import { inspectOccupantMemoryRecovery } from "./occupantMemoryRecovery.js";

const DEFAULT_OCCUPANT_MEMORY_STORE_PATH = new URL("../config/occupant-memory.json", import.meta.url);
const DEFAULT_OCCUPANT_MEMORY_PROVENANCE_PATH = new URL(
  "../config/occupant-memory-mutations.ndjson",
  import.meta.url,
);

export async function loadOccupantMemoryAuthority({
  occupantMemoryStorePath = DEFAULT_OCCUPANT_MEMORY_STORE_PATH,
  occupantMemoryProvenancePath = DEFAULT_OCCUPANT_MEMORY_PROVENANCE_PATH,
} = {}) {
  let occupantMemoryStore;
  try {
    occupantMemoryStore = await loadOccupantMemoryStore(occupantMemoryStorePath);
  } catch (error) {
    const emptyStore = normalizeOccupantMemoryStore({ schema_version: 1, entries: [], tombstones: [] });
    return {
      occupantMemoryStore: emptyStore,
      occupantMemoryRecoveryReport: unreadableOccupantMemoryStoreRecoveryReport({ error }),
      occupantMemoryStorePath: pathString(occupantMemoryStorePath),
      occupantMemoryProvenancePath: pathString(occupantMemoryProvenancePath),
    };
  }
  const normalizedStore = normalizeOccupantMemoryStore(occupantMemoryStore);
  let provenanceEvents = [];
  try {
    provenanceEvents = await createOccupantMemoryProvenanceFile({
      path: occupantMemoryProvenancePath,
    }).read();
  } catch (error) {
    return {
      occupantMemoryStore: normalizedStore,
      occupantMemoryRecoveryReport: unreadableOccupantMemoryProvenanceReport(normalizedStore, error),
      occupantMemoryStorePath: pathString(occupantMemoryStorePath),
      occupantMemoryProvenancePath: pathString(occupantMemoryProvenancePath),
    };
  }
  return {
    occupantMemoryStore: normalizedStore,
    occupantMemoryRecoveryReport: inspectOccupantMemoryRecovery({
      store: normalizedStore,
      provenanceEvents,
    }),
    occupantMemoryStorePath: pathString(occupantMemoryStorePath),
    occupantMemoryProvenancePath: pathString(occupantMemoryProvenancePath),
  };
}

export function cleanOccupantMemoryRecoveryReport(store = {}) {
  return {
    ok: true,
    degraded: false,
    entry_count: normalizeOccupantMemoryStore(store).entries.length,
    tombstone_count: normalizeOccupantMemoryStore(store).tombstones.length,
    finding_count: 0,
    findings: [],
  };
}

function unreadableOccupantMemoryStoreRecoveryReport({ error } = {}) {
  return {
    ok: false,
    degraded: true,
    occupant_memory_store_status: "corrupt",
    occupant_memory_store_degraded_reason: "occupant_memory_store_unreadable",
    entry_count: 0,
    tombstone_count: 0,
    finding_count: 1,
    findings: [
      {
        code: "occupant_memory_store_unreadable",
        entry_id: "",
        memory_class: "",
        model_id: "",
        episode_id: "",
        domain: "",
        grant_id: "",
        provider: "",
        scope: "",
        authorizing_safe: false,
        occupant_memory_store_status: "corrupt",
        occupant_memory_store_stage: "load",
        occupant_memory_store_error_code: String(error?.code ?? error?.name ?? "unknown"),
      },
    ],
  };
}

function unreadableOccupantMemoryProvenanceReport(store, error) {
  const normalized = normalizeOccupantMemoryStore(store);
  const records = [
    ...normalized.entries.map((entry) => ({ entry_id: entry.id, ...entry })),
    ...normalized.tombstones,
  ];
  const findings = records.map((record) => ({
    code: "occupant_memory_provenance_unreadable",
    entry_id: record.entry_id ?? record.id,
    memory_class: record.memory_class,
    model_id: record.model_id,
    episode_id: record.episode_id,
    domain: record.domain,
    grant_id: record.grant_id,
    provider: record.provider,
    scope: record.scope,
    authorizing_safe: false,
    provenance_stage: String(error?.stage ?? "read"),
    provenance_error_code: String(error?.code ?? "unknown"),
  }));
  return {
    ok: findings.length === 0,
    degraded: findings.length > 0,
    entry_count: normalized.entries.length,
    tombstone_count: normalized.tombstones.length,
    finding_count: findings.length,
    findings,
  };
}

function pathString(value) {
  if (value instanceof URL) {
    return fileURLToPath(value);
  }
  return String(value ?? "");
}

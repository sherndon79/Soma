import { fileURLToPath } from "node:url";

import { loadDurableMemoryStore, normalizeDurableMemoryStore } from "./durableMemory.js";
import { createDurableMemoryProvenanceFile } from "./durableMemoryProvenanceFile.js";
import { inspectDurableMemoryRecovery } from "./durableMemoryRecovery.js";

const DEFAULT_DURABLE_MEMORY_STORE_PATH = new URL("../config/durable-memory.json", import.meta.url);
const DEFAULT_DURABLE_MEMORY_PROVENANCE_PATH = new URL(
  "../config/durable-memory-mutations.ndjson",
  import.meta.url,
);

export async function loadDurableMemoryAuthority({
  durableMemoryStorePath = DEFAULT_DURABLE_MEMORY_STORE_PATH,
  durableMemoryProvenancePath = DEFAULT_DURABLE_MEMORY_PROVENANCE_PATH,
} = {}) {
  let durableMemoryStore;
  try {
    durableMemoryStore = await loadDurableMemoryStore(durableMemoryStorePath);
  } catch (error) {
    const emptyStore = normalizeDurableMemoryStore({ schema_version: 1, entries: [] });
    return {
      durableMemoryStore: emptyStore,
      durableMemoryRecoveryReport: unreadableDurableMemoryStoreRecoveryReport({ error }),
      durableMemoryStorePath: pathString(durableMemoryStorePath),
      durableMemoryProvenancePath: pathString(durableMemoryProvenancePath),
    };
  }
  const normalizedStore = normalizeDurableMemoryStore(durableMemoryStore);
  let provenanceEvents = [];
  try {
    provenanceEvents = await createDurableMemoryProvenanceFile({
      path: durableMemoryProvenancePath,
    }).read();
  } catch (error) {
    return {
      durableMemoryStore: normalizedStore,
      durableMemoryRecoveryReport: unreadableDurableMemoryProvenanceReport(normalizedStore, error),
      durableMemoryStorePath: pathString(durableMemoryStorePath),
      durableMemoryProvenancePath: pathString(durableMemoryProvenancePath),
    };
  }

  return {
    durableMemoryStore: normalizedStore,
    durableMemoryRecoveryReport: inspectDurableMemoryRecovery({
      store: normalizedStore,
      provenanceEvents,
    }),
    durableMemoryStorePath: pathString(durableMemoryStorePath),
    durableMemoryProvenancePath: pathString(durableMemoryProvenancePath),
  };
}

function unreadableDurableMemoryStoreRecoveryReport({ error } = {}) {
  return {
    ok: false,
    degraded: true,
    memory_store_status: "corrupt",
    memory_store_degraded_reason: "memory_durable_store_unreadable",
    entry_count: 0,
    finding_count: 1,
    findings: [
      {
        code: "memory_durable_store_unreadable",
        memory_id: "",
        role: "",
        source: "",
        grant_id: "",
        provider: "",
        scope: "",
        authorizing_safe: false,
        memory_store_status: "corrupt",
        memory_store_stage: "load",
        memory_store_error_code: String(error?.code ?? error?.name ?? "unknown"),
      },
    ],
  };
}

function unreadableDurableMemoryProvenanceReport(store, error) {
  const entries = normalizeDurableMemoryStore(store).entries;
  const findings = entries.map((entry) => ({
    code: "memory_durable_provenance_unreadable",
    memory_id: entry.id,
    role: entry.role,
    source: entry.source,
    grant_id: entry.grant_id,
    provider: entry.provider,
    scope: entry.scope,
    authorizing_safe: false,
    provenance_stage: String(error?.stage ?? "read"),
    provenance_error_code: String(error?.code ?? "unknown"),
  }));
  return {
    ok: findings.length === 0,
    degraded: findings.length > 0,
    entry_count: entries.length,
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

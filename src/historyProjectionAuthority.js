import { fileURLToPath } from "node:url";

import {
  DEFAULT_HISTORY_PROJECTION_PATH,
  loadHistoryProjectionStore,
  normalizeHistoryProjectionStore,
} from "./historyProjection.js";
import { createHistoryProjectionProvenanceFile } from "./historyProjectionProvenanceFile.js";

const DEFAULT_HISTORY_PROJECTION_PROVENANCE_PATH = new URL(
  "../config/history-projection-mutations.ndjson",
  import.meta.url,
);

export async function loadHistoryProjectionAuthority({
  historyProjectionStorePath = DEFAULT_HISTORY_PROJECTION_PATH,
  historyProjectionProvenancePath = DEFAULT_HISTORY_PROJECTION_PROVENANCE_PATH,
} = {}) {
  let historyProjectionStore;
  try {
    historyProjectionStore = await loadHistoryProjectionStore(historyProjectionStorePath);
  } catch (error) {
    const emptyStore = normalizeHistoryProjectionStore({ schema_version: 1, entries: [] });
    return {
      historyProjectionStore: emptyStore,
      historyProjectionRecoveryReport: unreadableHistoryProjectionStoreRecoveryReport({ error }),
      historyProjectionStorePath: pathString(historyProjectionStorePath),
      historyProjectionProvenancePath: pathString(historyProjectionProvenancePath),
    };
  }
  const normalizedStore = normalizeHistoryProjectionStore(historyProjectionStore);
  try {
    await createHistoryProjectionProvenanceFile({ path: historyProjectionProvenancePath }).read();
  } catch (error) {
    return {
      historyProjectionStore: normalizedStore,
      historyProjectionRecoveryReport: unreadableHistoryProjectionProvenanceReport(normalizedStore, error),
      historyProjectionStorePath: pathString(historyProjectionStorePath),
      historyProjectionProvenancePath: pathString(historyProjectionProvenancePath),
    };
  }
  return {
    historyProjectionStore: normalizedStore,
    historyProjectionRecoveryReport: cleanHistoryProjectionRecoveryReport(normalizedStore),
    historyProjectionStorePath: pathString(historyProjectionStorePath),
    historyProjectionProvenancePath: pathString(historyProjectionProvenancePath),
  };
}

export function cleanHistoryProjectionRecoveryReport(store = {}) {
  const entries = normalizeHistoryProjectionStore(store).entries;
  return {
    ok: true,
    degraded: false,
    entry_count: entries.length,
    finding_count: 0,
    findings: [],
  };
}

export function unreadableHistoryProjectionStoreRecoveryReport({ error } = {}) {
  return {
    ok: false,
    degraded: true,
    history_projection_store_status: "corrupt",
    history_projection_store_degraded_reason: "history_projection_store_unreadable",
    entry_count: 0,
    finding_count: 1,
    findings: [
      {
        code: "history_projection_store_unreadable",
        entry_id: "",
        domain: "",
        authorizing_safe: false,
        history_projection_store_status: "corrupt",
        history_projection_store_stage: "load",
        history_projection_store_error_code: String(error?.code ?? error?.name ?? "unknown"),
      },
    ],
  };
}

function unreadableHistoryProjectionProvenanceReport(store, error) {
  const entries = normalizeHistoryProjectionStore(store).entries;
  const findings = entries.map((entry) => ({
    code: "history_projection_provenance_unreadable",
    entry_id: entry.id,
    domain: entry.domain,
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

import { fileURLToPath } from "node:url";

import {
  DEFAULT_DURABLE_TESTIMONY_PATH,
  loadDurableTestimonyStore,
  normalizeDurableTestimonyStore,
} from "./durableTestimony.js";
import { createDurableTestimonyProvenanceFile } from "./durableTestimonyProvenanceFile.js";

const DEFAULT_DURABLE_TESTIMONY_PROVENANCE_PATH = new URL(
  "../config/durable-testimony-mutations.ndjson",
  import.meta.url,
);

export async function loadDurableTestimonyAuthority({
  durableTestimonyStorePath = DEFAULT_DURABLE_TESTIMONY_PATH,
  durableTestimonyProvenancePath = DEFAULT_DURABLE_TESTIMONY_PROVENANCE_PATH,
} = {}) {
  let durableTestimonyStore;
  try {
    durableTestimonyStore = await loadDurableTestimonyStore(durableTestimonyStorePath);
  } catch (error) {
    const emptyStore = normalizeDurableTestimonyStore({ schema_version: 1, entries: [] });
    return {
      durableTestimonyStore: emptyStore,
      durableTestimonyRecoveryReport: unreadableDurableTestimonyStoreRecoveryReport({ error }),
      durableTestimonyStorePath: pathString(durableTestimonyStorePath),
      durableTestimonyProvenancePath: pathString(durableTestimonyProvenancePath),
    };
  }
  const normalizedStore = normalizeDurableTestimonyStore(durableTestimonyStore);
  try {
    await createDurableTestimonyProvenanceFile({ path: durableTestimonyProvenancePath }).read();
  } catch (error) {
    return {
      durableTestimonyStore: normalizedStore,
      durableTestimonyRecoveryReport: unreadableDurableTestimonyProvenanceReport(normalizedStore, error),
      durableTestimonyStorePath: pathString(durableTestimonyStorePath),
      durableTestimonyProvenancePath: pathString(durableTestimonyProvenancePath),
    };
  }
  return {
    durableTestimonyStore: normalizedStore,
    durableTestimonyRecoveryReport: cleanDurableTestimonyRecoveryReport(normalizedStore),
    durableTestimonyStorePath: pathString(durableTestimonyStorePath),
    durableTestimonyProvenancePath: pathString(durableTestimonyProvenancePath),
  };
}

export function cleanDurableTestimonyRecoveryReport(store = {}) {
  const entries = normalizeDurableTestimonyStore(store).entries;
  return {
    ok: true,
    degraded: false,
    entry_count: entries.length,
    finding_count: 0,
    findings: [],
  };
}

export function unreadableDurableTestimonyStoreRecoveryReport({ error } = {}) {
  return {
    ok: false,
    degraded: true,
    testimony_store_status: "corrupt",
    testimony_store_degraded_reason: "testimony_durable_store_unreadable",
    entry_count: 0,
    finding_count: 1,
    findings: [
      {
        code: "testimony_durable_store_unreadable",
        testimony_id: "",
        domain: "",
        authorizing_safe: false,
        testimony_store_status: "corrupt",
        testimony_store_stage: "load",
        testimony_store_error_code: String(error?.code ?? error?.name ?? "unknown"),
      },
    ],
  };
}

function unreadableDurableTestimonyProvenanceReport(store, error) {
  const entries = normalizeDurableTestimonyStore(store).entries;
  const findings = entries.map((entry) => ({
    code: "testimony_durable_provenance_unreadable",
    testimony_id: entry.id,
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

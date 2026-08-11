import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createGrantMutationProvenanceFile } from "./grantMutationProvenanceFile.js";
import { inspectGrantMutationRecovery } from "./grantMutationRecovery.js";
import { loadGrantStore, normalizeGrantStore, publicGrant } from "./grants.js";

const DEFAULT_GRANT_STORE_PATH = new URL("../config/grants.json", import.meta.url);
const DEFAULT_GRANT_MUTATION_PROVENANCE_PATH = new URL(
  "../config/grant-mutations.ndjson",
  import.meta.url,
);

export async function loadGrantAuthority({
  grantStorePath = DEFAULT_GRANT_STORE_PATH,
  grantMutationProvenancePath = DEFAULT_GRANT_MUTATION_PROVENANCE_PATH,
} = {}) {
  let grantStore;
  try {
    grantStore = await loadGrantStore(grantStorePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      try {
        await initializeEmptyGrantStore(grantStorePath);
        grantStore = await loadGrantStore(grantStorePath);
      } catch (initializationError) {
        return unreadableGrantAuthority({
          grantStorePath,
          grantMutationProvenancePath,
          error: initializationError,
        });
      }
    } else {
      return unreadableGrantAuthority({
        grantStorePath,
        grantMutationProvenancePath,
        error,
      });
    }
  }
  const normalizedGrantStore = normalizeGrantStore(grantStore);
  let provenanceEvents = [];
  try {
    provenanceEvents = await createGrantMutationProvenanceFile({
      path: grantMutationProvenancePath,
    }).read();
  } catch (error) {
    return {
      grantStore: normalizedGrantStore,
      grantRecoveryReport: unreadableProvenanceRecoveryReport(normalizedGrantStore, error),
      grantStorePath: pathString(grantStorePath),
      grantMutationProvenancePath: pathString(grantMutationProvenancePath),
    };
  }

  return {
    grantStore: normalizedGrantStore,
    grantRecoveryReport: inspectGrantMutationRecovery({
      store: normalizedGrantStore,
      provenanceEvents,
    }),
    grantStorePath: pathString(grantStorePath),
    grantMutationProvenancePath: pathString(grantMutationProvenancePath),
  };
}

async function initializeEmptyGrantStore(grantStorePath) {
  const contents = `${JSON.stringify({
    schema_version: 1,
    grants: [],
    examples: [],
  }, null, 2)}\n`;
  try {
    await writeFile(grantStorePath, contents, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    // Another startup may have won the create-only race. The subsequent read
    // remains authoritative and will still fail closed if that file is invalid.
    if (error?.code !== "EEXIST") {
      throw error;
    }
  }
}

function unreadableGrantAuthority({
  grantStorePath,
  grantMutationProvenancePath,
  error,
}) {
  const emptyGrantStore = normalizeGrantStore({ schema_version: 1, grants: [], examples: [] });
  return {
    grantStore: emptyGrantStore,
    grantRecoveryReport: unreadableGrantStoreRecoveryReport({
      grantStorePath,
      error,
    }),
    grantStorePath: pathString(grantStorePath),
    grantMutationProvenancePath: pathString(grantMutationProvenancePath),
  };
}

function pathString(value) {
  if (value instanceof URL) {
    return fileURLToPath(value);
  }
  return String(value ?? "");
}

function unreadableGrantStoreRecoveryReport({ grantStorePath, error } = {}) {
  return {
    ok: false,
    degraded: true,
    grant_store_status: "corrupt",
    grant_store_degraded_reason: "grant_store_unreadable",
    grant_count: 0,
    finding_count: 1,
    findings: [
      {
        code: "grant_store_unreadable",
        grant_id: "",
        status: "",
        capability: "",
        provider: "",
        scope: "",
        authorizing_safe: false,
        grant_store_status: "corrupt",
        grant_store_stage: "load",
        grant_store_error_code: String(error?.code ?? error?.name ?? "unknown"),
      },
    ],
  };
}

function unreadableProvenanceRecoveryReport(store, error) {
  const grants = normalizeGrantStore(store).grants.map(publicGrant);
  const findings = grants.map((grant) => ({
    code: "grant_mutation_provenance_unreadable",
    grant_id: grant.id,
    status: grant.status,
    capability: grant.capability,
    provider: grant.provider,
    scope: grant.scope,
    authorizing_safe: false,
    provenance_stage: String(error?.stage ?? "read"),
    provenance_error_code: String(error?.code ?? "unknown"),
  }));
  return {
    ok: findings.length === 0,
    degraded: findings.length > 0,
    grant_count: grants.length,
    finding_count: findings.length,
    findings,
  };
}

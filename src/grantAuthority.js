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
  const grantStore = await loadGrantStore(grantStorePath);
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

function pathString(value) {
  if (value instanceof URL) {
    return fileURLToPath(value);
  }
  return String(value ?? "");
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

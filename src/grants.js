import { readFile } from "node:fs/promises";

const DEFAULT_GRANTS_PATH = new URL("../config/grants.json", import.meta.url);

export async function loadGrantStore(path = DEFAULT_GRANTS_PATH) {
  const raw = await readFile(path, "utf8");
  return normalizeGrantStore(JSON.parse(raw));
}

export function normalizeGrantStore(config = {}) {
  return {
    schema_version: config.schema_version ?? 1,
    grants: Array.isArray(config.grants) ? config.grants.map(publicGrant) : [],
  };
}

export function listGrants(store = normalizeGrantStore(), { status = "" } = {}) {
  const normalized = normalizeGrantStore(store);
  const statusFilter = String(status ?? "").trim();
  const grants = statusFilter
    ? normalized.grants.filter((grant) => grant.status === statusFilter)
    : normalized.grants;
  return grants.map(publicGrant);
}

export function summarizeGrants(store = normalizeGrantStore()) {
  const grants = normalizeGrantStore(store).grants;
  const byStatus = {};
  const byCapability = {};

  for (const grant of grants) {
    byStatus[grant.status] = (byStatus[grant.status] ?? 0) + 1;
    byCapability[grant.capability] = (byCapability[grant.capability] ?? 0) + 1;
  }

  return {
    total: grants.length,
    by_status: byStatus,
    by_capability: byCapability,
  };
}

export function publicGrant(grant = {}) {
  return {
    id: String(grant.id ?? ""),
    status: String(grant.status ?? "unknown"),
    capability: String(grant.capability ?? ""),
    provider: String(grant.provider ?? ""),
    scope: String(grant.scope ?? ""),
    constraints: objectOrEmpty(grant.constraints),
    approved_by: String(grant.approved_by ?? ""),
    reason: String(grant.reason ?? ""),
    created_at: String(grant.created_at ?? ""),
    review_required: Boolean(grant.review_required),
    revoked_at: grant.revoked_at ? String(grant.revoked_at) : null,
    activation_performed: Boolean(grant.activation_performed),
  };
}

function objectOrEmpty(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

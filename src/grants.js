import { readFile } from "node:fs/promises";

const DEFAULT_GRANTS_PATH = new URL("../config/grants.json", import.meta.url);
const TERMINAL_GRANT_STATUSES = new Set(["revoked", "superseded", "expired"]);

export async function loadGrantStore(path = DEFAULT_GRANTS_PATH) {
  const raw = await readFile(path, "utf8");
  return normalizeGrantStore(JSON.parse(raw));
}

export function normalizeGrantStore(config = {}) {
  return {
    schema_version: config.schema_version ?? 1,
    grants: Array.isArray(config.grants) ? config.grants.map(publicGrant) : [],
    examples: Array.isArray(config.examples) ? config.examples.map(publicGrant) : [],
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
    approval_provenance_id: String(grant.approval_provenance_id ?? ""),
    reason: String(grant.reason ?? ""),
    created_at: String(grant.created_at ?? ""),
    review_required: Boolean(grant.review_required),
    revoked_at: grant.revoked_at ? String(grant.revoked_at) : null,
    revoked_by: String(grant.revoked_by ?? ""),
    revocation_reason: String(grant.revocation_reason ?? ""),
    replacement_grant_id: String(grant.replacement_grant_id ?? ""),
    activation_performed: Boolean(grant.activation_performed),
  };
}

export class GrantMutationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "GrantMutationError";
    this.code = code;
    this.details = details;
  }
}

export function validateGrantCreate(input = {}, context = {}) {
  const capability = String(input.capability ?? "").trim();
  const provider = String(input.provider ?? "").trim();
  const scope = String(input.scope ?? "").trim();
  const constraints = objectOrEmpty(input.constraints);
  const approvedBy = String(input.approved_by ?? input.actor ?? "").trim();
  const reason = String(input.reason ?? "").trim();
  const createdAt = String(input.created_at ?? context.now?.() ?? new Date().toISOString());
  const approvalProvenanceId = String(input.approval_provenance_id ?? "").trim();
  const directUserAction = Boolean(input.direct_user_action);

  requireNonEmpty(capability, "missing_capability", "Grant creation requires a capability.");
  requireNonEmpty(provider, "missing_provider", "Grant creation requires a provider.");
  requireNonEmpty(scope, "missing_scope", "Grant creation requires a scope.");
  requireNonEmpty(reason, "missing_reason", "Grant creation requires a participant-facing reason.");
  requireUserApproval({
    approvedBy,
    approvalProvenanceId,
    directUserAction,
  });

  const capabilityDefinition = findCapability(context.catalog, capability);
  if (!capabilityDefinition) {
    throw new GrantMutationError(
      "unknown_capability",
      "Grant creation requires a known catalog capability.",
      { capability },
    );
  }

  const providerDefinition = findProvider(context.providerRegistry, provider);
  if (!providerDefinition) {
    throw new GrantMutationError(
      "unknown_provider",
      "Grant creation requires a known provider.",
      { provider },
    );
  }

  if (!providerSupportsCapability(providerDefinition, capability)) {
    throw new GrantMutationError(
      "unsupported_provider_capability",
      "Grant creation requires a provider that supports the requested capability.",
      { capability, provider },
    );
  }

  if (!isPlainObject(input.constraints)) {
    throw new GrantMutationError(
      "invalid_constraints",
      "Grant creation requires constraints to be an object.",
      { capability, provider },
    );
  }

  if (Array.isArray(capabilityDefinition.allowed_scopes)
    && capabilityDefinition.allowed_scopes.length > 0
    && !capabilityDefinition.allowed_scopes.includes(scope)) {
    throw new GrantMutationError(
      "unsupported_scope",
      "Grant creation scope is not allowed for the requested capability.",
      { capability, scope },
    );
  }

  return {
    id: String(input.id ?? context.createId?.() ?? "").trim(),
    status: "active",
    capability,
    provider,
    scope,
    constraints,
    approved_by: approvedBy,
    reason,
    created_at: createdAt,
    approval_provenance_id: approvalProvenanceId,
    review_required: Boolean(input.review_required),
    revoked_at: null,
    revoked_by: "",
    revocation_reason: "",
    replacement_grant_id: "",
    activation_performed: false,
  };
}

export function createGrant(store = normalizeGrantStore(), input = {}, context = {}) {
  const normalized = normalizeGrantStore(store);
  const grant = publicGrant(validateGrantCreate(input, context));
  if (!grant.id) {
    throw new GrantMutationError(
      "missing_grant_id",
      "Grant creation requires an id or id factory.",
    );
  }
  if (normalized.grants.some((existing) => existing.id === grant.id)) {
    throw new GrantMutationError(
      "duplicate_grant_id",
      "Grant creation requires a unique grant id.",
      { id: grant.id },
    );
  }
  return {
    ...normalized,
    grants: [...normalized.grants, grant],
  };
}

export function revokeGrant(store = normalizeGrantStore(), input = {}, context = {}) {
  const grantId = String(input.id ?? input.grant_id ?? "").trim();
  const revokedBy = String(input.revoked_by ?? input.actor ?? "").trim();
  const revocationReason = String(input.revocation_reason ?? input.reason ?? "").trim();
  const revokedAt = String(input.revoked_at ?? context.now?.() ?? new Date().toISOString());

  requireNonEmpty(grantId, "missing_grant_id", "Grant revocation requires a grant id.");
  requireNonEmpty(revokedBy, "missing_actor", "Grant revocation requires a revoking actor.");
  requireNonEmpty(
    revocationReason,
    "missing_revocation_reason",
    "Grant revocation requires a reason.",
  );

  return updateGrant(store, grantId, (grant) => {
    if (TERMINAL_GRANT_STATUSES.has(grant.status)) {
      return { grant, changed: false };
    }
    return {
      changed: true,
      grant: publicGrant({
        ...grant,
        status: "revoked",
        revoked_at: revokedAt,
        revoked_by: revokedBy,
        revocation_reason: revocationReason,
        activation_performed: false,
      }),
    };
  });
}

export function supersedeGrant(store = normalizeGrantStore(), input = {}, context = {}) {
  const grantId = String(input.id ?? input.grant_id ?? "").trim();
  const replacementGrantId = String(input.replacement_grant_id ?? "").trim();
  const revokedBy = String(input.revoked_by ?? input.actor ?? "").trim();
  const reason = String(input.revocation_reason ?? input.reason ?? "").trim();
  const revokedAt = String(input.revoked_at ?? context.now?.() ?? new Date().toISOString());

  requireNonEmpty(grantId, "missing_grant_id", "Grant supersession requires a grant id.");
  requireNonEmpty(
    replacementGrantId,
    "missing_replacement_grant_id",
    "Grant supersession requires a replacement grant id.",
  );
  requireNonEmpty(revokedBy, "missing_actor", "Grant supersession requires an actor.");
  requireNonEmpty(reason, "missing_revocation_reason", "Grant supersession requires a reason.");

  return updateGrant(store, grantId, (grant, normalized) => {
    if (!normalized.grants.some((candidate) => candidate.id === replacementGrantId)) {
      throw new GrantMutationError(
        "unknown_replacement_grant",
        "Grant supersession requires an existing replacement grant.",
        { replacement_grant_id: replacementGrantId },
      );
    }
    if (TERMINAL_GRANT_STATUSES.has(grant.status)) {
      return { grant, changed: false };
    }
    return {
      changed: true,
      grant: publicGrant({
        ...grant,
        status: "superseded",
        revoked_at: revokedAt,
        revoked_by: revokedBy,
        revocation_reason: reason,
        replacement_grant_id: replacementGrantId,
        activation_performed: false,
      }),
    };
  });
}

export function expireGrant(store = normalizeGrantStore(), input = {}, context = {}) {
  const grantId = String(input.id ?? input.grant_id ?? "").trim();
  const expiredAt = String(
    input.expired_at ?? input.revoked_at ?? context.now?.() ?? new Date().toISOString(),
  );
  const reason = String(
    input.expiration_reason ?? input.reason ?? "Grant scope or time boundary expired.",
  ).trim();

  requireNonEmpty(grantId, "missing_grant_id", "Grant expiration requires a grant id.");

  return updateGrant(store, grantId, (grant) => {
    if (TERMINAL_GRANT_STATUSES.has(grant.status)) {
      return { grant, changed: false };
    }
    return {
      changed: true,
      grant: publicGrant({
        ...grant,
        status: "expired",
        revoked_at: expiredAt,
        revoked_by: "system",
        revocation_reason: reason,
        activation_performed: false,
      }),
    };
  });
}

function objectOrEmpty(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function updateGrant(store, grantId, updater) {
  const normalized = normalizeGrantStore(store);
  const index = normalized.grants.findIndex((grant) => grant.id === grantId);
  if (index === -1) {
    throw new GrantMutationError(
      "unknown_grant",
      "Grant mutation requires an existing grant.",
      { id: grantId },
    );
  }
  const current = normalized.grants[index];
  const { grant, changed } = updater(current, normalized);
  const grants = [...normalized.grants];
  grants[index] = publicGrant(grant);
  return {
    ...normalized,
    grants,
    mutation: {
      changed: Boolean(changed),
      grant: grants[index],
    },
  };
}

function requireUserApproval({ approvedBy, approvalProvenanceId, directUserAction }) {
  if (approvedBy !== "user") {
    throw new GrantMutationError(
      "missing_user_actor",
      "Grant creation requires an explicit user actor.",
    );
  }
  if (!approvalProvenanceId && !directUserAction) {
    throw new GrantMutationError(
      "missing_user_decision",
      "Grant creation requires approval provenance or a direct explicit user action.",
    );
  }
}

function requireNonEmpty(value, code, message) {
  if (!value) {
    throw new GrantMutationError(code, message);
  }
}

function findCapability(catalog = {}, key) {
  const capabilities = Array.isArray(catalog.capabilities) ? catalog.capabilities : [];
  return capabilities.find((capability) => capability.key === key) ?? null;
}

function findProvider(providerRegistry = {}, providerId) {
  const providers = Array.isArray(providerRegistry.providers) ? providerRegistry.providers : [];
  return providers.find((provider) => provider.id === providerId) ?? null;
}

function providerSupportsCapability(provider, key) {
  const capabilities = Array.isArray(provider.capabilities) ? provider.capabilities : [];
  return capabilities.some((entry) => {
    if (typeof entry === "string") {
      return entry === key;
    }
    return entry?.key === key;
  });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

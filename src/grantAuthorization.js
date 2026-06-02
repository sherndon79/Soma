import { normalizeGrantStore, publicGrant } from "./grants.js";

const SUPPORTED_GRANT_SCHEMA_VERSION = 1;

export function authorizeGrantUse({
  store,
  grantId = "",
  capability = "",
  provider = "",
  scope = "session",
  recoveryReport = null,
  catalog = null,
  providerRegistry = null,
} = {}) {
  const requested = {
    grant_id: String(grantId ?? "").trim(),
    capability: String(capability ?? "").trim(),
    provider: String(provider ?? "").trim(),
    scope: String(scope ?? "session").trim() || "session",
  };
  const normalized = normalizeGrantStore(store);

  if (Number(normalized.schema_version) > SUPPORTED_GRANT_SCHEMA_VERSION) {
    return denied("grant_store_schema_unsupported", {
      schema_version: normalized.schema_version,
      supported_schema_version: SUPPORTED_GRANT_SCHEMA_VERSION,
    });
  }

  const recoveryFindings = Array.isArray(recoveryReport?.findings)
    ? recoveryReport.findings.filter((finding) => finding?.authorizing_safe === false)
    : [];
  const globalRecoveryFindings = recoveryFindings.filter(
    (finding) => !String(finding?.grant_id ?? "").trim(),
  );
  if (globalRecoveryFindings.length > 0) {
    return denied("grant_recovery_degraded", {
      grant_id: requested.grant_id,
      findings: globalRecoveryFindings,
    });
  }

  const candidates = normalized.grants
    .map(publicGrant)
    .filter((grant) => grantMatchesRequest(grant, requested));

  for (const grant of candidates) {
    const grantRecoveryFindings = recoveryFindings.filter(
      (finding) => finding.grant_id === grant.id,
    );
    if (grantRecoveryFindings.length > 0) {
      return denied("grant_recovery_degraded", {
        grant_id: grant.id,
        findings: grantRecoveryFindings,
      });
    }

    const catalogDenial = validateCatalogCapability(catalog, requested.capability);
    if (catalogDenial) {
      return catalogDenial;
    }

    const providerDenial = validateProviderCapability(
      providerRegistry,
      grant.provider,
      requested.capability,
    );
    if (providerDenial) {
      return providerDenial;
    }

    return {
      allowed: true,
      code: "grant_authorized",
      grant,
      recovery_required: false,
      findings: [],
    };
  }

  return denied("grant_not_found", requested);
}

export function recoveryFindingsForGrant(recoveryReport = null, grantId = "") {
  const id = String(grantId ?? "");
  const findings = Array.isArray(recoveryReport?.findings) ? recoveryReport.findings : [];
  return findings.filter((finding) => finding?.grant_id === id);
}

function grantMatchesRequest(grant, requested) {
  return (!requested.grant_id || grant.id === requested.grant_id)
    && grant.status === "active"
    && grant.capability === requested.capability
    && (!requested.provider || grant.provider === requested.provider)
    && (grant.scope || "session") === requested.scope;
}

function validateCatalogCapability(catalog, capability) {
  if (!catalog) {
    return null;
  }
  const capabilities = Array.isArray(catalog.capabilities) ? catalog.capabilities : [];
  const definition = capabilities.find((entry) => entry?.key === capability);
  if (!definition) {
    return denied("grant_capability_not_in_catalog", { capability });
  }
  return null;
}

function validateProviderCapability(providerRegistry, providerId, capability) {
  if (!providerRegistry) {
    return null;
  }
  const providers = Array.isArray(providerRegistry.providers) ? providerRegistry.providers : [];
  const provider = providers.find((entry) => entry?.id === providerId);
  if (!provider) {
    return denied("grant_provider_not_in_registry", { provider: providerId });
  }
  const capabilities = Array.isArray(provider.capabilities) ? provider.capabilities : [];
  const supported = capabilities.some((entry) => (
    typeof entry === "string" ? entry === capability : entry?.key === capability
  ));
  if (!supported) {
    return denied("grant_provider_capability_mismatch", {
      provider: providerId,
      capability,
    });
  }
  return null;
}

function denied(code, details = {}) {
  return {
    allowed: false,
    code,
    grant: null,
    recovery_required: code === "grant_recovery_degraded",
    findings: Array.isArray(details.findings) ? details.findings : [],
    details,
  };
}

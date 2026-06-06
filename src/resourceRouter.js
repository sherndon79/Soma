import { resolveFileResourceDescriptor } from "./fileAccess.js";

const DEFAULT_PROVENANCE_SUMMARY_PROVIDER_ID = "soma.provider.provenance-summary";
const DEFAULT_MAX_EVENTS_CONSIDERED = 1000;

export async function resolveResourceDescriptor({
  domain = "operational",
  capability = "",
  ref = {},
  grant = null,
  harness = {},
  baseDir = process.cwd(),
  providerRegistry = {},
} = {}) {
  if (capability === "tool.files.read") {
    return resolveFileResourceDescriptor({ domain, capability, ref, grant, harness, baseDir });
  }
  if (capability === "provenance.summary.read") {
    return resolveProvenanceSummaryResourceDescriptor({ domain, capability, ref, grant, harness, providerRegistry });
  }
  throw resourceRouterError("resource_capability_unrouted", "No resource router is registered for this capability.", 400);
}

export function resolveProvenanceSummaryResourceDescriptor({
  domain = "operational",
  capability = "provenance.summary.read",
  ref = {},
  grant = null,
  harness = {},
  providerRegistry = {},
} = {}) {
  if (capability !== "provenance.summary.read") {
    throw resourceRouterError(
      "provenance_summary_capability_invalid",
      "Provenance summary router only resolves provenance.summary.read.",
      400,
    );
  }
  const normalizedDomain = normalizeResourceDomain(domain);
  const episodeId = boundedDescriptorString(ref.episode_id ?? ref.episodeId, "episode_id");
  if (!episodeId) {
    throw resourceRouterError("provenance_summary_episode_required", "Provenance summary requires an episode_id.", 400);
  }
  return {
    domain: normalizedDomain,
    capability,
    provider_id: providerForCapability(providerRegistry, capability) || DEFAULT_PROVENANCE_SUMMARY_PROVIDER_ID,
    resource_class: "internal_provenance",
    scope: {
      episode_id: episodeId,
      domain: normalizedDomain,
    },
    synthetic: normalizedDomain === "testing",
    max_events_considered: normalizeMaxEvents(ref.max_events_considered ?? harness.provenance?.max_summary_events),
    grant_id: grant?.id ?? "",
  };
}

function normalizeResourceDomain(domain) {
  const value = String(domain ?? "").trim() || "operational";
  if (!["testing", "operational"].includes(value)) {
    throw resourceRouterError("resource_domain_invalid", "Resource domain must be testing or operational.", 400);
  }
  return value;
}

function normalizeMaxEvents(value) {
  const number = Number(value);
  if (Number.isInteger(number) && number > 0 && number <= DEFAULT_MAX_EVENTS_CONSIDERED) {
    return number;
  }
  return DEFAULT_MAX_EVENTS_CONSIDERED;
}

function boundedDescriptorString(value, field) {
  const text = String(value ?? "").trim();
  if (text.length > 512) {
    throw resourceRouterError("invalid_resource_descriptor", `Resource descriptor ${field} is too long.`, 400);
  }
  return text;
}

function providerForCapability(providerRegistry = {}, capability = "") {
  const providers = Array.isArray(providerRegistry.providers) ? providerRegistry.providers : [];
  const matches = providers.filter((provider) => {
    const capabilities = Array.isArray(provider.capabilities) ? provider.capabilities : [];
    return capabilities.some((entry) => (typeof entry === "string" ? entry : entry?.key) === capability);
  });
  return matches.length === 1 ? matches[0].id : "";
}

function resourceRouterError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

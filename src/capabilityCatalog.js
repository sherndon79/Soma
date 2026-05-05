import { readFile } from "node:fs/promises";

const DEFAULT_CATALOG_PATH = new URL("../config/capability-catalog.json", import.meta.url);
const DEFAULT_PROVIDER_REGISTRY_PATH = new URL("../config/provider-registry.json", import.meta.url);

export async function loadCapabilityCatalog(path = DEFAULT_CATALOG_PATH) {
  const raw = await readFile(path, "utf8");
  return normalizeCapabilityCatalog(JSON.parse(raw));
}

export async function loadProviderRegistry(path = DEFAULT_PROVIDER_REGISTRY_PATH) {
  const raw = await readFile(path, "utf8");
  return normalizeProviderRegistry(JSON.parse(raw));
}

export function normalizeCapabilityCatalog(config) {
  return {
    schema_version: config.schema_version ?? 1,
    capabilities: Array.isArray(config.capabilities) ? config.capabilities : [],
  };
}

export function normalizeProviderRegistry(config) {
  return {
    schema_version: config.schema_version ?? 1,
    providers: Array.isArray(config.providers) ? config.providers : [],
  };
}

export function buildCapabilityView({
  catalog = normalizeCapabilityCatalog({}),
  providerRegistry = normalizeProviderRegistry({}),
  harness,
} = {}) {
  const capabilities = catalog.capabilities.map((capability) => {
    const harnessCapability = findHarnessCapability(harness, capability.key);
    const providers = providersForCapability(providerRegistry, capability.key);
    const harnessStatus = harnessCapability?.status ?? capability.default_status ?? "disabled";
    const supportStatus = providers.length > 0 ? "supported" : "unsupported";
    const status = classifyCapabilityStatus({
      capability,
      harnessStatus,
      supported: providers.length > 0,
    });

    return {
      key: capability.key,
      name: capability.name ?? capability.key,
      category: capability.category ?? "uncategorized",
      status,
      harness_status: harnessStatus,
      support_status: supportStatus,
      risk_class: capability.risk_class ?? "unknown",
      activation_policy: capability.activation_policy ?? "",
      allowed_scopes: capability.allowed_scopes ?? [],
      data_exposed: capability.data_exposed ?? [],
      excluded_by_default: capability.excluded_by_default ?? [],
      reversible: capability.reversible ?? null,
      provider_contract: capability.provider_contract ?? "",
      providers: providers.map(publicProvider),
      description: capability.description ?? "",
    };
  });

  return {
    schema_version: 1,
    capabilities,
    grouped: groupCapabilities(capabilities),
    summary: summarizeCapabilities(capabilities),
    durable: false,
  };
}

function classifyCapabilityStatus({ capability, harnessStatus, supported }) {
  if (harnessStatus === "allowed") {
    return "active";
  }
  if (harnessStatus === "module_disabled") {
    return "excluded";
  }
  if (capability.activation_policy === "forbidden" || harnessStatus === "forbidden") {
    return "forbidden";
  }
  if (!supported) {
    return "unsupported";
  }
  if (harnessStatus === "disabled" && capability.activation_policy === "explicit_grant") {
    return "requestable";
  }
  return "disabled";
}

function findHarnessCapability(harness, key) {
  return harness?.capabilities?.find((capability) => capability.key === key) ?? null;
}

function providersForCapability(registry, key) {
  return registry.providers.filter((provider) => {
    const capabilities = Array.isArray(provider.capabilities) ? provider.capabilities : [];
    return capabilities.some((entry) => capabilityKey(entry) === key);
  });
}

function capabilityKey(entry) {
  if (typeof entry === "string") {
    return entry;
  }
  return entry?.key ?? "";
}

function publicProvider(provider) {
  return {
    id: provider.id,
    name: provider.name ?? provider.id,
    version: provider.version ?? "",
    runtime: provider.runtime ?? "",
    local_only: Boolean(provider.local_only),
    network_access: Boolean(provider.network_access),
  };
}

function groupCapabilities(capabilities) {
  const grouped = {};
  for (const capability of capabilities) {
    const category = capability.category || "uncategorized";
    grouped[category] ??= {
      total: 0,
      by_status: {},
      capabilities: [],
    };
    grouped[category].total += 1;
    grouped[category].by_status[capability.status] = (
      grouped[category].by_status[capability.status] ?? 0
    ) + 1;
    grouped[category].capabilities.push(capability.key);
  }
  return grouped;
}

function summarizeCapabilities(capabilities) {
  const byStatus = {};
  const byCategory = {};
  for (const capability of capabilities) {
    byStatus[capability.status] = (byStatus[capability.status] ?? 0) + 1;
    byCategory[capability.category] ??= {};
    byCategory[capability.category][capability.status] = (
      byCategory[capability.category][capability.status] ?? 0
    ) + 1;
  }
  return {
    total: capabilities.length,
    by_status: byStatus,
    by_category: byCategory,
  };
}

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_RECEIPT_DIR = new URL("../docs/capability-design-implementations/", import.meta.url);

export async function loadCapabilityDesignImplementationReceipts(dir = DEFAULT_RECEIPT_DIR) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  const receipts = [];
  for (const file of files) {
    const raw = await readFile(new URL(file, ensureDirectoryUrl(dir)), "utf8");
    receipts.push({
      ...JSON.parse(raw),
      receipt_file: file,
    });
  }
  return receipts;
}

export function validateCapabilityDesignImplementationReceipts(receipts = [], context = {}) {
  return receipts.map((receipt) => validateCapabilityDesignImplementationReceipt(receipt, context));
}

export function validateCapabilityDesignImplementationReceipt(receipt = {}, {
  catalog = {},
  providerRegistry = {},
} = {}) {
  const errors = [];
  const implementedAs = stringValue(receipt.implemented_as);
  const sourceCapability = stringValue(receipt.source_design?.capability);
  const renamedFrom = stringValue(receipt.renamed_from);
  const providerId = stringValue(receipt.provider);
  const providerContract = stringValue(receipt.provider_contract);

  requireString(receipt.receipt_type, "capability_design_implementation", "receipt_type", errors);
  requireString(implementedAs, "", "implemented_as", errors);
  requireString(sourceCapability, "", "source_design.capability", errors);
  requireString(providerId, "", "provider", errors);
  requireString(providerContract, "", "provider_contract", errors);
  requireString(receipt.implemented_by, "", "implemented_by", errors);

  if (sourceCapability && implementedAs && implementedAs !== sourceCapability && renamedFrom !== sourceCapability) {
    errors.push("implemented_as must match source_design.capability unless renamed_from documents the source key");
  }

  if (!Array.isArray(receipt.tests) || receipt.tests.length === 0) {
    errors.push("tests must include at least one test reference");
  }

  const authority = receipt.authority ?? {};
  if (authority.receipt_confers_authority !== false) {
    errors.push("authority.receipt_confers_authority must be false");
  }
  if (authority.grant_written !== false) {
    errors.push("authority.grant_written must be false");
  }
  if (authority.activation_performed !== false) {
    errors.push("authority.activation_performed must be false");
  }
  if (authority.catalog_mutation_runtime !== false) {
    errors.push("authority.catalog_mutation_runtime must be false");
  }

  const capability = findCapability(catalog, implementedAs);
  if (!capability) {
    errors.push(`implemented_as ${implementedAs || "<missing>"} must exist in the capability catalog`);
  } else if (providerContract && capability.provider_contract !== providerContract) {
    errors.push("provider_contract must match the catalog capability provider_contract");
  }

  const provider = findProvider(providerRegistry, providerId);
  if (!provider) {
    errors.push(`provider ${providerId || "<missing>"} must exist in the provider registry`);
  } else {
    const claim = findProviderClaim(provider, implementedAs);
    if (!claim) {
      errors.push(`provider ${providerId} must claim implemented_as ${implementedAs || "<missing>"}`);
    } else if (providerContract && claim.provider_contract !== providerContract) {
      errors.push("provider_contract must match the provider capability claim");
    }
  }

  if (errors.length > 0) {
    const error = new Error(`Invalid capability design implementation receipt: ${errors.join("; ")}`);
    error.code = "invalid_capability_design_implementation_receipt";
    error.validation_errors = errors;
    error.receipt_file = receipt.receipt_file ?? "";
    throw error;
  }

  return {
    receipt_file: receipt.receipt_file ?? "",
    implemented_as: implementedAs,
    source_design_capability: sourceCapability,
    provider: providerId,
    provider_contract: providerContract,
    tests: [...receipt.tests],
    receipt_confers_authority: false,
  };
}

function ensureDirectoryUrl(dir) {
  if (dir instanceof URL) {
    return dir;
  }
  return new URL(`${path.resolve(String(dir))}${path.sep}`, "file:");
}

function requireString(value, expected, field, errors) {
  const normalized = stringValue(value);
  if (!normalized) {
    errors.push(`${field} is required`);
    return;
  }
  if (expected && normalized !== expected) {
    errors.push(`${field} must be ${expected}`);
  }
}

function findCapability(catalog = {}, key = "") {
  const capabilities = Array.isArray(catalog.capabilities) ? catalog.capabilities : [];
  return capabilities.find((entry) => entry?.key === key) ?? null;
}

function findProvider(providerRegistry = {}, providerId = "") {
  const providers = Array.isArray(providerRegistry.providers) ? providerRegistry.providers : [];
  return providers.find((entry) => entry?.id === providerId) ?? null;
}

function findProviderClaim(provider = {}, key = "") {
  const capabilities = Array.isArray(provider.capabilities) ? provider.capabilities : [];
  return capabilities.find((entry) => (typeof entry === "string" ? entry === key : entry?.key === key)) ?? null;
}

function stringValue(value) {
  return String(value ?? "").trim();
}

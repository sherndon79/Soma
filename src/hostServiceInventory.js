import { createHash, randomBytes } from "node:crypto";

import {
  HOST_SERVICE_OPERATIONAL_PROVIDER_ID,
  HOST_SERVICE_SYNTHETIC_PROVIDER_ID,
  hostServiceError,
} from "./hostServiceContracts.js";

const CATEGORICAL_EXCLUSION_CLASSES = new Set([
  "confirmation_path",
  "observation_path",
  "soma_control_plane",
  "propagation_coupled",
]);

export function createHostServiceInventory(config = {}) {
  const domain = normalizeDomain(config.domain);
  const providerId = requiredString(
    config.provider_id
      ?? (domain === "testing" ? HOST_SERVICE_SYNTHETIC_PROVIDER_ID : HOST_SERVICE_OPERATIONAL_PROVIDER_ID),
    "provider_id",
  );
  const host = Object.freeze({
    host_id: requiredString(config.host_id, "host_id"),
    inventory_generation: requiredString(config.inventory_generation, "inventory_generation"),
    identity_generation: requiredString(config.identity_generation, "identity_generation"),
    provider_id: providerId,
    domain,
  });
  const units = new Map();
  for (const rawUnit of Array.isArray(config.units) ? config.units : []) {
    const unit = normalizeInventoryUnit(rawUnit);
    if (units.has(unit.inventory_id)) {
      throw hostServiceError("service_inventory_invalid", "Service inventory ids must be unique.");
    }
    units.set(unit.inventory_id, unit);
  }
  return Object.freeze({
    host,
    generation: host.inventory_generation,
    getUnit(inventoryId) {
      return units.get(String(inventoryId ?? "")) ?? null;
    },
    listEligibleUnitIds() {
      return [...units.values()].filter((unit) => unit.eligible).map((unit) => unit.inventory_id);
    },
  });
}

export function createHostServiceHandleTable({
  now = () => Date.now(),
  random = () => randomBytes(24).toString("hex"),
  ttlMs = 5 * 60_000,
} = {}) {
  const entries = new Map();

  return Object.freeze({
    mint({ inventory, inventory_id, task_id, grant_id, provider_id, domain, expires_at } = {}) {
      const unit = requireEligibleUnit(inventory, inventory_id);
      const host = inventory.host;
      assertExact(provider_id, host.provider_id, "service_handle_provider_mismatch");
      assertExact(domain, host.domain, "service_handle_domain_mismatch");
      const taskId = requiredString(task_id, "task_id");
      const grantId = requiredString(grant_id, "grant_id");
      const handle = `svc_${random()}`;
      const expiresAt = Math.min(
        numericExpiry(expires_at, now() + ttlMs),
        now() + ttlMs,
      );
      entries.set(handle, Object.freeze({
        handle,
        task_id: taskId,
        grant_id: grantId,
        provider_id: host.provider_id,
        domain: host.domain,
        host_id: host.host_id,
        host_inventory_generation: host.inventory_generation,
        host_identity_generation: host.identity_generation,
        unit_inventory_id: unit.inventory_id,
        unit_inventory_generation: unit.inventory_generation,
        unit_name: unit.unit_name,
        fixture_id: unit.fixture_id,
        expires_at: expiresAt,
      }));
      return handle;
    },
    resolve({ handle, inventory, task_id, grant_id, provider_id, domain } = {}) {
      const entry = entries.get(String(handle ?? ""));
      if (!entry) {
        throw hostServiceError("service_handle_invalid", "Service handle is invalid.", 403);
      }
      if (entry.expires_at <= now()) {
        entries.delete(entry.handle);
        throw hostServiceError("service_handle_expired", "Service handle has expired.", 403);
      }
      assertExact(task_id, entry.task_id, "service_handle_invalid");
      assertExact(grant_id, entry.grant_id, "service_handle_invalid");
      assertExact(provider_id, entry.provider_id, "service_handle_invalid");
      assertExact(domain, entry.domain, "service_handle_invalid");
      const host = inventory?.host;
      const unit = inventory?.getUnit(entry.unit_inventory_id);
      if (
        !host
        || host.host_id !== entry.host_id
        || host.inventory_generation !== entry.host_inventory_generation
        || host.identity_generation !== entry.host_identity_generation
        || !unit
        || unit.inventory_generation !== entry.unit_inventory_generation
      ) {
        throw hostServiceError("service_inventory_drift", "Service inventory changed after handle issuance.", 409);
      }
      return entry;
    },
    revokeHandle(handle) {
      return entries.delete(String(handle ?? ""));
    },
    revokeTask(taskId) {
      deleteMatching(entries, (entry) => entry.task_id === taskId);
    },
    revokeGrant(grantId) {
      deleteMatching(entries, (entry) => entry.grant_id === grantId);
    },
    clear() {
      entries.clear();
    },
    size() {
      return entries.size;
    },
  });
}

export function hostServiceDescriptorDigest(descriptor = {}) {
  return createHash("sha256").update(stableJson(descriptor)).digest("hex");
}

function normalizeInventoryUnit(raw = {}) {
  const inventoryId = requiredString(raw.inventory_id, "inventory_id");
  const unitName = requiredString(raw.unit_name, "unit_name");
  const exclusionClasses = Array.isArray(raw.exclusion_classes)
    ? raw.exclusion_classes.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  const affectedClosure = Array.isArray(raw.affected_closure)
    ? raw.affected_closure.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  const unitTypeAllowed = unitName.endsWith(".service") && !unitName.includes("@");
  const categoricallyExcluded = exclusionClasses.some((value) => CATEGORICAL_EXCLUSION_CLASSES.has(value));
  const targetOnly = affectedClosure.length === 1 && affectedClosure[0] === inventoryId;
  const eligible = raw.allowlisted === true
    && unitTypeAllowed
    && raw.socket_activated !== true
    && raw.dbus_activated !== true
    && !categoricallyExcluded
    && targetOnly;
  return Object.freeze({
    inventory_id: inventoryId,
    inventory_generation: requiredString(raw.inventory_generation, "inventory_generation"),
    unit_name: unitName,
    fixture_id: String(raw.fixture_id ?? ""),
    allowlisted: raw.allowlisted === true,
    socket_activated: raw.socket_activated === true,
    dbus_activated: raw.dbus_activated === true,
    exclusion_classes: Object.freeze(exclusionClasses),
    affected_closure: Object.freeze(affectedClosure),
    required_active_state: "active",
    required_sub_state: "running",
    eligible,
  });
}

function requireEligibleUnit(inventory, inventoryId) {
  const unit = inventory?.getUnit(inventoryId);
  if (!unit || !unit.allowlisted) {
    throw hostServiceError("service_unit_not_allowlisted", "Service is not in the reviewed inventory.", 403);
  }
  if (!unit.unit_name.endsWith(".service") || unit.unit_name.includes("@")) {
    throw hostServiceError("service_unit_type_unsupported", "Service unit type is unsupported.", 403);
  }
  if (unit.socket_activated || unit.dbus_activated) {
    throw hostServiceError("service_unit_activation_unsupported", "Service activation posture is unsupported.", 403);
  }
  if (!unit.eligible) {
    throw hostServiceError("service_unit_dependency_closure_unsafe", "Service dependency closure is unsafe.", 403);
  }
  return unit;
}

function normalizeDomain(value) {
  const domain = String(value ?? "operational").trim();
  if (!["testing", "operational"].includes(domain)) {
    throw hostServiceError("resource_domain_invalid", "Resource domain must be testing or operational.");
  }
  return domain;
}

function requiredString(value, field) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 512) {
    throw hostServiceError("service_inventory_invalid", `Service inventory requires a bounded ${field}.`);
  }
  return text;
}

function assertExact(actual, expected, code) {
  if (String(actual ?? "") !== expected) {
    throw hostServiceError(code, "Service authority binding mismatch.", 403);
  }
}

function numericExpiry(value, fallback) {
  const number = typeof value === "number" ? value : Date.parse(String(value ?? ""));
  return Number.isFinite(number) ? number : fallback;
}

function deleteMatching(entries, predicate) {
  for (const [key, entry] of entries) {
    if (predicate(entry)) {
      entries.delete(key);
    }
  }
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

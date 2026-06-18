const STATUS_VALUES = {
  load_state: new Set(["loaded", "not_found", "masked", "unknown"]),
  active_state: new Set(["active", "inactive", "failed", "activating", "deactivating", "reloading", "unknown"]),
  sub_state: new Set(["running", "dead", "failed", "start", "stop", "reload", "unknown"]),
  unit_file_state_class: new Set(["enabled", "disabled", "static", "masked", "transient", "unknown"]),
  restart_policy_class: new Set(["allowed_with_confirmation", "not_allowlisted", "unsupported", "unknown"]),
  state_changed_at_bucket: new Set(["recent", "stale", "unknown"]),
};

export const HOST_SERVICE_STATUS_CAPABILITY = "host.service.status.read";
export const HOST_SERVICE_RESTART_CAPABILITY = "host.service.restart";
export const HOST_SERVICE_OPERATIONAL_PROVIDER_ID = "soma.provider.systemd-local";
export const HOST_SERVICE_SYNTHETIC_PROVIDER_ID = "soma.provider.synthetic-systemd";

export const HOST_SERVICE_CONSEQUENCE_CLASS = Object.freeze({
  [HOST_SERVICE_STATUS_CAPABILITY]: "C0",
  [HOST_SERVICE_RESTART_CAPABILITY]: "C3",
});

export function normalizeHostServiceStatus(raw = {}, { serviceHandle = "", observationGeneration = "" } = {}) {
  const normalized = {
    service_handle: boundedOpaqueValue(serviceHandle, "service_handle"),
    observation_generation: boundedOpaqueValue(observationGeneration, "observation_generation"),
    load_state: enumValue(raw.load_state, STATUS_VALUES.load_state),
    active_state: enumValue(raw.active_state, STATUS_VALUES.active_state),
    sub_state: enumValue(raw.sub_state, STATUS_VALUES.sub_state),
    unit_file_state_class: enumValue(raw.unit_file_state_class, STATUS_VALUES.unit_file_state_class),
    can_restart: raw.can_restart === true,
    restart_policy_class: enumValue(raw.restart_policy_class, STATUS_VALUES.restart_policy_class),
    state_changed_at_bucket: enumValue(raw.state_changed_at_bucket, STATUS_VALUES.state_changed_at_bucket),
    healthy: raw.healthy === true,
    content_included: false,
    identifiers_included: false,
  };
  if (!normalized.service_handle || !normalized.observation_generation) {
    throw hostServiceError("service_status_output_invalid", "Synthetic service status lacks required opaque identity.", 502);
  }
  return Object.freeze(normalized);
}

export function hostServiceStatusProvenancePreview({ descriptor = {}, result = {}, allowed = true, code = "" } = {}) {
  return Object.freeze({
    event_type: "host.service.status.read",
    allowed: Boolean(allowed),
    code: String(code ?? ""),
    capability: HOST_SERVICE_STATUS_CAPABILITY,
    provider: String(descriptor.provider_id ?? ""),
    domain: String(descriptor.domain ?? ""),
    task_id: String(descriptor.task_id ?? ""),
    grant_id: String(descriptor.grant_id ?? ""),
    descriptor_digest: String(descriptor.descriptor_digest ?? ""),
    load_state: String(result.load_state ?? "unknown"),
    active_state: String(result.active_state ?? "unknown"),
    sub_state: String(result.sub_state ?? "unknown"),
    healthy: result.healthy === true,
    content_included: false,
    identifiers_included: false,
  });
}

export function hostServiceError(code, message, statusCode = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function enumValue(value, allowed) {
  const normalized = String(value ?? "").trim();
  return allowed.has(normalized) ? normalized : "unknown";
}

function boundedOpaqueValue(value, field) {
  const normalized = String(value ?? "").trim();
  if (normalized.length > 256) {
    throw hostServiceError("service_status_output_invalid", `${field} exceeds the opaque value limit.`, 502);
  }
  return normalized;
}

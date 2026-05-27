const STATUS_SCHEMA_VERSION = 1;

const ALLOWED_STATES = new Set([
  "unconfigured",
  "configured_inactive",
  "provider_unreachable",
  "degraded",
  "ready_inactive",
]);

const FORBIDDEN_PATHS = [
  "password",
  "secret",
  "token",
  "api_key",
  "private_key",
  "credential",
  "credentials",
  "pairing_pin",
  "frame",
  "frames",
  "frame_bytes",
  "image",
  "image_bytes",
  "screenshot",
  "screenshot_bytes",
  "ocr_text",
  "recognized_text",
  "clipboard",
  "input_events",
  "keyboard_events",
  "pointer_events",
  "audio",
  "audio_bytes",
  "stdout",
  "stderr",
  "logs",
  "raw_diagnostics",
  "transport_logs",
  "stack",
  "stack_trace",
  "environment",
  "env",
  "command",
  "argv",
  "process",
];

export function createRemoteGraphicalLiveBrokerStatus(value = {}) {
  if (!isPlainObject(value)) {
    throwStatusError("remote_graphical_live_status_not_object", "live broker status must be an object");
  }

  assertNoForbiddenFields(value);

  const schemaVersion = integerOrDefault(value.schema_version, STATUS_SCHEMA_VERSION);
  const provider = stringValue(value.provider);
  const targetHost = stringValue(value.target_host ?? value.targetHost);
  const status = stringValue(value.status) || defaultStatus(value);
  const state = stringValue(value.state) || defaultState(value);
  const configured = Boolean(value.configured);
  const reachable = value.reachable === undefined ? null : Boolean(value.reachable);
  const degraded = Boolean(value.degraded);
  const retryable = value.retryable === undefined ? null : Boolean(value.retryable);
  const activeCount = nonNegativeInteger(value.active_count);

  const errors = [];
  if (!Number.isInteger(schemaVersion) || schemaVersion <= 0) {
    errors.push("schema_version must be a positive integer");
  }
  if (configured && !provider) {
    errors.push("configured live broker status requires provider");
  }
  if (configured && !targetHost) {
    errors.push("configured live broker status requires target_host");
  }
  if (!ALLOWED_STATES.has(state)) {
    errors.push(`state must be one of ${Array.from(ALLOWED_STATES).join(", ")}`);
  }
  if (!Array.isArray(value.capabilities) && value.capabilities !== undefined) {
    errors.push("capabilities must be an array when provided");
  }
  if (errors.length > 0) {
    throwStatusError("remote_graphical_live_status_invalid", errors.join("; "));
  }

  return {
    schema_version: schemaVersion,
    schema_matches_expected: schemaVersion === STATUS_SCHEMA_VERSION,
    expected_schema_version: STATUS_SCHEMA_VERSION,
    family: "desktop.remote_graphical",
    provider,
    target_host: targetHost,
    status,
    state,
    configured,
    reachable,
    degraded,
    retryable,
    active_count: activeCount,
    capabilities: stringList(value.capabilities),
    summary: boundedSummary(value.summary, status, state),
    activation_performed: false,
    broker_called: false,
    session_opened: false,
    pairing_performed: false,
    video_attached: false,
    input_dispatched: false,
    recording_started: false,
    provider_session_stopped: false,
    model_delivery: false,
    live_transport_used: false,
  };
}

export function assertRemoteGraphicalLiveBrokerStatus(value = {}) {
  return createRemoteGraphicalLiveBrokerStatus(value);
}

function defaultStatus(value) {
  if (Boolean(value.configured) && Boolean(value.degraded)) {
    return "provider_degraded";
  }
  if (Boolean(value.configured)) {
    return "provider_configured";
  }
  return "provider_not_configured";
}

function defaultState(value) {
  if (!Boolean(value.configured)) {
    return "unconfigured";
  }
  if (Boolean(value.degraded)) {
    return "degraded";
  }
  if (value.reachable === false) {
    return "provider_unreachable";
  }
  return "configured_inactive";
}

function assertNoForbiddenFields(value, path = []) {
  if (!isPlainObject(value) && !Array.isArray(value)) {
    return;
  }
  const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
  for (const [rawKey, child] of entries) {
    const key = String(rawKey);
    const currentPath = [...path, key];
    if (FORBIDDEN_PATHS.includes(key.toLowerCase())) {
      throwStatusError(
        "remote_graphical_live_status_forbidden_field",
        `${currentPath.join(".")} is forbidden in live broker status`,
      );
    }
    assertNoForbiddenFields(child, currentPath);
  }
}

function boundedSummary(summary, status, state) {
  const value = stringValue(summary);
  if (value) {
    return value.slice(0, 240);
  }
  return `Remote graphical live broker status ${status || state}.`;
}

function integerOrDefault(value, fallback) {
  return value === undefined || value === null ? fallback : value;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function stringList(value) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => stringValue(entry)).filter(Boolean);
}

function stringValue(value) {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwStatusError(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export const REMOTE_GRAPHICAL_LIVE_BROKER_STATUS_SCHEMA_VERSION = STATUS_SCHEMA_VERSION;

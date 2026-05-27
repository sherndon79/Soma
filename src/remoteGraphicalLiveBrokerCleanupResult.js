const CLEANUP_SCHEMA_VERSION = 1;

const ALLOWED_STATUSES = new Set([
  "cleanup_noop",
  "cleanup_completed",
  "cleanup_failed",
]);

const ALLOWED_REASONS = new Set([
  "revoked",
  "expired",
  "shutdown",
  "manual_stop",
  "error_recovery",
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
  "data",
  "payload",
  "payload_bytes",
  "bytes",
  "frame",
  "frames",
  "frame_bytes",
  "image",
  "image_bytes",
  "video_frame",
  "screenshot",
  "screenshot_bytes",
  "thumbnail",
  "ocr_text",
  "recognized_text",
  "clipboard",
  "clipboard_text",
  "keystrokes",
  "key_events",
  "pointer_path",
  "pointer_events",
  "input_events",
  "window_title",
  "window_titles",
  "window_metadata",
  "file_name",
  "file_names",
  "file_path",
  "file_paths",
  "audio",
  "audio_bytes",
  "stdout",
  "stderr",
  "logs",
  "transport_log",
  "transport_logs",
  "diagnostics",
  "raw_diagnostics",
  "stack",
  "stack_trace",
  "environment",
  "env",
  "command",
  "argv",
  "process",
];

export function createRemoteGraphicalLiveBrokerCleanupResult(value = {}) {
  if (!isPlainObject(value)) {
    throwCleanupResultError(
      "remote_graphical_live_cleanup_result_not_object",
      "live broker cleanup result must be an object",
    );
  }

  assertNoForbiddenFields(value);

  const schemaVersion = integerOrDefault(value.schema_version, CLEANUP_SCHEMA_VERSION);
  const sourceGrantId = stringValue(value.source_grant_id ?? value.grant_id);
  const provider = stringValue(value.provider);
  const targetHost = stringValue(value.target_host ?? value.targetHost);
  const status = stringValue(value.status) || defaultStatus(value);
  const reason = stringValue(value.reason);
  const stoppedSessionIds = stringList(value.stopped_session_ids ?? value.stopped_sessions);
  const stoppedCount = stoppedSessionIds.length;
  const retryable = value.retryable === undefined ? null : Boolean(value.retryable);
  const cleanupNeeded = value.cleanup_needed === undefined ? status === "cleanup_failed" : Boolean(value.cleanup_needed);
  const causeCode = stringValue(value.cause_code ?? value.error_code);

  const errors = [];
  if (!Number.isInteger(schemaVersion) || schemaVersion <= 0) {
    errors.push("schema_version must be a positive integer");
  }
  if (!sourceGrantId) {
    errors.push("cleanup result requires source_grant_id");
  }
  if (!ALLOWED_STATUSES.has(status)) {
    errors.push(`status must be one of ${Array.from(ALLOWED_STATUSES).join(", ")}`);
  }
  if (reason && !ALLOWED_REASONS.has(reason)) {
    errors.push(`reason must be one of ${Array.from(ALLOWED_REASONS).join(", ")}`);
  }
  if (status === "cleanup_failed" && !causeCode) {
    errors.push("failed cleanup result requires cause_code");
  }
  if (value.stopped_session_ids !== undefined && !Array.isArray(value.stopped_session_ids)) {
    errors.push("stopped_session_ids must be an array when provided");
  }
  if (value.stopped_sessions !== undefined && !Array.isArray(value.stopped_sessions)) {
    errors.push("stopped_sessions must be an array when provided");
  }
  if (errors.length > 0) {
    throwCleanupResultError("remote_graphical_live_cleanup_result_invalid", errors.join("; "));
  }

  return {
    schema_version: schemaVersion,
    schema_matches_expected: schemaVersion === CLEANUP_SCHEMA_VERSION,
    expected_schema_version: CLEANUP_SCHEMA_VERSION,
    family: "desktop.remote_graphical",
    action: "cleanup_for_grant",
    source_grant_id: sourceGrantId,
    provider,
    target_host: targetHost,
    status,
    reason,
    stopped_count: stoppedCount,
    stopped_session_ids: stoppedSessionIds,
    cleanup_needed: cleanupNeeded,
    retryable,
    cause_code: causeCode,
    summary: boundedSummary(value.summary, status, stoppedCount),
    activation_performed: false,
    broker_called: false,
    session_opened: false,
    pairing_performed: false,
    video_attached: false,
    input_dispatched: false,
    recording_started: false,
    provider_session_stopped: stoppedCount > 0,
    model_delivery: false,
    live_transport_used: stoppedCount > 0 || status === "cleanup_failed",
  };
}

export function assertRemoteGraphicalLiveBrokerCleanupResult(value = {}) {
  return createRemoteGraphicalLiveBrokerCleanupResult(value);
}

function defaultStatus(value) {
  if (Boolean(value.failed) || value.cause_code || value.error_code) {
    return "cleanup_failed";
  }
  const stoppedSessionIds = stringList(value.stopped_session_ids ?? value.stopped_sessions);
  return stoppedSessionIds.length > 0 ? "cleanup_completed" : "cleanup_noop";
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
      throwCleanupResultError(
        "remote_graphical_live_cleanup_result_forbidden_field",
        `${currentPath.join(".")} is forbidden in live broker cleanup result`,
      );
    }
    assertNoForbiddenFields(child, currentPath);
  }
}

function boundedSummary(summary, status, stoppedCount) {
  const value = stringValue(summary);
  if (value) {
    return value.slice(0, 240);
  }
  if (status === "cleanup_completed") {
    return `Remote graphical cleanup stopped ${stoppedCount} Soma-opened provider session(s).`;
  }
  if (status === "cleanup_failed") {
    return "Remote graphical cleanup failed before returning provider diagnostics.";
  }
  return "Remote graphical cleanup found no Soma-opened provider sessions to stop.";
}

function integerOrDefault(value, fallback) {
  return value === undefined || value === null ? fallback : value;
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

function throwCleanupResultError(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export const REMOTE_GRAPHICAL_LIVE_BROKER_CLEANUP_SCHEMA_VERSION = CLEANUP_SCHEMA_VERSION;

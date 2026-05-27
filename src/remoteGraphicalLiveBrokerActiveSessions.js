const ACTIVE_SESSIONS_SCHEMA_VERSION = 1;

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

export function createRemoteGraphicalLiveBrokerActiveSessions(value = {}) {
  if (!isPlainObject(value)) {
    throwActiveSessionsError(
      "remote_graphical_live_active_sessions_not_object",
      "live broker active sessions result must be an object",
    );
  }

  assertNoForbiddenFields(value);

  const schemaVersion = integerOrDefault(value.schema_version, ACTIVE_SESSIONS_SCHEMA_VERSION);
  const provider = stringValue(value.provider);
  const targetHost = stringValue(value.target_host ?? value.targetHost);
  const rawSessions = Array.isArray(value.sessions) ? value.sessions : [];
  const sessions = rawSessions.map((session, index) => createActiveSession(session, {
    index,
    provider,
    targetHost,
  }));

  const errors = [];
  if (!Number.isInteger(schemaVersion) || schemaVersion <= 0) {
    errors.push("schema_version must be a positive integer");
  }
  if (value.sessions !== undefined && !Array.isArray(value.sessions)) {
    errors.push("sessions must be an array when provided");
  }
  if (errors.length > 0) {
    throwActiveSessionsError("remote_graphical_live_active_sessions_invalid", errors.join("; "));
  }

  return {
    schema_version: schemaVersion,
    schema_matches_expected: schemaVersion === ACTIVE_SESSIONS_SCHEMA_VERSION,
    expected_schema_version: ACTIVE_SESSIONS_SCHEMA_VERSION,
    family: "desktop.remote_graphical",
    provider,
    target_host: targetHost,
    active_count: sessions.length,
    sessions,
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

export function assertRemoteGraphicalLiveBrokerActiveSessions(value = {}) {
  return createRemoteGraphicalLiveBrokerActiveSessions(value);
}

function createActiveSession(value, { index, provider, targetHost } = {}) {
  if (!isPlainObject(value)) {
    throwActiveSessionsError(
      "remote_graphical_live_active_session_invalid",
      `sessions[${index}] must be an object`,
    );
  }

  const sessionId = stringValue(value.session_id ?? value.id);
  const sourceGrantId = stringValue(value.source_grant_id ?? value.grant_id);
  const sessionProvider = stringValue(value.provider) || provider;
  const sessionTargetHost = stringValue(value.target_host ?? value.targetHost) || targetHost;
  const openedAt = isoOrEmpty(value.opened_at ?? value.openedAt);
  const expiresAt = isoOrEmpty(value.expires_at ?? value.expiresAt);

  const errors = [];
  if (!sessionId) {
    errors.push(`sessions[${index}].session_id must be present`);
  }
  if (!sourceGrantId) {
    errors.push(`sessions[${index}].source_grant_id must be present`);
  }
  if (!sessionProvider) {
    errors.push(`sessions[${index}].provider must be present`);
  }
  if (!sessionTargetHost) {
    errors.push(`sessions[${index}].target_host must be present`);
  }
  if (value.opened_at !== undefined && !openedAt) {
    errors.push(`sessions[${index}].opened_at must be an ISO-compatible timestamp`);
  }
  if (value.expires_at !== undefined && !expiresAt) {
    errors.push(`sessions[${index}].expires_at must be an ISO-compatible timestamp`);
  }
  if (errors.length > 0) {
    throwActiveSessionsError("remote_graphical_live_active_session_invalid", errors.join("; "));
  }

  return {
    session_id: sessionId,
    source_grant_id: sourceGrantId,
    provider: sessionProvider,
    target_host: sessionTargetHost,
    state: "open_observe_inactive",
    locality: stringValue(value.locality),
    attended: value.attended === undefined ? null : Boolean(value.attended),
    opened_at: openedAt,
    expires_at: expiresAt,
    active_authorities: [],
    input_channels: [],
    video: {
      observing: false,
      frames_attached: false,
      screenshots_captured: false,
      recognized_text_included: false,
    },
    recording: false,
    model_delivery: false,
    session_opened: true,
    pairing_performed: false,
    video_attached: false,
    input_dispatched: false,
    recording_started: false,
    provider_session_stopped: false,
    live_transport_used: true,
    model_delivery_used: false,
  };
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
      throwActiveSessionsError(
        "remote_graphical_live_active_sessions_forbidden_field",
        `${currentPath.join(".")} is forbidden in live broker active sessions`,
      );
    }
    assertNoForbiddenFields(child, currentPath);
  }
}

function isoOrEmpty(value) {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function integerOrDefault(value, fallback) {
  return value === undefined || value === null ? fallback : value;
}

function stringValue(value) {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwActiveSessionsError(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export const REMOTE_GRAPHICAL_LIVE_BROKER_ACTIVE_SESSIONS_SCHEMA_VERSION = ACTIVE_SESSIONS_SCHEMA_VERSION;

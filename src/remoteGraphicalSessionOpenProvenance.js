const FORBIDDEN_PROVENANCE_KEYS = new Set([
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
  "transport_log",
  "transport_logs",
  "diagnostics",
  "stack",
  "stderr",
  "stdout",
]);

export function createRemoteGraphicalSessionOpenFixtureProvenanceSummary({ result } = {}) {
  validateSessionOpenProvenanceInput(result);

  const sessionOpened = result.session_opened === true;
  const error = stringValue(result.error);
  const sessionId = stringValue(result.session_id);
  if (sessionOpened && !sessionId) {
    throwRemoteGraphicalSessionOpenProvenanceError(["successful fixture session-open requires session_id"]);
  }
  if (!sessionOpened && !error) {
    throwRemoteGraphicalSessionOpenProvenanceError(["failed fixture session-open requires error"]);
  }

  return {
    event_type: "remote_graphical.session_open.fixture",
    outcome: sessionOpened ? "success" : "failure",
    source_grant_id: stringValue(result.source_grant_id),
    capability: stringValue(result.capability),
    provider: stringValue(result.provider),
    target_host: stringValue(result.target_host),
    scope: stringValue(result.scope),
    requested_by: stringValue(result.requested_by),
    broker_action: stringValue(result.broker_action) || "open_session",
    status: stringValue(result.status),
    state: stringValue(result.state),
    session_id: sessionOpened ? sessionId : "",
    error: sessionOpened ? "" : error,
    cause_code: sessionOpened ? "" : stringValue(result.cause_code),
    fixture_only: true,
    activation_performed: result.activation_performed === true,
    broker_called: result.broker_called === true,
    session_opened: sessionOpened,
    durable: false,
    grant_written: false,
    pairing_performed: false,
    video_attached: false,
    input_dispatched: false,
    recording_started: false,
    provider_session_stopped: false,
    model_delivery: false,
    live_transport_used: false,
    payload_bytes_included: false,
    frames_included: false,
    screenshots_included: false,
    recognized_text_included: false,
    clipboard_included: false,
    input_events_included: false,
    window_metadata_included: false,
    file_metadata_included: false,
    audio_payload_included: false,
    transport_diagnostics_included: false,
  };
}

export function createRemoteGraphicalSessionOpenLiveProvenanceSummary({ result } = {}) {
  validateSessionOpenProvenanceInput(result);

  const sessionOpened = result.session_opened === true;
  const error = stringValue(result.error);
  const causeCode = stringValue(result.cause_code);
  const sessionId = stringValue(result.session_id);
  if (sessionOpened && !sessionId) {
    throwRemoteGraphicalSessionOpenProvenanceError(["successful live session-open requires session_id"]);
  }
  if (!sessionOpened && !error) {
    throwRemoteGraphicalSessionOpenProvenanceError(["failed live session-open requires error"]);
  }
  if (!sessionOpened && !causeCode) {
    throwRemoteGraphicalSessionOpenProvenanceError(["failed live session-open requires cause_code"]);
  }

  return {
    event_type: "remote_graphical.session_open.live",
    outcome: sessionOpened ? "success" : "failure",
    source_grant_id: stringValue(result.source_grant_id),
    capability: stringValue(result.capability),
    provider: stringValue(result.provider),
    target_host: stringValue(result.target_host),
    scope: stringValue(result.scope),
    requested_by: stringValue(result.requested_by),
    broker_action: stringValue(result.broker_action) || "open_session",
    status: stringValue(result.status),
    state: stringValue(result.state),
    session_id: sessionOpened ? sessionId : "",
    error: sessionOpened ? "" : error,
    cause_code: sessionOpened ? "" : causeCode,
    fixture_only: false,
    activation_performed: result.activation_performed === true,
    broker_called: result.broker_called === true,
    session_opened: sessionOpened,
    durable: false,
    grant_written: false,
    pairing_performed: false,
    video_attached: false,
    input_dispatched: false,
    recording_started: false,
    provider_session_stopped: false,
    model_delivery: false,
    live_transport_used: true,
    payload_bytes_included: false,
    frames_included: false,
    screenshots_included: false,
    recognized_text_included: false,
    clipboard_included: false,
    input_events_included: false,
    window_metadata_included: false,
    file_metadata_included: false,
    audio_payload_included: false,
    transport_diagnostics_included: false,
  };
}

function validateSessionOpenProvenanceInput(result) {
  if (!isPlainObject(result)) {
    throwRemoteGraphicalSessionOpenProvenanceError(["result must be an object"]);
  }
  const forbidden = forbiddenProvenancePaths(result, "result");
  if (forbidden.length > 0) {
    throwRemoteGraphicalSessionOpenProvenanceError(
      forbidden.map((path) => `${path} is forbidden in remote graphical session-open provenance`),
    );
  }
}

function forbiddenProvenancePaths(value, path) {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => forbiddenProvenancePaths(entry, `${path}[${index}]`));
  }
  if (!isPlainObject(value)) {
    return [];
  }
  const paths = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_PROVENANCE_KEYS.has(key)) {
      paths.push(childPath);
    }
    paths.push(...forbiddenProvenancePaths(child, childPath));
  }
  return paths;
}

function stringValue(value) {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function throwRemoteGraphicalSessionOpenProvenanceError(errors) {
  const error = new Error(`Invalid remote graphical session-open provenance input: ${errors.join("; ")}`);
  error.code = "invalid_remote_graphical_session_open_provenance";
  error.statusCode = 400;
  error.validation_errors = errors;
  throw error;
}

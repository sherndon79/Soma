const FORBIDDEN_DISCLOSURE_KEYS = new Set([
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

export function createRemoteGraphicalLiveSessionDisclosure({
  review = {},
  brokerResult = {},
  openedAt = new Date(),
} = {}) {
  validateNoContentBearingFields({ review, brokerResult });

  const sessionId = stringValue(brokerResult.session_id ?? brokerResult.id);
  const sourceGrantId = stringValue(review.source_grant_id);
  const provider = stringValue(brokerResult.provider) || stringValue(review.provider);
  const targetHost = stringValue(brokerResult.target_host ?? brokerResult.targetHost)
    || stringValue(review.target_host);
  const locality = stringValue(brokerResult.locality) || stringValue(review.review?.locality);
  const attended = brokerResult.attended === undefined
    ? booleanOrNull(review.review?.attended)
    : Boolean(brokerResult.attended);
  const openedAtIso = toIsoString(openedAt);
  const maxSeconds = nonNegativeInteger(review.grant_constraints?.max_seconds ?? review.constraints?.max_seconds);

  const errors = [];
  if (!sessionId) {
    errors.push("live session disclosure requires session_id");
  }
  if (!sourceGrantId) {
    errors.push("live session disclosure requires source_grant_id");
  }
  if (!provider) {
    errors.push("live session disclosure requires provider");
  }
  if (!targetHost) {
    errors.push("live session disclosure requires target_host");
  }
  if (!openedAtIso) {
    errors.push("live session disclosure requires valid opened_at");
  }
  if (errors.length > 0) {
    throwRemoteGraphicalLiveSessionDisclosureError(errors);
  }

  return {
    type: "remote_graphical_live_session_disclosure",
    session_id: sessionId,
    source_grant_id: sourceGrantId,
    provider,
    target_host: targetHost,
    state: "open_observe_inactive",
    locality,
    attended,
    opened_at: openedAtIso,
    expires_at: maxSeconds > 0 ? new Date(Date.parse(openedAtIso) + maxSeconds * 1000).toISOString() : "",
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
    disclosure: `Remote graphical session substrate is open for ${targetHost}; video observation and input remain inactive.`,
    revocation: {
      source_grant_id: sourceGrantId,
      cleanup_action: "cleanup_for_grant",
      summary: "Revoking the source grant should stop Soma-opened provider session substrate through bounded cleanup.",
    },
    activation_performed: true,
    broker_called: true,
    session_opened: true,
    durable: false,
    grant_written: false,
    pairing_performed: false,
    video_attached: false,
    input_dispatched: false,
    recording_started: false,
    provider_session_stopped: false,
    live_transport_used: true,
    model_delivery_used: false,
  };
}

export function assertRemoteGraphicalLiveSessionDisclosure(disclosure = {}) {
  validateNoContentBearingFields({ disclosure });

  const errors = [];
  if (stringValue(disclosure.type) !== "remote_graphical_live_session_disclosure") {
    errors.push("type must be remote_graphical_live_session_disclosure");
  }
  if (!stringValue(disclosure.session_id)) {
    errors.push("session_id must be present");
  }
  if (!stringValue(disclosure.source_grant_id)) {
    errors.push("source_grant_id must be present");
  }
  if (!stringValue(disclosure.provider)) {
    errors.push("provider must be present");
  }
  if (!stringValue(disclosure.target_host)) {
    errors.push("target_host must be present");
  }
  if (stringValue(disclosure.state) !== "open_observe_inactive") {
    errors.push("state must be open_observe_inactive");
  }
  if (!Array.isArray(disclosure.active_authorities) || disclosure.active_authorities.length !== 0) {
    errors.push("active_authorities must be empty until separate authorities activate");
  }
  if (!Array.isArray(disclosure.input_channels) || disclosure.input_channels.length !== 0) {
    errors.push("input_channels must be empty until input authority activates");
  }
  if (disclosure.video?.observing !== false) {
    errors.push("video.observing must be false");
  }
  for (const field of [
    "recording",
    "model_delivery",
    "durable",
    "grant_written",
    "pairing_performed",
    "video_attached",
    "input_dispatched",
    "recording_started",
    "provider_session_stopped",
  ]) {
    if (disclosure[field] !== false) {
      errors.push(`${field} must be false`);
    }
  }
  if (disclosure.activation_performed !== true) {
    errors.push("activation_performed must be true for a live opened substrate disclosure");
  }
  if (disclosure.broker_called !== true) {
    errors.push("broker_called must be true for a live opened substrate disclosure");
  }
  if (disclosure.session_opened !== true) {
    errors.push("session_opened must be true for a live opened substrate disclosure");
  }
  if (disclosure.live_transport_used !== true) {
    errors.push("live_transport_used must be true for a live opened substrate disclosure");
  }
  if (errors.length > 0) {
    throwRemoteGraphicalLiveSessionDisclosureError(errors);
  }
  return copyPlainJson(disclosure);
}

function validateNoContentBearingFields(value) {
  const forbidden = forbiddenDisclosurePaths(value, "input");
  if (forbidden.length > 0) {
    throwRemoteGraphicalLiveSessionDisclosureError(
      forbidden.map((path) => `${path} is forbidden in remote graphical live session disclosure`),
    );
  }
}

function forbiddenDisclosurePaths(value, path) {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => forbiddenDisclosurePaths(entry, `${path}[${index}]`));
  }
  if (!isPlainObject(value)) {
    return [];
  }
  const paths = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_DISCLOSURE_KEYS.has(key)) {
      paths.push(childPath);
    }
    paths.push(...forbiddenDisclosurePaths(child, childPath));
  }
  return paths;
}

function toIsoString(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function booleanOrNull(value) {
  return value === undefined || value === null ? null : Boolean(value);
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value) {
  return String(value ?? "").trim();
}

function copyPlainJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function throwRemoteGraphicalLiveSessionDisclosureError(errors) {
  const error = new Error(`Invalid remote graphical live session disclosure: ${errors.join("; ")}`);
  error.code = "invalid_remote_graphical_live_session_disclosure";
  error.statusCode = 400;
  error.validation_errors = errors;
  throw error;
}

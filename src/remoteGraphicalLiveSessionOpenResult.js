import {
  assertRemoteGraphicalLiveSessionDisclosure,
  createRemoteGraphicalLiveSessionDisclosure,
} from "./remoteGraphicalLiveSessionDisclosure.js";
import {
  createRemoteGraphicalSessionOpenLiveProvenanceSummary,
} from "./remoteGraphicalSessionOpenProvenance.js";

export function buildRemoteGraphicalLiveSessionOpenSuccess({
  review = {},
  brokerResult = {},
  openedAt = new Date(),
} = {}) {
  validateNoContentBearingFields({ review, brokerResult });

  const sessionId = stringValue(brokerResult.session_id ?? brokerResult.id);
  if (!sessionId) {
    throwRemoteGraphicalLiveSessionOpenResultError(["live session-open success requires session_id"]);
  }

  const result = {
    ...review,
    type: "remote_graphical_session_open_result",
    refused: false,
    status: stringValue(brokerResult.status) || "opened",
    state: "open_observe_inactive",
    session_id: sessionId,
    provider: stringValue(brokerResult.provider) || stringValue(review.provider),
    target_host: stringValue(brokerResult.target_host ?? brokerResult.targetHost) || stringValue(review.target_host),
    locality: stringValue(brokerResult.locality) || stringValue(review.review?.locality),
    attended: brokerResult.attended === undefined ? booleanOrNull(review.review?.attended) : Boolean(brokerResult.attended),
    review_only: false,
    fixture_only: false,
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
    model_delivery: false,
    live_transport_used: true,
  };

  const activeDisclosure = createRemoteGraphicalLiveSessionDisclosure({
    review: {
      ...review,
      grant_constraints: review.grant_constraints ?? review.constraints,
    },
    brokerResult,
    openedAt,
  });
  result.active_disclosure = assertRemoteGraphicalLiveSessionDisclosure(activeDisclosure);
  result.provenance_preview = createRemoteGraphicalSessionOpenLiveProvenanceSummary({ result });
  result.provenance_appended = false;

  return result;
}

export function buildRemoteGraphicalLiveSessionOpenFailure({
  review = {},
  cause,
} = {}) {
  validateNoContentBearingFields({ review, cause });

  const causeCode = stringValue(cause?.code);
  if (!causeCode) {
    throwRemoteGraphicalLiveSessionOpenResultError(["live session-open failure requires cause.code"]);
  }

  const result = {
    ...review,
    type: "remote_graphical_session_open_refusal",
    refused: true,
    status: "session_open_failed",
    state: "failed",
    error: "remote_graphical_live_broker_session_open_failed",
    message: "Remote graphical live broker session-open failed before observation or input activation.",
    cause_code: causeCode,
    review_only: false,
    fixture_only: false,
    activation_performed: false,
    broker_called: true,
    session_opened: false,
    durable: false,
    grant_written: false,
    pairing_performed: false,
    video_attached: false,
    input_dispatched: false,
    recording_started: false,
    provider_session_stopped: false,
    model_delivery: false,
    live_transport_used: true,
    session_id: "",
  };

  result.provenance_preview = createRemoteGraphicalSessionOpenLiveProvenanceSummary({ result });
  result.provenance_appended = false;

  return result;
}

function validateNoContentBearingFields(value) {
  const forbidden = forbiddenResultPaths(value, "input");
  if (forbidden.length > 0) {
    throwRemoteGraphicalLiveSessionOpenResultError(
      forbidden.map((path) => `${path} is forbidden in remote graphical live session-open result`),
    );
  }
}

function forbiddenResultPaths(value, path) {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => forbiddenResultPaths(entry, `${path}[${index}]`));
  }
  if (!isPlainObject(value) && !(value instanceof Error)) {
    return [];
  }
  const entries = value instanceof Error
    ? Object.entries(copyErrorFields(value))
    : Object.entries(value);
  const paths = [];
  for (const [key, child] of entries) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_RESULT_KEYS.has(key)) {
      paths.push(childPath);
    }
    paths.push(...forbiddenResultPaths(child, childPath));
  }
  return paths;
}

const FORBIDDEN_RESULT_KEYS = new Set([
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

function copyErrorFields(error) {
  const fields = {};
  for (const key of Object.keys(error)) {
    fields[key] = error[key];
  }
  return fields;
}

function booleanOrNull(value) {
  return value === undefined || value === null ? null : Boolean(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value) {
  return String(value ?? "").trim();
}

function throwRemoteGraphicalLiveSessionOpenResultError(errors) {
  const error = new Error(`Invalid remote graphical live session-open result: ${errors.join("; ")}`);
  error.code = "invalid_remote_graphical_live_session_open_result";
  error.statusCode = 400;
  error.validation_errors = errors;
  throw error;
}

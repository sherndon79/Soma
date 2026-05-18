// Provenance summary shapes for Sensorium subscription lifecycle.
//
// Step 5 of the disabled-first sequence in
// docs/concepts/drafts/sensorium_integration.md: define the shape of
// what gets recorded when a subscription starts and ends, BEFORE any
// helper exists that would actually subscribe. Provenance records the
// shape of consumption, not the consumed content — frame payloads
// never appear in these summaries, only counters and metadata.
//
// Two events make up a subscription's provenance trail:
//
//   subscription_started  — emitted when a subscription would activate
//                           under a grant. Declarative state: what was
//                           requested, what authority, what
//                           constraints. No counters yet.
//
//   subscription_ended    — emitted when a subscription terminates
//                           (clean stop, timeout, revocation, error).
//                           Includes aggregate counters describing
//                           the shape of what flowed, never the
//                           content itself.
//
// Both functions are pure: same inputs produce same outputs. They
// reject malformed inputs structurally; callers are expected to have
// already passed the request validator (sensoriumSubscriptionRequest.js)
// to ensure the shape is well-formed.

const ALLOWED_TERMINATION_REASONS = new Set([
  "clean_stop",        // operator or agent stopped the subscription
  "timeout",           // max_seconds elapsed
  "revoked",           // the underlying grant was revoked
  "error",             // helper or transport error
  "schema_mismatch",   // observed schema_version unexpected, refused
  "channel_closed",    // upstream Sensorium peer disconnected
]);

const SENSORIUM_CAPABILITY_KEYS = new Set([
  "perception.sensorium.color.subscribe",
  "perception.sensorium.depth.subscribe",
  "perception.sensorium.imu.subscribe",
  "perception.sensorium.location.subscribe",
  "perception.sensorium.status.subscribe",
]);

// ── subscription_started ────────────────────────────────────────────────────

export function createSensoriumSubscriptionStartSummary({
  capability,
  provider,
  grantId,
  scope,
  topic,
  constraints = {},
  startedAt,
} = {}) {
  if (!SENSORIUM_CAPABILITY_KEYS.has(capability)) {
    throwProvenanceError(
      "sensorium_provenance_invalid_capability",
      `capability "${capability ?? "(missing)"}" is not a recognized Sensorium capability`,
    );
  }
  if (typeof provider !== "string" || provider.length === 0) {
    throwProvenanceError(
      "sensorium_provenance_invalid_provider",
      "provider must be a non-empty string",
    );
  }
  if (typeof grantId !== "string" || grantId.length === 0) {
    throwProvenanceError(
      "sensorium_provenance_invalid_grant",
      "grantId must be a non-empty string",
    );
  }
  if (typeof topic !== "string" || topic.length === 0) {
    throwProvenanceError(
      "sensorium_provenance_invalid_topic",
      "topic must be a non-empty string",
    );
  }

  return {
    event_type: "perception.sensorium.subscription_started",
    timestamp: stringOrEmpty(startedAt) || new Date().toISOString(),
    capability,
    provider,
    grant_id: grantId,
    scope: stringOrEmpty(scope),
    topic,
    constraints_declared: copyDeclaredConstraints(constraints),
    text_content_included: false,
    frames_recorded: false,
  };
}

// ── subscription_ended ──────────────────────────────────────────────────────

export function createSensoriumSubscriptionEndSummary({
  startSummary,
  startedAt,
  endedAt,
  terminationReason,
  framesConsumed = 0,
  schemaVersionObserved = null,
  schemaMismatches = 0,
  firstFrameNumber = null,
  lastFrameNumber = null,
  statusSummaryObserved = null,
  streamSummaryObserved = null,
  errorClass = "",
} = {}) {
  if (!isPlainObject(startSummary)) {
    throwProvenanceError(
      "sensorium_provenance_invalid_start_summary",
      "startSummary must be the object returned by createSensoriumSubscriptionStartSummary",
    );
  }
  if (startSummary.event_type !== "perception.sensorium.subscription_started") {
    throwProvenanceError(
      "sensorium_provenance_invalid_start_summary",
      "startSummary.event_type must be perception.sensorium.subscription_started",
    );
  }
  if (!ALLOWED_TERMINATION_REASONS.has(terminationReason)) {
    throwProvenanceError(
      "sensorium_provenance_invalid_termination_reason",
      `terminationReason must be one of: ${[...ALLOWED_TERMINATION_REASONS].join(", ")}`,
    );
  }
  if (!Number.isInteger(framesConsumed) || framesConsumed < 0) {
    throwProvenanceError(
      "sensorium_provenance_invalid_counter",
      "framesConsumed must be a non-negative integer",
    );
  }
  if (!Number.isInteger(schemaMismatches) || schemaMismatches < 0) {
    throwProvenanceError(
      "sensorium_provenance_invalid_counter",
      "schemaMismatches must be a non-negative integer",
    );
  }

  const start = stringOrEmpty(startedAt) || startSummary.timestamp;
  const end = stringOrEmpty(endedAt) || new Date().toISOString();
  const durationSeconds = isoDurationSeconds(start, end);

  const summary = {
    event_type: "perception.sensorium.subscription_ended",
    timestamp: end,
    capability: startSummary.capability,
    provider: startSummary.provider,
    grant_id: startSummary.grant_id,
    scope: startSummary.scope,
    topic: startSummary.topic,
    started_at: start,
    ended_at: end,
    duration_seconds: durationSeconds,
    termination_reason: terminationReason,
    frames_consumed: framesConsumed,
    schema_version_observed: numberOrNull(schemaVersionObserved),
    schema_mismatches: schemaMismatches,
    first_frame_number: numberOrNull(firstFrameNumber),
    last_frame_number: numberOrNull(lastFrameNumber),
    error_class: errorClass && errorClass.length > 0 ? errorClass : "",
    text_content_included: false,
    frames_recorded: false,
  };
  const copiedStatusSummary = copyStatusSummary(statusSummaryObserved);
  if (copiedStatusSummary) {
    summary.status_summary_observed = copiedStatusSummary;
  }
  const copiedStreamSummary = copyStreamSummary(streamSummaryObserved);
  if (copiedStreamSummary) {
    summary.stream_summary_observed = copiedStreamSummary;
  }
  return summary;
}

// ── helpers ─────────────────────────────────────────────────────────────────

// Only declared constraints survive into provenance — undefined or null
// fields stay absent so the record doesn't suggest a constraint was
// declared when it wasn't.
function copyDeclaredConstraints(constraints) {
  if (!isPlainObject(constraints)) {
    return {};
  }
  const out = {};
  for (const [key, value] of Object.entries(constraints)) {
    if (value !== undefined && value !== null) {
      out[key] = value;
    }
  }
  return out;
}

function copyStatusSummary(summary) {
  if (!isPlainObject(summary)) {
    return null;
  }
  const schemaVersion = numberOrNull(summary.schema_version);
  const uptimeSeconds = numberOrNull(summary.uptime_seconds);
  const hostname = stringOrEmpty(summary.hostname);
  const nodeVersion = stringOrEmpty(summary.node_version);
  const enabledStreams = Array.isArray(summary.enabled_streams)
    ? summary.enabled_streams.filter((item) => typeof item === "string")
    : [];
  if (
    schemaVersion === null ||
    uptimeSeconds === null ||
    hostname.length === 0 ||
    nodeVersion.length === 0
  ) {
    return null;
  }
  return {
    schema_version: schemaVersion,
    hostname,
    uptime_seconds: uptimeSeconds,
    node_version: nodeVersion,
    enabled_streams: enabledStreams,
  };
}

function copyStreamSummary(summary) {
  if (!isPlainObject(summary)) {
    return null;
  }
  const schemaVersion = integerOrNull(summary.schema_version);
  const frameNumber = integerOrNull(summary.frame_number);
  const width = integerOrNull(summary.width);
  const height = integerOrNull(summary.height);
  const format = stringOrEmpty(summary.format);
  const payloadSize = integerOrNull(summary.payload_size);
  if (
    schemaVersion === null ||
    frameNumber === null ||
    frameNumber < 0 ||
    width === null ||
    width <= 0 ||
    height === null ||
    height <= 0 ||
    format.length === 0 ||
    payloadSize === null ||
    payloadSize < 0
  ) {
    return null;
  }
  return {
    schema_version: schemaVersion,
    frame_number: frameNumber,
    width,
    height,
    format,
    payload_size: payloadSize,
  };
}

function isoDurationSeconds(startISO, endISO) {
  const start = Date.parse(startISO);
  const end = Date.parse(endISO);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }
  return Math.round((end - start) / 1000);
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function integerOrNull(value) {
  return Number.isInteger(value) ? value : null;
}

function stringOrEmpty(value) {
  return typeof value === "string" ? value : "";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwProvenanceError(code, message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  throw error;
}

export const SENSORIUM_TERMINATION_REASONS = Object.freeze([
  ...ALLOWED_TERMINATION_REASONS,
]);

import { decodeSensoriumMessagePack } from "./sensoriumMessagePack.js";

const STATUS_SCHEMA_VERSION = 2;
const ACCEPTED_STATUS_SCHEMA_VERSIONS = new Set([1, 2]);

export function summarizeSensoriumStatusPayload(payloadBytes) {
  const decoded = decodeSensoriumMessagePack(payloadBytes, {
    errorPrefix: "sensorium_status_msgpack",
  });
  if (!isPlainObject(decoded)) {
    throwStatusDecodeError("sensorium_status_payload_not_object", "status payload must decode to an object");
  }

  const schemaVersion = decoded.schema_version;
  const hostname = decoded.hostname;
  const uptimeSeconds = decoded.uptime_seconds;
  const nodeVersion = decoded.node_version;
  const enabledStreams = decoded.enabled_streams;
  const streamProfiles = decoded.stream_profiles;

  if (!Number.isInteger(schemaVersion)) {
    throwStatusDecodeError("sensorium_status_schema_missing", "status payload schema_version must be an integer");
  }
  if (typeof hostname !== "string" || hostname.length === 0) {
    throwStatusDecodeError("sensorium_status_hostname_missing", "status payload hostname must be a non-empty string");
  }
  if (!Number.isFinite(uptimeSeconds) || uptimeSeconds < 0) {
    throwStatusDecodeError("sensorium_status_uptime_invalid", "status payload uptime_seconds must be a non-negative number");
  }
  if (typeof nodeVersion !== "string" || nodeVersion.length === 0) {
    throwStatusDecodeError("sensorium_status_node_version_missing", "status payload node_version must be a non-empty string");
  }
  if (!Array.isArray(enabledStreams) || !enabledStreams.every((item) => typeof item === "string")) {
    throwStatusDecodeError("sensorium_status_streams_invalid", "status payload enabled_streams must be an array of strings");
  }

  return {
    schema_version: schemaVersion,
    schema_matches_expected: ACCEPTED_STATUS_SCHEMA_VERSIONS.has(schemaVersion),
    expected_schema_version: STATUS_SCHEMA_VERSION,
    hostname,
    uptime_seconds: uptimeSeconds,
    node_version: nodeVersion,
    enabled_streams: [...enabledStreams],
    stream_profiles: copyStreamProfiles(streamProfiles),
  };
}

function copyStreamProfiles(value) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throwStatusDecodeError("sensorium_status_profiles_invalid", "status payload stream_profiles must be an array when provided");
  }
  return value.map(copyStreamProfile);
}

function copyStreamProfile(profile) {
  if (!isPlainObject(profile)) {
    throwStatusDecodeError("sensorium_status_profile_invalid", "status payload stream_profiles entries must be objects");
  }
  const stream = profile.stream;
  if (typeof stream !== "string" || stream.length === 0) {
    throwStatusDecodeError("sensorium_status_profile_stream_invalid", "status payload stream profile must include stream");
  }
  const out = { stream };
  copyOptionalPositiveInteger(profile, out, "width");
  copyOptionalPositiveInteger(profile, out, "height");
  copyOptionalPositiveInteger(profile, out, "fps");
  copyOptionalPositiveInteger(profile, out, "jpeg_quality");
  if (profile.format !== undefined && profile.format !== null) {
    if (typeof profile.format !== "string" || profile.format.length === 0) {
      throwStatusDecodeError("sensorium_status_profile_format_invalid", "status payload stream profile format must be a non-empty string");
    }
    out.format = profile.format;
  }
  return out;
}

function copyOptionalPositiveInteger(source, target, field) {
  if (source[field] === undefined || source[field] === null) {
    return;
  }
  if (!Number.isInteger(source[field]) || source[field] <= 0) {
    throwStatusDecodeError(
      "sensorium_status_profile_number_invalid",
      `status payload stream profile ${field} must be a positive integer`,
    );
  }
  target[field] = source[field];
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwStatusDecodeError(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export const SENSORIUM_STATUS_SCHEMA_VERSION = STATUS_SCHEMA_VERSION;

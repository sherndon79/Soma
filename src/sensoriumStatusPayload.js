import { decodeSensoriumMessagePack } from "./sensoriumMessagePack.js";

const STATUS_SCHEMA_VERSION = 1;

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
    schema_matches_expected: schemaVersion === STATUS_SCHEMA_VERSION,
    expected_schema_version: STATUS_SCHEMA_VERSION,
    hostname,
    uptime_seconds: uptimeSeconds,
    node_version: nodeVersion,
    enabled_streams: [...enabledStreams],
  };
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

import { decodeSensoriumMessagePack } from "./sensoriumMessagePack.js";
import { assertSensoriumSummaryWithinContract } from "./sensoriumStreamContracts.js";

const DEPTH_CAPABILITY = "perception.sensorium.depth.subscribe";
const DEPTH_SCHEMA_VERSION = 1;

export function summarizeSensoriumDepthPayload(payloadBytes) {
  const decoded = decodeSensoriumMessagePack(payloadBytes, {
    errorPrefix: "sensorium_depth_msgpack",
  });
  if (!isPlainObject(decoded)) {
    throwDepthDecodeError("sensorium_depth_payload_not_object", "depth payload must decode to an object");
  }

  const schemaVersion = decoded.schema_version;
  if (!Number.isInteger(schemaVersion)) {
    throwDepthDecodeError("sensorium_depth_schema_missing", "depth payload schema_version must be an integer");
  }

  const summary = {
    schema_version: schemaVersion,
    frame_number: decoded.frame_number,
    width: decoded.width,
    height: decoded.height,
    format: decoded.format,
    depth_units: decoded.depth_units,
    payload_size: payloadByteLength(decoded.data),
  };

  const contracted = assertSensoriumSummaryWithinContract(DEPTH_CAPABILITY, summary);
  return {
    ...contracted,
    schema_matches_expected: schemaVersion === DEPTH_SCHEMA_VERSION,
    expected_schema_version: DEPTH_SCHEMA_VERSION,
  };
}

function payloadByteLength(value) {
  if (value instanceof Uint8Array) {
    return value.byteLength;
  }
  if (Array.isArray(value)) {
    return value.length;
  }
  throwDepthDecodeError("sensorium_depth_data_invalid", "depth payload data must be binary bytes");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwDepthDecodeError(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export const SENSORIUM_DEPTH_SCHEMA_VERSION = DEPTH_SCHEMA_VERSION;

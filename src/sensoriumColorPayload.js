import { decodeSensoriumMessagePack } from "./sensoriumMessagePack.js";
import { assertSensoriumSummaryWithinContract } from "./sensoriumStreamContracts.js";

const COLOR_CAPABILITY = "perception.sensorium.color.subscribe";
const COLOR_SCHEMA_VERSION = 1;

export function summarizeSensoriumColorPayload(payloadBytes) {
  const decoded = decodeSensoriumMessagePack(payloadBytes, {
    errorPrefix: "sensorium_color_msgpack",
  });
  if (!isPlainObject(decoded)) {
    throwColorDecodeError("sensorium_color_payload_not_object", "color payload must decode to an object");
  }

  const schemaVersion = decoded.schema_version;
  if (!Number.isInteger(schemaVersion)) {
    throwColorDecodeError("sensorium_color_schema_missing", "color payload schema_version must be an integer");
  }

  const summary = {
    schema_version: schemaVersion,
    frame_number: decoded.frame_number,
    width: decoded.width,
    height: decoded.height,
    format: decoded.format,
    payload_size: payloadByteLength(decoded.data),
  };

  const contracted = assertSensoriumSummaryWithinContract(COLOR_CAPABILITY, summary);
  return {
    ...contracted,
    schema_matches_expected: schemaVersion === COLOR_SCHEMA_VERSION,
    expected_schema_version: COLOR_SCHEMA_VERSION,
  };
}

function payloadByteLength(value) {
  if (value instanceof Uint8Array) {
    return value.byteLength;
  }
  if (Array.isArray(value)) {
    return value.length;
  }
  throwColorDecodeError("sensorium_color_data_invalid", "color payload data must be binary bytes");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwColorDecodeError(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export const SENSORIUM_COLOR_SCHEMA_VERSION = COLOR_SCHEMA_VERSION;

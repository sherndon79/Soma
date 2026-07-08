import { decodeSensoriumMessagePack } from "./sensoriumMessagePack.js";

export const SENSORIUM_PRESENCE_SCHEMA = "perception.presence.v0.1";

const COUNT_BUCKETS = new Set(["0", "1", "2_plus"]);
const ADDITIONAL_PERSON_VALUES = new Set(["present", "not_detected"]);
const CONFIDENCE_BUCKETS = new Set(["low", "medium", "high"]);
const MAX_PERSON_COUNT = 64;

export function summarizeSensoriumPresencePayload(payloadBytes) {
  const decoded = decodeSensoriumMessagePack(payloadBytes, {
    errorPrefix: "sensorium_presence_msgpack",
  });
  if (!isPlainObject(decoded)) {
    throwPresenceDecodeError("sensorium_presence_payload_not_object", "presence payload must decode to an object");
  }

  const schema = stringValue(decoded.schema);
  if (!schema) {
    throwPresenceDecodeError("sensorium_presence_schema_missing", "presence payload schema must be a non-empty string");
  }

  const summary = {
    schema,
    schema_matches_expected: schema === SENSORIUM_PRESENCE_SCHEMA,
    expected_schema: SENSORIUM_PRESENCE_SCHEMA,
    time: numberValue(decoded.time, "time"),
    frameset_sequence: integerValue(decoded.frameset_sequence, "frameset_sequence"),
    present: booleanValue(decoded.present, "present"),
    person_count: boundedNonNegativeIntegerValue(decoded.person_count, "person_count", MAX_PERSON_COUNT),
    count_bucket: enumValue(decoded.count_bucket, COUNT_BUCKETS, "count_bucket"),
    additional_person_present: enumValue(
      decoded.additional_person_present,
      ADDITIONAL_PERSON_VALUES,
      "additional_person_present",
    ),
    confidence_bucket: enumValue(decoded.confidence_bucket, CONFIDENCE_BUCKETS, "confidence_bucket"),
    source: stringValue(decoded.source) || "unknown",
  };

  return Object.freeze(summary);
}

function boundedNonNegativeIntegerValue(value, field, maximum) {
  const integer = integerValue(value, field);
  if (integer < 0 || integer > maximum) {
    throwPresenceDecodeError(
      `sensorium_presence_${field}_invalid`,
      `presence payload ${field} must be an integer from 0 to ${maximum}`,
    );
  }
  return integer;
}

function numberValue(value, field) {
  if (!Number.isFinite(value)) {
    throwPresenceDecodeError(
      `sensorium_presence_${field}_invalid`,
      `presence payload ${field} must be a finite number`,
    );
  }
  return value;
}

function integerValue(value, field) {
  if (!Number.isInteger(value)) {
    throwPresenceDecodeError(
      `sensorium_presence_${field}_invalid`,
      `presence payload ${field} must be an integer`,
    );
  }
  return value;
}

function booleanValue(value, field) {
  if (typeof value !== "boolean") {
    throwPresenceDecodeError(
      `sensorium_presence_${field}_invalid`,
      `presence payload ${field} must be a boolean`,
    );
  }
  return value;
}

function enumValue(value, allowed, field) {
  const text = stringValue(value);
  if (!allowed.has(text)) {
    throwPresenceDecodeError(
      `sensorium_presence_${field}_invalid`,
      `presence payload ${field} has an unsupported value`,
    );
  }
  return text;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwPresenceDecodeError(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

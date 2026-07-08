import { decodeSensoriumMessagePack } from "./sensoriumMessagePack.js";

export const SENSORIUM_POSE_SCHEMA = "perception.pose.contract.v0.2";

const MAX_PERSONS = 8;
const MAX_DETECTIONS = 16;
const MAX_OBJECT_KEYS = 64;
const MAX_ARRAY_ITEMS = 256;
const MAX_STRING_LENGTH = 4096;
const MAX_COPY_DEPTH = 8;

const LANDMARK_SETS = {
  body: { keypoints: "body_keypoints", scores: "body_scores", length: 17 },
  face: { keypoints: "face_keypoints", scores: "face_scores", length: 68 },
  left_hand: { keypoints: "left_hand_keypoints", scores: "left_hand_scores", length: 21 },
  right_hand: { keypoints: "right_hand_keypoints", scores: "right_hand_scores", length: 21 },
};

export function summarizeSensoriumPosePayload(payloadBytes) {
  const decoded = decodeSensoriumMessagePack(payloadBytes, {
    errorPrefix: "sensorium_pose_msgpack",
  });
  if (!isPlainObject(decoded)) {
    throwPoseDecodeError("sensorium_pose_payload_not_object", "pose payload must decode to an object");
  }

  const schema = stringValue(decoded.schema);
  if (!schema) {
    throwPoseDecodeError("sensorium_pose_schema_missing", "pose payload schema must be a non-empty string");
  }

  return Object.freeze({
    schema,
    schema_matches_expected: schema === SENSORIUM_POSE_SCHEMA,
    expected_schema: SENSORIUM_POSE_SCHEMA,
    derived_fields_version: stringValue(decoded.derived_fields_version),
    model: stringValue(decoded.model),
    processor: stringValue(decoded.processor),
    frameset_sequence: integerValue(decoded.frameset_sequence, "frameset_sequence"),
    capture_timestamp: numberValue(decoded.capture_timestamp, "capture_timestamp"),
    color: copyBoundedJson(decoded.color, "color", 0),
    depth: copyBoundedJson(decoded.depth, "depth", 0),
    tiers_available: copyStringArray(decoded.tiers_available, "tiers_available", 16),
    tracker: copyBoundedJson(decoded.tracker, "tracker", 0),
    persons: copyPersons(decoded.persons),
    detections: copyDetections(decoded.detections),
  });
}

function copyPersons(value) {
  if (!Array.isArray(value)) {
    throwPoseDecodeError("sensorium_pose_persons_invalid", "pose payload persons must be an array");
  }
  if (value.length > MAX_PERSONS) {
    throwPoseDecodeError("sensorium_pose_persons_too_many", `pose payload persons must contain at most ${MAX_PERSONS} entries`);
  }
  return value.map((person, index) => copyPerson(person, index));
}

function copyPerson(person, index) {
  if (!isPlainObject(person)) {
    throwPoseDecodeError("sensorium_pose_person_invalid", `pose payload persons[${index}] must be an object`);
  }
  const out = copyBoundedJson(person, `persons[${index}]`, 0);
  for (const spec of Object.values(LANDMARK_SETS)) {
    out[spec.keypoints] = copyKeypoints(person[spec.keypoints], spec.length, `${spec.keypoints}`);
    out[spec.scores] = copyScores(person[spec.scores], spec.length, `${spec.scores}`);
  }
  if (person.keypoint_count !== undefined) {
    out.keypoint_count = integerValue(person.keypoint_count, "keypoint_count");
  }
  return out;
}

function copyDetections(value) {
  if (!Array.isArray(value)) {
    throwPoseDecodeError("sensorium_pose_detections_invalid", "pose payload detections must be an array");
  }
  if (value.length > MAX_DETECTIONS) {
    throwPoseDecodeError("sensorium_pose_detections_too_many", `pose payload detections must contain at most ${MAX_DETECTIONS} entries`);
  }
  return value.map((detection, index) => {
    if (!isPlainObject(detection)) {
      throwPoseDecodeError("sensorium_pose_detection_invalid", `pose payload detections[${index}] must be an object`);
    }
    const out = copyBoundedJson(detection, `detections[${index}]`, 0);
    if ("xyxy" in detection) {
      out.xyxy = copyNumericArray(detection.xyxy, 4, "xyxy");
    }
    return out;
  });
}

function copyKeypoints(value, expectedLength, field) {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    throwPoseDecodeError(
      `sensorium_pose_${field}_invalid`,
      `pose payload ${field} must contain exactly ${expectedLength} keypoints`,
    );
  }
  return value.map((point, index) => copyKeypoint(point, `${field}[${index}]`));
}

function copyKeypoint(point, field) {
  if (Array.isArray(point)) {
    if (point.length < 2 || point.length > 3 || !point.every(Number.isFinite)) {
      throwPoseDecodeError(
        "sensorium_pose_keypoint_invalid",
        `pose payload ${field} must be [x, y] or [x, y, z] finite numbers`,
      );
    }
    return [...point];
  }
  if (isPlainObject(point)) {
    const x = numberValue(point.x, `${field}.x`);
    const y = numberValue(point.y, `${field}.y`);
    const out = { x, y };
    if (point.z !== undefined && point.z !== null) {
      out.z = numberValue(point.z, `${field}.z`);
    }
    return out;
  }
  throwPoseDecodeError(
    "sensorium_pose_keypoint_invalid",
    `pose payload ${field} must be an array or object keypoint`,
  );
}

function copyScores(value, expectedLength, field) {
  return copyNumericArray(value, expectedLength, field);
}

function copyNumericArray(value, expectedLength, field) {
  if (!Array.isArray(value) || value.length !== expectedLength || !value.every(Number.isFinite)) {
    throwPoseDecodeError(
      `sensorium_pose_${field}_invalid`,
      `pose payload ${field} must contain exactly ${expectedLength} finite numbers`,
    );
  }
  return [...value];
}

function copyStringArray(value, field, maxLength) {
  if (!Array.isArray(value) || value.length > maxLength) {
    throwPoseDecodeError(
      `sensorium_pose_${field}_invalid`,
      `pose payload ${field} must be an array with at most ${maxLength} strings`,
    );
  }
  return value.map((item, index) => {
    const text = stringValue(item);
    if (!text) {
      throwPoseDecodeError(
        `sensorium_pose_${field}_invalid`,
        `pose payload ${field}[${index}] must be a non-empty string`,
      );
    }
    return text;
  });
}

function copyBoundedJson(value, field, depth) {
  if (value === null || typeof value === "boolean" || Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) {
      throwPoseDecodeError("sensorium_pose_value_too_large", `pose payload ${field} string is too large`);
    }
    return value;
  }
  if (value instanceof Uint8Array) {
    throwPoseDecodeError("sensorium_pose_binary_unexpected", `pose payload ${field} must not contain binary frame data`);
  }
  if (depth >= MAX_COPY_DEPTH) {
    throwPoseDecodeError("sensorium_pose_value_too_deep", `pose payload ${field} exceeds maximum nesting depth`);
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) {
      throwPoseDecodeError("sensorium_pose_array_too_large", `pose payload ${field} array is too large`);
    }
    return value.map((item, index) => copyBoundedJson(item, `${field}[${index}]`, depth + 1));
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length > MAX_OBJECT_KEYS) {
      throwPoseDecodeError("sensorium_pose_object_too_large", `pose payload ${field} object has too many keys`);
    }
    const out = {};
    for (const [key, child] of entries) {
      if (typeof key !== "string" || key.length === 0 || key.length > 128) {
        throwPoseDecodeError("sensorium_pose_key_invalid", `pose payload ${field} has an invalid key`);
      }
      out[key] = copyBoundedJson(child, `${field}.${key}`, depth + 1);
    }
    return out;
  }
  throwPoseDecodeError("sensorium_pose_value_invalid", `pose payload ${field} contains an unsupported value`);
}

function numberValue(value, field) {
  if (!Number.isFinite(value)) {
    throwPoseDecodeError(
      `sensorium_pose_${sanitizeField(field)}_invalid`,
      `pose payload ${field} must be a finite number`,
    );
  }
  return value;
}

function integerValue(value, field) {
  if (!Number.isInteger(value)) {
    throwPoseDecodeError(
      `sensorium_pose_${sanitizeField(field)}_invalid`,
      `pose payload ${field} must be an integer`,
    );
  }
  return value;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeField(value) {
  return String(value).replace(/[^a-z0-9_]+/gi, "_").toLowerCase();
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwPoseDecodeError(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function encodeStatusPayload({
  schema_version = 1,
  timestamp = 1_779_000_000.5,
  hostname = "jetsorano",
  uptime_seconds = 12.5,
  node_version = "0.1.0",
  enabled_streams = ["realsense/color", "realsense/depth"],
  stream_profiles = [],
} = {}) {
  return [
    ...mapHeader(7),
    ...str("schema_version"),
    ...uint(schema_version),
    ...str("timestamp"),
    ...float64(timestamp),
    ...str("hostname"),
    ...str(hostname),
    ...str("uptime_seconds"),
    ...float64(uptime_seconds),
    ...str("node_version"),
    ...str(node_version),
    ...str("enabled_streams"),
    ...array(enabled_streams.map((item) => str(item))),
    ...str("stream_profiles"),
    ...array(stream_profiles.map(profile)),
  ];
}

export function encodeColorPayload({
  schema_version = 1,
  timestamp = 1_779_000_001.25,
  frame_number = 42,
  width = 1280,
  height = 720,
  format = "jpeg",
  data = [0xff, 0xd8, 0xff, 0xd9],
} = {}) {
  return [
    ...mapHeader(7),
    ...str("schema_version"),
    ...uint(schema_version),
    ...str("timestamp"),
    ...float64(timestamp),
    ...str("frame_number"),
    ...uint(frame_number),
    ...str("width"),
    ...uint(width),
    ...str("height"),
    ...uint(height),
    ...str("format"),
    ...str(format),
    ...str("data"),
    ...bin(data),
  ];
}

export function encodeDepthPayload({
  schema_version = 1,
  timestamp = 1_779_000_001.25,
  frame_number = 42,
  width = 1280,
  height = 720,
  format = "png",
  depth_units = 0.001,
  data = [0x89, 0x50, 0x4e, 0x47],
} = {}) {
  return [
    ...mapHeader(8),
    ...str("schema_version"),
    ...uint(schema_version),
    ...str("timestamp"),
    ...float64(timestamp),
    ...str("frame_number"),
    ...uint(frame_number),
    ...str("width"),
    ...uint(width),
    ...str("height"),
    ...uint(height),
    ...str("format"),
    ...str(format),
    ...str("depth_units"),
    ...float64(depth_units),
    ...str("data"),
    ...bin(data),
  ];
}

export function encodePresencePayload({
  schema = "perception.presence.v0.1",
  time = 1_783_447_951.14,
  frameset_sequence = 85_203,
  present = true,
  person_count = 1,
  count_bucket = "1",
  additional_person_present = "not_detected",
  confidence_bucket = "medium",
  source = "live",
} = {}) {
  return [
    ...mapHeader(9),
    ...str("schema"),
    ...str(schema),
    ...str("time"),
    ...float64(time),
    ...str("frameset_sequence"),
    ...uint(frameset_sequence),
    ...str("present"),
    ...(present ? [0xc3] : [0xc2]),
    ...str("person_count"),
    ...uint(person_count),
    ...str("count_bucket"),
    ...str(count_bucket),
    ...str("additional_person_present"),
    ...str(additional_person_present),
    ...str("confidence_bucket"),
    ...str(confidence_bucket),
    ...str("source"),
    ...str(source),
  ];
}

export function encodePosePayload(overrides = {}) {
  return encodeAny({
    schema: "perception.pose.contract.v0.2",
    derived_fields_version: "2026-07-08",
    model: "rtmo-wholebody",
    processor: "sensorium-pose-worker",
    frameset_sequence: 85_204,
    capture_timestamp: 1_783_447_952.14,
    color: { width: 1280, height: 720, fps: 15 },
    depth: { width: 1280, height: 720, depth_units: 0.001 },
    tiers_available: ["body", "face", "left_hand", "right_hand"],
    tracker: { active: true, next_track_id: 8 },
    persons: [
      {
        track_id: 7,
        keypoint_count: 127,
        body_keypoints: points(17, 10),
        body_scores: scores(17, 0.91),
        face_keypoints: points(68, 100),
        face_scores: scores(68, 0.72),
        left_hand_keypoints: points(21, 200),
        left_hand_scores: scores(21, 0.81),
        right_hand_keypoints: points(21, 300),
        right_hand_scores: scores(21, 0.83),
        derived: {
          posture: "standing",
          gaze: "toward_display",
          gestures: ["open_hand"],
          hand_visibility: { left: "visible", right: "visible" },
          position_3d: { x: 0.1, y: 0.2, z: 1.4 },
          mouth_moving: false,
          motion: "low",
          fall: "not_detected",
        },
      },
    ],
    detections: [
      {
        detection_id: "det-7",
        track_id: 7,
        xyxy: [10, 20, 300, 600],
        score: 0.94,
      },
    ],
    ...overrides,
  });
}

function mapHeader(length) {
  if (length <= 15) return [0x80 | length];
  return [0xde, (length >> 8) & 0xff, length & 0xff];
}

function array(items) {
  const flat = items.flat();
  if (items.length <= 15) return [0x90 | items.length, ...flat];
  return [0xdc, (items.length >> 8) & 0xff, items.length & 0xff, ...flat];
}

function profile(value) {
  const entries = [
    ["stream", str(value.stream)],
  ];
  for (const key of ["width", "height", "fps", "jpeg_quality"]) {
    if (value[key] !== undefined && value[key] !== null) {
      entries.push([key, uint(value[key])]);
    }
  }
  if (value.format !== undefined && value.format !== null) {
    entries.push(["format", str(value.format)]);
  }
  return [
    ...mapHeader(entries.length),
    ...entries.flatMap(([key, encoded]) => [...str(key), ...encoded]),
  ];
}

function str(value) {
  const bytes = Array.from(new TextEncoder().encode(value));
  if (bytes.length <= 31) return [0xa0 | bytes.length, ...bytes];
  if (bytes.length <= 0xff) return [0xd9, bytes.length, ...bytes];
  return [0xda, (bytes.length >> 8) & 0xff, bytes.length & 0xff, ...bytes];
}

function uint(value) {
  if (value <= 0x7f) return [value];
  if (value <= 0xff) return [0xcc, value];
  if (value <= 0xffff) return [0xcd, (value >> 8) & 0xff, value & 0xff];
  return [
    0xce,
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

function bin(value) {
  const bytes = value instanceof Uint8Array
    ? Array.from(value)
    : Array.from(value ?? []);
  if (bytes.length <= 0xff) return [0xc4, bytes.length, ...bytes];
  if (bytes.length <= 0xffff) {
    return [0xc5, (bytes.length >> 8) & 0xff, bytes.length & 0xff, ...bytes];
  }
  return [
    0xc6,
    (bytes.length >>> 24) & 0xff,
    (bytes.length >>> 16) & 0xff,
    (bytes.length >>> 8) & 0xff,
    bytes.length & 0xff,
    ...bytes,
  ];
}

function float64(value) {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value, false);
  return [0xcb, ...Array.from(new Uint8Array(buffer))];
}

function points(length, offset) {
  return Array.from({ length }, (_, index) => [offset + index, offset + index + 0.5]);
}

function scores(length, value) {
  return Array.from({ length }, (_, index) => value - index / 1000);
}

function encodeAny(value) {
  if (value === null || value === undefined) return [0xc0];
  if (typeof value === "boolean") return value ? [0xc3] : [0xc2];
  if (typeof value === "number") {
    if (Number.isInteger(value) && value >= 0) return uint(value);
    return float64(value);
  }
  if (typeof value === "string") return str(value);
  if (value instanceof Uint8Array || value?.type === "Buffer") return bin(value);
  if (Array.isArray(value)) return array(value.map(encodeAny));
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    return [
      ...mapHeader(entries.length),
      ...entries.flatMap(([key, child]) => [...str(key), ...encodeAny(child)]),
    ];
  }
  throw new TypeError(`unsupported msgpack test value: ${String(value)}`);
}

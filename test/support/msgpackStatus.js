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

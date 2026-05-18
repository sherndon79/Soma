export function encodeStatusPayload({
  schema_version = 1,
  timestamp = 1_779_000_000.5,
  hostname = "jetsorano",
  uptime_seconds = 12.5,
  node_version = "0.1.0",
  enabled_streams = ["realsense/color", "realsense/depth"],
} = {}) {
  return [
    ...mapHeader(6),
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

function float64(value) {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value, false);
  return [0xcb, ...Array.from(new Uint8Array(buffer))];
}

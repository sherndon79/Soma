const STATUS_SCHEMA_VERSION = 1;

export function summarizeSensoriumStatusPayload(payloadBytes) {
  const decoded = decodeMessagePack(payloadBytes);
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

function decodeMessagePack(payloadBytes) {
  const bytes = normalizeBytes(payloadBytes);
  const reader = new MessagePackReader(bytes);
  const value = reader.readValue();
  if (!reader.done()) {
    throwStatusDecodeError("sensorium_status_payload_trailing_bytes", "status payload has trailing bytes");
  }
  return value;
}

function normalizeBytes(payloadBytes) {
  if (payloadBytes instanceof Uint8Array) {
    return payloadBytes;
  }
  if (Array.isArray(payloadBytes)) {
    return Uint8Array.from(payloadBytes);
  }
  throwStatusDecodeError("sensorium_status_payload_invalid_bytes", "status payload bytes must be an array or Uint8Array");
}

class MessagePackReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = 0;
  }

  done() {
    return this.offset === this.bytes.length;
  }

  readValue() {
    const prefix = this.readU8();

    if (prefix <= 0x7f) return prefix;
    if (prefix >= 0x80 && prefix <= 0x8f) return this.readMap(prefix & 0x0f);
    if (prefix >= 0x90 && prefix <= 0x9f) return this.readArray(prefix & 0x0f);
    if (prefix >= 0xa0 && prefix <= 0xbf) return this.readString(prefix & 0x1f);
    if (prefix >= 0xe0) return prefix - 0x100;

    switch (prefix) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xca: return this.readFloat32();
      case 0xcb: return this.readFloat64();
      case 0xcc: return this.readU8();
      case 0xcd: return this.readU16();
      case 0xce: return this.readU32();
      case 0xcf: return this.readU64();
      case 0xd0: return this.readI8();
      case 0xd1: return this.readI16();
      case 0xd2: return this.readI32();
      case 0xd3: return this.readI64();
      case 0xd9: return this.readString(this.readU8());
      case 0xda: return this.readString(this.readU16());
      case 0xdb: return this.readString(this.readU32());
      case 0xdc: return this.readArray(this.readU16());
      case 0xdd: return this.readArray(this.readU32());
      case 0xde: return this.readMap(this.readU16());
      case 0xdf: return this.readMap(this.readU32());
      default:
        throwStatusDecodeError("sensorium_status_msgpack_unsupported", `unsupported MessagePack prefix 0x${prefix.toString(16)}`);
    }
  }

  readMap(length) {
    const out = {};
    for (let i = 0; i < length; i++) {
      const key = this.readValue();
      const value = this.readValue();
      if (typeof key === "string") {
        out[key] = value;
      }
    }
    return out;
  }

  readArray(length) {
    const out = [];
    for (let i = 0; i < length; i++) {
      out.push(this.readValue());
    }
    return out;
  }

  readString(length) {
    this.ensure(length);
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return new TextDecoder("utf-8", { fatal: true }).decode(slice);
  }

  readU8() {
    this.ensure(1);
    return this.bytes[this.offset++];
  }

  readI8() {
    const value = this.readU8();
    return value > 0x7f ? value - 0x100 : value;
  }

  readU16() {
    this.ensure(2);
    const value = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return value;
  }

  readI16() {
    this.ensure(2);
    const value = this.view.getInt16(this.offset, false);
    this.offset += 2;
    return value;
  }

  readU32() {
    this.ensure(4);
    const value = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return value;
  }

  readI32() {
    this.ensure(4);
    const value = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return value;
  }

  readU64() {
    this.ensure(8);
    const value = this.view.getBigUint64(this.offset, false);
    this.offset += 8;
    return Number(value);
  }

  readI64() {
    this.ensure(8);
    const value = this.view.getBigInt64(this.offset, false);
    this.offset += 8;
    return Number(value);
  }

  readFloat32() {
    this.ensure(4);
    const value = this.view.getFloat32(this.offset, false);
    this.offset += 4;
    return value;
  }

  readFloat64() {
    this.ensure(8);
    const value = this.view.getFloat64(this.offset, false);
    this.offset += 8;
    return value;
  }

  ensure(length) {
    if (this.offset + length > this.bytes.length) {
      throwStatusDecodeError("sensorium_status_msgpack_truncated", "status payload MessagePack data is truncated");
    }
  }
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

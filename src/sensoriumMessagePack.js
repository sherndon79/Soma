export function decodeSensoriumMessagePack(payloadBytes, { errorPrefix = "sensorium_msgpack" } = {}) {
  const bytes = normalizeBytes(payloadBytes, errorPrefix);
  const reader = new MessagePackReader(bytes, errorPrefix);
  const value = reader.readValue();
  if (!reader.done()) {
    throwDecodeError(errorPrefix, "trailing_bytes", "MessagePack payload has trailing bytes");
  }
  return value;
}

function normalizeBytes(payloadBytes, errorPrefix) {
  if (payloadBytes instanceof Uint8Array) {
    return payloadBytes;
  }
  if (Array.isArray(payloadBytes)) {
    return Uint8Array.from(payloadBytes);
  }
  throwDecodeError(errorPrefix, "invalid_bytes", "MessagePack payload bytes must be an array or Uint8Array");
}

class MessagePackReader {
  constructor(bytes, errorPrefix) {
    this.bytes = bytes;
    this.errorPrefix = errorPrefix;
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
      case 0xc4: return this.readBinary(this.readU8());
      case 0xc5: return this.readBinary(this.readU16());
      case 0xc6: return this.readBinary(this.readU32());
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
        throwDecodeError(
          this.errorPrefix,
          "unsupported",
          `unsupported MessagePack prefix 0x${prefix.toString(16)}`,
        );
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

  readBinary(length) {
    this.ensure(length);
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
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
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throwDecodeError(this.errorPrefix, "unsafe_integer", "MessagePack uint64 exceeds safe JavaScript integer range");
    }
    return Number(value);
  }

  readI64() {
    this.ensure(8);
    const value = this.view.getBigInt64(this.offset, false);
    this.offset += 8;
    if (
      value < BigInt(Number.MIN_SAFE_INTEGER) ||
      value > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throwDecodeError(this.errorPrefix, "unsafe_integer", "MessagePack int64 exceeds safe JavaScript integer range");
    }
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
      throwDecodeError(this.errorPrefix, "truncated", "MessagePack payload data is truncated");
    }
  }
}

function throwDecodeError(prefix, code, message) {
  const error = new Error(message);
  error.code = `${prefix}_${code}`;
  throw error;
}

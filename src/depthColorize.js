import { deflateSync, inflateSync } from "node:zlib";

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const COLOR_TYPE_GRAYSCALE = 0;
const COMPRESSION_DEFLATE = 0;
const FILTER_ADAPTIVE = 0;
const INTERLACE_NONE = 0;
const DEFAULT_MIN_DEPTH_METERS = 0.25;
const DEFAULT_MAX_DEPTH_METERS = 5.0;
const GRAYSCALE_COLORMAP = "grayscale";

export function colorizeDepthPng(depthPngBytes, {
  depthUnits = 0.001,
  minDepthMeters = DEFAULT_MIN_DEPTH_METERS,
  maxDepthMeters = DEFAULT_MAX_DEPTH_METERS,
} = {}) {
  const decoded = decodePng(depthPngBytes);
  if (decoded.colorType !== COLOR_TYPE_GRAYSCALE || decoded.bitDepth !== 16) {
    throwDepthColorizeError(
      "depth_png_unsupported_format",
      "depth colorization requires a 16-bit grayscale PNG",
    );
  }
  const normalizedDepthUnits = finitePositive(depthUnits)
    ? depthUnits
    : DEFAULT_MIN_DEPTH_METERS / 250;
  const minMeters = finitePositive(minDepthMeters) ? minDepthMeters : DEFAULT_MIN_DEPTH_METERS;
  const maxMeters = finitePositive(maxDepthMeters) && maxDepthMeters > minMeters
    ? maxDepthMeters
    : DEFAULT_MAX_DEPTH_METERS;
  const output = new Uint8Array(decoded.width * decoded.height);
  for (let i = 0, pixel = 0; i < decoded.pixels.byteLength; i += 2, pixel += 1) {
    const raw = (decoded.pixels[i] << 8) | decoded.pixels[i + 1];
    if (raw === 0) {
      output[pixel] = 0;
      continue;
    }
    const meters = raw * normalizedDepthUnits;
    const normalized = clamp((meters - minMeters) / (maxMeters - minMeters), 0, 1);
    output[pixel] = Math.round(normalized * 255);
  }
  const payloadBytes = encodeGrayscalePng({
    width: decoded.width,
    height: decoded.height,
    pixels: output,
  });
  return {
    payload_bytes: payloadBytes,
    media_type: "image/png",
    representation: "colorized_png",
    colormap: GRAYSCALE_COLORMAP,
    normalization: {
      rule: "fixed_metric_range",
      min_depth_meters: minMeters,
      max_depth_meters: maxMeters,
      invalid_depth_value: 0,
    },
    depth_units: normalizedDepthUnits,
    width: decoded.width,
    height: decoded.height,
  };
}

export function encodeDepthPng16({ width, height, values }) {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throwDepthColorizeError("depth_png_dimensions_invalid", "PNG dimensions must be positive integers");
  }
  if (!Array.isArray(values) && !(values instanceof Uint16Array)) {
    throwDepthColorizeError("depth_png_values_invalid", "depth values must be an array or Uint16Array");
  }
  if (values.length !== width * height) {
    throwDepthColorizeError("depth_png_values_invalid", "depth value count must match dimensions");
  }
  const rows = new Uint8Array(height * (1 + width * 2));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    rows[offset++] = 0;
    for (let x = 0; x < width; x += 1) {
      const value = Number(values[y * width + x]);
      const raw = Number.isInteger(value) ? clamp(value, 0, 0xffff) : 0;
      rows[offset++] = (raw >> 8) & 0xff;
      rows[offset++] = raw & 0xff;
    }
  }
  return encodePng({
    width,
    height,
    bitDepth: 16,
    colorType: COLOR_TYPE_GRAYSCALE,
    rawRows: rows,
  });
}

function decodePng(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes ?? []);
  if (data.byteLength < PNG_SIGNATURE.byteLength || !byteArrayEquals(data.slice(0, 8), PNG_SIGNATURE)) {
    throwDepthColorizeError("depth_png_signature_invalid", "depth payload is not a PNG");
  }
  let offset = PNG_SIGNATURE.byteLength;
  let header = null;
  const idatChunks = [];
  while (offset + 12 <= data.byteLength) {
    const length = readUint32(data, offset);
    offset += 4;
    const type = ascii(data.slice(offset, offset + 4));
    offset += 4;
    if (offset + length + 4 > data.byteLength) {
      throwDepthColorizeError("depth_png_chunk_truncated", "PNG chunk exceeds payload length");
    }
    const chunkData = data.slice(offset, offset + length);
    offset += length + 4;
    if (type === "IHDR") {
      header = parseIhdr(chunkData);
    } else if (type === "IDAT") {
      idatChunks.push(chunkData);
    } else if (type === "IEND") {
      break;
    }
  }
  if (!header) {
    throwDepthColorizeError("depth_png_ihdr_missing", "PNG IHDR is missing");
  }
  if (header.compression !== COMPRESSION_DEFLATE || header.filter !== FILTER_ADAPTIVE || header.interlace !== INTERLACE_NONE) {
    throwDepthColorizeError("depth_png_unsupported_format", "PNG compression, filter, or interlace mode is unsupported");
  }
  if (idatChunks.length === 0) {
    throwDepthColorizeError("depth_png_idat_missing", "PNG IDAT is missing");
  }
  const compressed = concatUint8(idatChunks);
  const inflated = new Uint8Array(inflateSync(compressed));
  const bytesPerPixel = bytesPerPixelFor(header);
  const stride = header.width * bytesPerPixel;
  const expectedLength = header.height * (1 + stride);
  if (inflated.byteLength !== expectedLength) {
    throwDepthColorizeError("depth_png_raster_size_invalid", "PNG raster size does not match dimensions");
  }
  const pixels = new Uint8Array(header.height * stride);
  let sourceOffset = 0;
  let prior = new Uint8Array(stride);
  for (let y = 0; y < header.height; y += 1) {
    const filterType = inflated[sourceOffset++];
    const row = inflated.slice(sourceOffset, sourceOffset + stride);
    sourceOffset += stride;
    const unfiltered = unfilterRow(row, prior, filterType, bytesPerPixel);
    pixels.set(unfiltered, y * stride);
    prior = unfiltered;
  }
  return {
    ...header,
    pixels,
  };
}

function encodeGrayscalePng({ width, height, pixels }) {
  if (!(pixels instanceof Uint8Array) || pixels.byteLength !== width * height) {
    throwDepthColorizeError("depth_colorized_pixels_invalid", "colorized pixel count must match dimensions");
  }
  const rows = new Uint8Array(height * (1 + width));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    rows[offset++] = 0;
    rows.set(pixels.slice(y * width, y * width + width), offset);
    offset += width;
  }
  return encodePng({
    width,
    height,
    bitDepth: 8,
    colorType: COLOR_TYPE_GRAYSCALE,
    rawRows: rows,
  });
}

function encodePng({ width, height, bitDepth, colorType, rawRows }) {
  const chunks = [
    pngChunk("IHDR", ihdrBytes({ width, height, bitDepth, colorType })),
    pngChunk("IDAT", new Uint8Array(deflateSync(rawRows))),
    pngChunk("IEND", new Uint8Array()),
  ];
  return concatUint8([PNG_SIGNATURE, ...chunks]);
}

function parseIhdr(data) {
  if (data.byteLength !== 13) {
    throwDepthColorizeError("depth_png_ihdr_invalid", "PNG IHDR has invalid length");
  }
  return {
    width: readUint32(data, 0),
    height: readUint32(data, 4),
    bitDepth: data[8],
    colorType: data[9],
    compression: data[10],
    filter: data[11],
    interlace: data[12],
  };
}

function ihdrBytes({ width, height, bitDepth, colorType }) {
  const data = new Uint8Array(13);
  writeUint32(data, 0, width);
  writeUint32(data, 4, height);
  data[8] = bitDepth;
  data[9] = colorType;
  data[10] = COMPRESSION_DEFLATE;
  data[11] = FILTER_ADAPTIVE;
  data[12] = INTERLACE_NONE;
  return data;
}

function pngChunk(type, data) {
  const typeBytes = Uint8Array.from(type, (char) => char.charCodeAt(0));
  const chunk = new Uint8Array(12 + data.byteLength);
  writeUint32(chunk, 0, data.byteLength);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.byteLength, crc32(concatUint8([typeBytes, data])));
  return chunk;
}

function bytesPerPixelFor(header) {
  if (header.colorType !== COLOR_TYPE_GRAYSCALE) {
    throwDepthColorizeError("depth_png_unsupported_format", "only grayscale PNG is supported");
  }
  if (header.bitDepth === 8) return 1;
  if (header.bitDepth === 16) return 2;
  throwDepthColorizeError("depth_png_unsupported_format", "only 8-bit or 16-bit grayscale PNG is supported");
}

function unfilterRow(row, prior, filterType, bytesPerPixel) {
  const out = new Uint8Array(row.byteLength);
  for (let i = 0; i < row.byteLength; i += 1) {
    const left = i >= bytesPerPixel ? out[i - bytesPerPixel] : 0;
    const up = prior[i] ?? 0;
    const upLeft = i >= bytesPerPixel ? prior[i - bytesPerPixel] : 0;
    let value;
    if (filterType === 0) {
      value = row[i];
    } else if (filterType === 1) {
      value = row[i] + left;
    } else if (filterType === 2) {
      value = row[i] + up;
    } else if (filterType === 3) {
      value = row[i] + Math.floor((left + up) / 2);
    } else if (filterType === 4) {
      value = row[i] + paeth(left, up, upLeft);
    } else {
      throwDepthColorizeError("depth_png_filter_unsupported", "PNG filter type is unsupported");
    }
    out[i] = value & 0xff;
  }
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readUint32(data, offset) {
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

function writeUint32(data, offset, value) {
  data[offset] = (value >>> 24) & 0xff;
  data[offset + 1] = (value >>> 16) & 0xff;
  data[offset + 2] = (value >>> 8) & 0xff;
  data[offset + 3] = value & 0xff;
}

function concatUint8(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function ascii(bytes) {
  return String.fromCharCode(...bytes);
}

function byteArrayEquals(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function throwDepthColorizeError(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

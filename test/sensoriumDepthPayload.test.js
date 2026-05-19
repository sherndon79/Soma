import assert from "node:assert/strict";
import test from "node:test";

import {
  SENSORIUM_DEPTH_SCHEMA_VERSION,
  summarizeSensoriumDepthPayload,
} from "../src/sensoriumDepthPayload.js";
import { encodeDepthPayload } from "./support/msgpackStatus.js";

test("summarizeSensoriumDepthPayload returns only bounded depth metadata", () => {
  const summary = summarizeSensoriumDepthPayload(
    encodeDepthPayload({
      schema_version: 1,
      timestamp: 1_779_000_001.25,
      frame_number: 42,
      width: 1280,
      height: 720,
      format: "png",
      depth_units: 0.001,
      data: [0x89, 0x50, 0x4e, 0x47, 0x01, 0x02],
    }),
  );

  assert.deepEqual(summary, {
    schema_version: 1,
    frame_number: 42,
    width: 1280,
    height: 720,
    format: "png",
    depth_units: 0.001,
    payload_size: 6,
    schema_matches_expected: true,
    expected_schema_version: SENSORIUM_DEPTH_SCHEMA_VERSION,
  });
  assert.equal("data" in summary, false);
  assert.equal("payload_bytes" in summary, false);
  assert.equal("depth_array" in summary, false);
  assert.equal("timestamp" in summary, false);
});

test("summarizeSensoriumDepthPayload reports schema mismatch without retaining bytes", () => {
  const summary = summarizeSensoriumDepthPayload(
    encodeDepthPayload({
      schema_version: 2,
      frame_number: 99,
      width: 640,
      height: 480,
      data: [1, 2, 3],
    }),
  );

  assert.equal(summary.schema_version, 2);
  assert.equal(summary.schema_matches_expected, false);
  assert.equal(summary.expected_schema_version, 1);
  assert.equal(summary.payload_size, 3);
  assert.equal("data" in summary, false);
});

test("summarizeSensoriumDepthPayload rejects malformed or out-of-contract payloads", () => {
  assert.throws(
    () => summarizeSensoriumDepthPayload([0xc1]),
    { code: "sensorium_depth_msgpack_unsupported" },
  );
  assert.throws(
    () =>
      summarizeSensoriumDepthPayload(
        encodeDepthPayload({
          format: "jpeg",
        }),
      ),
    { code: "sensorium_stream_summary_contract_violation" },
  );
  assert.throws(
    () =>
      summarizeSensoriumDepthPayload(
        encodeDepthPayload({
          depth_units: 0,
        }),
      ),
    { code: "sensorium_stream_summary_contract_violation" },
  );
  assert.throws(
    () =>
      summarizeSensoriumDepthPayload([
        0x88,
        0xae, ...Array.from(new TextEncoder().encode("schema_version")), 0x01,
        0xac, ...Array.from(new TextEncoder().encode("frame_number")), 0x01,
        0xa5, ...Array.from(new TextEncoder().encode("width")), 0xcd, 0x02, 0x80,
        0xa6, ...Array.from(new TextEncoder().encode("height")), 0xcd, 0x01, 0xe0,
        0xa6, ...Array.from(new TextEncoder().encode("format")), 0xa3, ...Array.from(new TextEncoder().encode("png")),
        0xab, ...Array.from(new TextEncoder().encode("depth_units")), 0xcb, 0x3f, 0x50, 0x62, 0x4d, 0xd2, 0xf1, 0xa9, 0xfc,
        0xa4, ...Array.from(new TextEncoder().encode("data")), 0xc0,
        0xa9, ...Array.from(new TextEncoder().encode("raw_depth")), 0x91, 0x01,
      ]),
    { code: "sensorium_depth_data_invalid" },
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  SENSORIUM_COLOR_SCHEMA_VERSION,
  summarizeSensoriumColorPayload,
} from "../src/sensoriumColorPayload.js";
import { encodeColorPayload } from "./support/msgpackStatus.js";

test("summarizeSensoriumColorPayload returns only bounded color metadata", () => {
  const summary = summarizeSensoriumColorPayload(
    encodeColorPayload({
      schema_version: 1,
      timestamp: 1_779_000_001.25,
      frame_number: 42,
      width: 1280,
      height: 720,
      format: "jpeg",
      data: [0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9],
    }),
  );

  assert.deepEqual(summary, {
    schema_version: 1,
    frame_number: 42,
    width: 1280,
    height: 720,
    format: "jpeg",
    payload_size: 6,
    schema_matches_expected: true,
    expected_schema_version: SENSORIUM_COLOR_SCHEMA_VERSION,
  });
  assert.equal("data" in summary, false);
  assert.equal("payload_bytes" in summary, false);
  assert.equal("timestamp" in summary, false);
});

test("summarizeSensoriumColorPayload reports schema mismatch without retaining bytes", () => {
  const summary = summarizeSensoriumColorPayload(
    encodeColorPayload({
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

test("summarizeSensoriumColorPayload rejects malformed or out-of-contract payloads", () => {
  assert.throws(
    () => summarizeSensoriumColorPayload([0xc1]),
    { code: "sensorium_color_msgpack_unsupported" },
  );
  assert.throws(
    () =>
      summarizeSensoriumColorPayload(
        encodeColorPayload({
          format: "png",
        }),
      ),
    { code: "sensorium_stream_summary_contract_violation" },
  );
  assert.throws(
    () =>
      summarizeSensoriumColorPayload(
        encodeColorPayload({
          width: 0,
        }),
      ),
    { code: "sensorium_stream_summary_contract_violation" },
  );
  assert.throws(
    () =>
      summarizeSensoriumColorPayload([
        0x86,
        0xae, ...Array.from(new TextEncoder().encode("schema_version")), 0x01,
        0xac, ...Array.from(new TextEncoder().encode("frame_number")), 0x01,
        0xa5, ...Array.from(new TextEncoder().encode("width")), 0xcd, 0x02, 0x80,
        0xa6, ...Array.from(new TextEncoder().encode("height")), 0xcd, 0x01, 0xe0,
        0xa6, ...Array.from(new TextEncoder().encode("format")), 0xa4, ...Array.from(new TextEncoder().encode("jpeg")),
        0xa4, ...Array.from(new TextEncoder().encode("data")), 0xc0,
      ]),
    { code: "sensorium_color_data_invalid" },
  );
});

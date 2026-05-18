import assert from "node:assert/strict";
import test from "node:test";

import {
  SENSORIUM_STATUS_SCHEMA_VERSION,
  summarizeSensoriumStatusPayload,
} from "../src/sensoriumStatusPayload.js";
import { encodeStatusPayload } from "./support/msgpackStatus.js";

test("summarizeSensoriumStatusPayload returns only the bounded status summary", () => {
  const summary = summarizeSensoriumStatusPayload(
    encodeStatusPayload({
      schema_version: 1,
      timestamp: 1_779_000_000.5,
      hostname: "jetsorano",
      uptime_seconds: 12.5,
      node_version: "0.1.0",
      enabled_streams: ["realsense/color", "realsense/depth"],
    }),
  );

  assert.deepEqual(summary, {
    schema_version: 1,
    schema_matches_expected: true,
    expected_schema_version: SENSORIUM_STATUS_SCHEMA_VERSION,
    hostname: "jetsorano",
    uptime_seconds: 12.5,
    node_version: "0.1.0",
    enabled_streams: ["realsense/color", "realsense/depth"],
  });
  assert.equal("timestamp" in summary, false);
});

test("summarizeSensoriumStatusPayload reports schema mismatch without hiding the observed version", () => {
  const summary = summarizeSensoriumStatusPayload(
    encodeStatusPayload({
      schema_version: 2,
      hostname: "jetsorano",
      uptime_seconds: 1,
      node_version: "0.2.0",
      enabled_streams: [],
    }),
  );

  assert.equal(summary.schema_version, 2);
  assert.equal(summary.schema_matches_expected, false);
  assert.equal(summary.expected_schema_version, 1);
});

test("summarizeSensoriumStatusPayload rejects malformed payloads", () => {
  assert.throws(
    () => summarizeSensoriumStatusPayload([0xc1]),
    { code: "sensorium_status_msgpack_unsupported" },
  );
  assert.throws(
    () =>
      summarizeSensoriumStatusPayload(
        encodeStatusPayload({
          schema_version: 1,
          hostname: "jetsorano",
          uptime_seconds: -1,
          node_version: "0.1.0",
          enabled_streams: [],
        }),
      ),
    { code: "sensorium_status_uptime_invalid" },
  );
});

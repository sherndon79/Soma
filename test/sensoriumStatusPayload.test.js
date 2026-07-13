import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  SENSORIUM_STATUS_SCHEMA_VERSION,
  summarizeSensoriumStatusPayload,
} from "../src/sensoriumStatusPayload.js";
import { encodeAny, encodeStatusPayload } from "./support/msgpackStatus.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SENSORIUM_STATUS_FIXTURES = path.join(REPO_ROOT, "Sensorium-codex-work", "fixtures", "status");

test("summarizeSensoriumStatusPayload returns only the bounded status summary", () => {
  const summary = summarizeSensoriumStatusPayload(
    encodeStatusPayload({
      schema_version: 1,
      timestamp: 1_779_000_000.5,
      hostname: "jetsorano",
      uptime_seconds: 12.5,
      node_version: "0.1.0",
      enabled_streams: ["realsense/color", "realsense/depth"],
      stream_profiles: [
        {
          stream: "realsense/color",
          width: 1280,
          height: 720,
          fps: 30,
          format: "jpeg",
          jpeg_quality: 85,
        },
        {
          stream: "realsense/depth",
          width: 848,
          height: 480,
          fps: 30,
          format: "png",
        },
      ],
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
    stream_profiles: [
      {
        stream: "realsense/color",
        width: 1280,
        height: 720,
        fps: 30,
        format: "jpeg",
        jpeg_quality: 85,
      },
      {
        stream: "realsense/depth",
        width: 848,
        height: 480,
        fps: 30,
        format: "png",
      },
    ],
  });
  assert.equal("timestamp" in summary, false);
});

test("summarizeSensoriumStatusPayload accepts additive schema v2 status payloads", () => {
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
  assert.equal(summary.schema_matches_expected, true);
  assert.equal(summary.expected_schema_version, SENSORIUM_STATUS_SCHEMA_VERSION);
  assert.deepEqual(summary.enabled_streams, []);
});

for (const fixtureName of ["jetsorano-running.json", "rae-running-with-detail.json"]) {
  test(`summarizeSensoriumStatusPayload accepts Sensorium v2 fixture ${fixtureName}`, () => {
    const fixture = readStatusFixture(fixtureName);
    const summary = summarizeSensoriumStatusPayload(encodeAny(fixture));

    assert.equal(summary.schema_version, 2);
    assert.equal(summary.schema_matches_expected, true);
    assert.equal(summary.expected_schema_version, SENSORIUM_STATUS_SCHEMA_VERSION);
    assert.equal(summary.hostname, fixture.hostname);
    assert.equal(summary.uptime_seconds, fixture.uptime_seconds);
    assert.equal(summary.node_version, fixture.node_version);
    assert.deepEqual(summary.enabled_streams, fixture.enabled_streams);
    assert.deepEqual(summary.stream_profiles, expectedStreamProfiles(fixture.stream_profiles));
    assert.equal("timestamp" in summary, false);
    assert.equal("stream_health" in summary, false);
    assert.equal("system" in summary, false);
    assert.equal("vision" in summary, false);
  });
}

test("summarizeSensoriumStatusPayload reports schema mismatch without hiding the observed version", () => {
  const summary = summarizeSensoriumStatusPayload(
    encodeStatusPayload({
      schema_version: 3,
      hostname: "jetsorano",
      uptime_seconds: 1,
      node_version: "0.2.0",
      enabled_streams: [],
    }),
  );

  assert.equal(summary.schema_version, 3);
  assert.equal(summary.schema_matches_expected, false);
  assert.equal(summary.expected_schema_version, SENSORIUM_STATUS_SCHEMA_VERSION);
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
  assert.throws(
    () =>
      summarizeSensoriumStatusPayload(
        encodeStatusPayload({
          stream_profiles: [{ stream: "realsense/color", width: 0 }],
        }),
      ),
    { code: "sensorium_status_profile_number_invalid" },
  );
});

function readStatusFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(SENSORIUM_STATUS_FIXTURES, name), "utf8"));
}

function expectedStreamProfiles(profiles) {
  return profiles.map((profile) => {
    const out = { stream: profile.stream };
    for (const key of ["width", "height", "fps", "jpeg_quality", "format"]) {
      if (profile[key] !== undefined && profile[key] !== null) {
        out[key] = profile[key];
      }
    }
    return out;
  });
}

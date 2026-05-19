import assert from "node:assert/strict";
import test from "node:test";

import {
  SENSORIUM_COLOR_STREAM_CONTRACT,
  SENSORIUM_DEPTH_STREAM_CONTRACT,
  assertSensoriumSummaryWithinContract,
  getSensoriumStreamContract,
} from "../src/sensoriumStreamContracts.js";

test("color stream contract documents allowed summary fields and excluded content", () => {
  const contract = getSensoriumStreamContract("perception.sensorium.color.subscribe");

  assert.equal(contract.risk_class, "restricted");
  assert.equal(contract.expected_schema_version, 1);
  assert.deepEqual(contract.allowed_summary_fields, [
    "schema_version",
    "frame_number",
    "width",
    "height",
    "format",
    "payload_size",
  ]);
  assert.ok(contract.excluded_fields.includes("data"));
  assert.ok(contract.excluded_fields.includes("payload_bytes"));
  assert.ok(contract.excluded_fields.includes("screenshot"));
  assert.equal(contract.content_retention, "forbidden");
  assert.equal(contract.model_delivery_without_further_grant, false);
  assert.deepEqual(SENSORIUM_COLOR_STREAM_CONTRACT.allowed_formats, ["jpeg"]);
});

test("color stream contract accepts bounded frame metadata summary", () => {
  const summary = assertSensoriumSummaryWithinContract(
    "perception.sensorium.color.subscribe",
    {
      schema_version: 1,
      frame_number: 42,
      width: 1280,
      height: 720,
      format: "jpeg",
      payload_size: 86_123,
    },
  );

  assert.deepEqual(summary, {
    schema_version: 1,
    frame_number: 42,
    width: 1280,
    height: 720,
    format: "jpeg",
    payload_size: 86_123,
  });
});

test("color stream contract rejects image bytes and content-bearing fields", () => {
  for (const field of ["data", "payload_bytes", "image_bytes", "screenshot", "raw_frame"]) {
    assert.throws(
      () =>
        assertSensoriumSummaryWithinContract(
          "perception.sensorium.color.subscribe",
          {
            schema_version: 1,
            frame_number: 42,
            width: 1280,
            height: 720,
            format: "jpeg",
            payload_size: 86_123,
            [field]: [1, 2, 3],
          },
        ),
      { code: "sensorium_stream_summary_contract_violation" },
      `expected ${field} to be rejected`,
    );
  }
});

test("color stream contract rejects cross-stream and unsupported summary fields", () => {
  for (const field of ["depth_units", "uptime_seconds", "enabled_streams", "timestamp"]) {
    assert.throws(
      () =>
        assertSensoriumSummaryWithinContract(
          "perception.sensorium.color.subscribe",
          {
            schema_version: 1,
            frame_number: 42,
            width: 1280,
            height: 720,
            format: "jpeg",
            payload_size: 86_123,
            [field]: field === "enabled_streams" ? ["realsense/color"] : 1,
          },
        ),
      { code: "sensorium_stream_summary_contract_violation" },
      `expected ${field} to be rejected`,
    );
  }
});

test("color stream contract rejects malformed summary metadata", () => {
  const cases = [
    { schema_version: "1", frame_number: 1, width: 1280, height: 720, format: "jpeg", payload_size: 1 },
    { schema_version: 1, frame_number: -1, width: 1280, height: 720, format: "jpeg", payload_size: 1 },
    { schema_version: 1, frame_number: 1, width: 0, height: 720, format: "jpeg", payload_size: 1 },
    { schema_version: 1, frame_number: 1, width: 1280, height: 720, format: "png", payload_size: 1 },
    { schema_version: 1, frame_number: 1, width: 1280, height: 720, format: "jpeg", payload_size: -1 },
  ];

  for (const summary of cases) {
    assert.throws(
      () => assertSensoriumSummaryWithinContract("perception.sensorium.color.subscribe", summary),
      { code: "sensorium_stream_summary_contract_violation" },
    );
  }
});

test("depth stream contract documents allowed summary fields and excluded content", () => {
  const contract = getSensoriumStreamContract("perception.sensorium.depth.subscribe");

  assert.equal(contract.risk_class, "restricted");
  assert.equal(contract.expected_schema_version, 1);
  assert.deepEqual(contract.allowed_summary_fields, [
    "schema_version",
    "frame_number",
    "width",
    "height",
    "format",
    "depth_units",
    "payload_size",
  ]);
  assert.ok(contract.excluded_fields.includes("data"));
  assert.ok(contract.excluded_fields.includes("payload_bytes"));
  assert.ok(contract.excluded_fields.includes("depth_array"));
  assert.ok(contract.excluded_fields.includes("raw_depth"));
  assert.ok(contract.excluded_fields.includes("point_cloud"));
  assert.ok(contract.excluded_fields.includes("screenshot"));
  assert.equal(contract.content_retention, "forbidden");
  assert.equal(contract.model_delivery_without_further_grant, false);
  assert.deepEqual(SENSORIUM_DEPTH_STREAM_CONTRACT.allowed_formats, ["png"]);
});

test("depth stream contract accepts bounded frame metadata summary", () => {
  const summary = assertSensoriumSummaryWithinContract(
    "perception.sensorium.depth.subscribe",
    {
      schema_version: 1,
      frame_number: 42,
      width: 1280,
      height: 720,
      format: "png",
      depth_units: 0.001,
      payload_size: 86_123,
    },
  );

  assert.deepEqual(summary, {
    schema_version: 1,
    frame_number: 42,
    width: 1280,
    height: 720,
    format: "png",
    depth_units: 0.001,
    payload_size: 86_123,
  });
});

test("depth stream contract rejects raw depth content and derived geometry", () => {
  for (const field of ["data", "payload_bytes", "depth_bytes", "depth_array", "raw_depth", "point_cloud", "mesh"]) {
    assert.throws(
      () =>
        assertSensoriumSummaryWithinContract(
          "perception.sensorium.depth.subscribe",
          {
            schema_version: 1,
            frame_number: 42,
            width: 1280,
            height: 720,
            format: "png",
            depth_units: 0.001,
            payload_size: 86_123,
            [field]: [1, 2, 3],
          },
        ),
      { code: "sensorium_stream_summary_contract_violation" },
      `expected ${field} to be rejected`,
    );
  }
});

test("depth stream contract rejects cross-stream and unsupported summary fields", () => {
  for (const field of ["uptime_seconds", "enabled_streams", "timestamp", "image_content"]) {
    assert.throws(
      () =>
        assertSensoriumSummaryWithinContract(
          "perception.sensorium.depth.subscribe",
          {
            schema_version: 1,
            frame_number: 42,
            width: 1280,
            height: 720,
            format: "png",
            depth_units: 0.001,
            payload_size: 86_123,
            [field]: field === "enabled_streams" ? ["realsense/depth"] : 1,
          },
        ),
      { code: "sensorium_stream_summary_contract_violation" },
      `expected ${field} to be rejected`,
    );
  }
});

test("depth stream contract rejects malformed summary metadata", () => {
  const cases = [
    { schema_version: "1", frame_number: 1, width: 1280, height: 720, format: "png", depth_units: 0.001, payload_size: 1 },
    { schema_version: 1, frame_number: -1, width: 1280, height: 720, format: "png", depth_units: 0.001, payload_size: 1 },
    { schema_version: 1, frame_number: 1, width: 0, height: 720, format: "png", depth_units: 0.001, payload_size: 1 },
    { schema_version: 1, frame_number: 1, width: 1280, height: 720, format: "jpeg", depth_units: 0.001, payload_size: 1 },
    { schema_version: 1, frame_number: 1, width: 1280, height: 720, format: "png", depth_units: 0, payload_size: 1 },
    { schema_version: 1, frame_number: 1, width: 1280, height: 720, format: "png", depth_units: Number.POSITIVE_INFINITY, payload_size: 1 },
    { schema_version: 1, frame_number: 1, width: 1280, height: 720, format: "png", depth_units: 0.001, payload_size: -1 },
  ];

  for (const summary of cases) {
    assert.throws(
      () => assertSensoriumSummaryWithinContract("perception.sensorium.depth.subscribe", summary),
      { code: "sensorium_stream_summary_contract_violation" },
    );
  }
});

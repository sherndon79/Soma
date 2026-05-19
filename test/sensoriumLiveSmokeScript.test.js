import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SENSORIUM_SMOKE,
  buildSensoriumLiveSmokePlan,
  formatCliCommand,
  parseSensoriumLiveSmokeArgs,
  sensoriumLiveSmokeGuardErrors,
  validateCameraSmokeEndSummary,
  validateCameraSmokeFrameBound,
} from "../scripts/sensorium-live-smoke.js";

test("sensorium live smoke refuses unless both explicit guards are set", () => {
  assert.deepEqual(sensoriumLiveSmokeGuardErrors({}), [
    "SOMA_SENSORIUM_ENABLED=1 is required",
    "SOMA_SENSORIUM_LIVE_SMOKE=1 is required",
  ]);
  assert.deepEqual(sensoriumLiveSmokeGuardErrors({
    SOMA_SENSORIUM_ENABLED: "1",
    SOMA_SENSORIUM_LIVE_SMOKE: "yes",
  }), []);
});

test("sensorium live smoke requires extra acknowledgement for camera-class targets", () => {
  const options = parseSensoriumLiveSmokeArgs([
    "--capability", "perception.sensorium.color.subscribe",
    "--provider", "soma.provider.sensorium.jetsorano",
    "--topic", "sensor/jetsorano/realsense/color",
    "--max-seconds", "15",
    "--max-fps", "1",
    "--format", "jpeg",
    "--downsample", "320x240",
  ]);

  assert.deepEqual(sensoriumLiveSmokeGuardErrors({
    SOMA_SENSORIUM_ENABLED: "1",
    SOMA_SENSORIUM_LIVE_SMOKE: "1",
  }, options), [
    "camera-class Sensorium smoke requires --acknowledge-camera-stream or SOMA_SENSORIUM_CAMERA_SMOKE=1",
  ]);

  assert.deepEqual(sensoriumLiveSmokeGuardErrors({
    SOMA_SENSORIUM_ENABLED: "1",
    SOMA_SENSORIUM_LIVE_SMOKE: "1",
    SOMA_SENSORIUM_CAMERA_SMOKE: "1",
  }, options), []);

  const acknowledged = parseSensoriumLiveSmokeArgs([
    "--capability", "perception.sensorium.color.subscribe",
    "--provider", "soma.provider.sensorium.jetsorano",
    "--topic", "sensor/jetsorano/realsense/color",
    "--max-seconds", "15",
    "--max-fps", "1",
    "--format", "jpeg",
    "--downsample", "320x240",
    "--acknowledge-camera-stream",
  ]);
  assert.deepEqual(sensoriumLiveSmokeGuardErrors({
    SOMA_SENSORIUM_ENABLED: "1",
    SOMA_SENSORIUM_LIVE_SMOKE: "1",
  }, acknowledged), []);
});

test("sensorium live smoke defaults to status-topic-only workflow", () => {
  const options = parseSensoriumLiveSmokeArgs([]);

  assert.equal(options.capability, DEFAULT_SENSORIUM_SMOKE.capability);
  assert.equal(options.provider, DEFAULT_SENSORIUM_SMOKE.provider);
  assert.equal(options.topic, DEFAULT_SENSORIUM_SMOKE.topic);
  assert.equal(options.maxSeconds, DEFAULT_SENSORIUM_SMOKE.maxSeconds);
  assert.equal(options.observeSeconds, DEFAULT_SENSORIUM_SMOKE.observeSeconds);
  assert.equal(options.observeSeconds, "8");

  const plan = buildSensoriumLiveSmokePlan(options);
  assert.equal(plan[1].args[0], "sensorium");
  assert.equal(plan[1].args[1], "propose");
  assert.ok(plan[1].args.includes("perception.sensorium.status.subscribe"));
  assert.ok(plan[1].args.includes("sensor/jetsorano/status"));
  assert.ok(plan[4].args.includes("subscribe-start"));
});

test("sensorium live smoke custom targets require the full explicit target tuple", () => {
  assert.throws(
    () => parseSensoriumLiveSmokeArgs(["--topic", "sensor/other/status"]),
    /custom smoke targets require all of --capability, --provider, --topic, and --max-seconds/,
  );

  const options = parseSensoriumLiveSmokeArgs([
    "--capability", "perception.sensorium.status.subscribe",
    "--provider", "soma.provider.sensorium.other",
    "--topic", "sensor/other/status",
    "--max-seconds", "15",
    "--observe-seconds", "5",
  ]);
  assert.equal(options.provider, "soma.provider.sensorium.other");
  assert.equal(options.topic, "sensor/other/status");
  assert.equal(options.maxSeconds, "15");
  assert.equal(options.observeSeconds, "5");
});

test("sensorium live smoke rejects invalid observation waits", () => {
  assert.throws(
    () => parseSensoriumLiveSmokeArgs(["--observe-seconds", "0"]),
    /--observe-seconds must be an integer from 1 to 60/,
  );
});

test("sensorium live smoke requires bounded video constraints for color targets", () => {
  assert.throws(
    () => parseSensoriumLiveSmokeArgs([
      "--capability", "perception.sensorium.color.subscribe",
      "--provider", "soma.provider.sensorium.jetsorano",
      "--topic", "sensor/jetsorano/realsense/color",
      "--max-seconds", "15",
    ]),
    /camera-class smoke requires --max-fps/,
  );

  assert.throws(
    () => parseSensoriumLiveSmokeArgs([
      "--capability", "perception.sensorium.color.subscribe",
      "--provider", "soma.provider.sensorium.jetsorano",
      "--topic", "sensor/jetsorano/realsense/color",
      "--max-seconds", "15",
      "--max-fps", "1",
      "--format", "jpeg",
      "--downsample", "bad",
    ]),
    /--downsample must use WIDTHxHEIGHT/,
  );
});

test("sensorium live smoke plan preserves grant-before-subscribe order and runtime cleanup", () => {
  const labels = buildSensoriumLiveSmokePlan(DEFAULT_SENSORIUM_SMOKE).map((entry) => entry.label);

  assert.ok(labels.indexOf("create runtime session grant from approved proposal") < labels.indexOf("start bounded Sensorium subscription"));
  assert.ok(labels.indexOf("stop bounded Sensorium subscription") < labels.indexOf("revoke runtime session grant"));
});

test("sensorium live smoke plan carries bounded color constraints", () => {
  const options = parseSensoriumLiveSmokeArgs([
    "--capability", "perception.sensorium.color.subscribe",
    "--provider", "soma.provider.sensorium.jetsorano",
    "--topic", "sensor/jetsorano/realsense/color",
    "--max-seconds", "15",
    "--max-fps", "1",
    "--format", "jpeg",
    "--downsample", "320x240",
    "--acknowledge-camera-stream",
  ]);
  const plan = buildSensoriumLiveSmokePlan(options);

  assert.ok(plan[1].args.includes("--max-fps"));
  assert.ok(plan[1].args.includes("1"));
  assert.ok(plan[1].args.includes("--format"));
  assert.ok(plan[1].args.includes("jpeg"));
  assert.ok(plan[1].args.includes("--downsample"));
  assert.ok(plan[1].args.includes("320x240"));
  assert.ok(plan[4].args.includes("--max-fps"));
  assert.ok(plan[4].args.includes("--format"));
  assert.ok(plan[4].args.includes("--downsample"));
});

test("sensorium live smoke validates color metadata-only end summaries", () => {
  const options = parseSensoriumLiveSmokeArgs([
    "--capability", "perception.sensorium.color.subscribe",
    "--provider", "soma.provider.sensorium.jetsorano",
    "--topic", "sensor/jetsorano/realsense/color",
    "--max-seconds", "15",
    "--max-fps", "1",
    "--format", "jpeg",
    "--downsample", "320x240",
    "--acknowledge-camera-stream",
  ]);

  assert.doesNotThrow(() =>
    validateCameraSmokeEndSummary({
      stream_summary_observed: {
        schema_version: 1,
        frame_number: 42,
        width: 320,
        height: 180,
        format: "jpeg",
        payload_size: 128,
      },
    }, options),
  );
  assert.throws(
    () =>
      validateCameraSmokeEndSummary({
        stream_summary_observed: {
          schema_version: 1,
          frame_number: 42,
          width: 1280,
          height: 720,
          format: "jpeg",
          payload_size: 128,
        },
      }, options),
    /exceeded downsample bound/,
  );
  assert.throws(
    () => validateCameraSmokeEndSummary({ stream_summary_observed: null }, options),
    /did not receive bounded stream_summary_observed metadata/,
  );
  assert.throws(
    () =>
      validateCameraSmokeEndSummary({
        stream_summary_observed: {
          schema_version: 1,
          frame_number: 42,
          width: 320,
          height: 240,
          format: "jpeg",
          payload_size: 128,
          data: [1, 2, 3],
        },
      }, options),
    /forbidden content field/,
  );
});

test("sensorium live smoke validates depth metadata includes units", () => {
  const options = parseSensoriumLiveSmokeArgs([
    "--capability", "perception.sensorium.depth.subscribe",
    "--provider", "soma.provider.sensorium.jetsorano",
    "--topic", "sensor/jetsorano/realsense/depth",
    "--max-seconds", "15",
    "--max-fps", "1",
    "--format", "png",
    "--downsample", "320x240",
    "--acknowledge-camera-stream",
  ]);

  assert.doesNotThrow(() =>
    validateCameraSmokeEndSummary({
      stream_summary_observed: {
        schema_version: 1,
        frame_number: 42,
        width: 320,
        height: 181,
        format: "png",
        depth_units: 0.001,
        payload_size: 62143,
      },
    }, options),
  );
  assert.throws(
    () =>
      validateCameraSmokeEndSummary({
        stream_summary_observed: {
          schema_version: 1,
          frame_number: 42,
          width: 320,
          height: 181,
          format: "png",
          payload_size: 62143,
        },
      }, options),
    /missing positive finite depth_units/,
  );
  assert.throws(
    () =>
      validateCameraSmokeEndSummary({
        stream_summary_observed: {
          schema_version: 1,
          frame_number: 42,
          width: 320,
          height: 181,
          format: "jpeg",
          depth_units: 0.001,
          payload_size: 62143,
        },
      }, options),
    /expected png/,
  );
});

test("sensorium live smoke rejects camera sample counts far beyond max_fps", () => {
  const options = parseSensoriumLiveSmokeArgs([
    "--capability", "perception.sensorium.color.subscribe",
    "--provider", "soma.provider.sensorium.jetsorano",
    "--topic", "sensor/jetsorano/realsense/color",
    "--max-seconds", "15",
    "--max-fps", "1",
    "--format", "jpeg",
    "--downsample", "320x240",
    "--observe-seconds", "8",
    "--acknowledge-camera-stream",
  ]);

  assert.doesNotThrow(() => validateCameraSmokeFrameBound(9, options));
  assert.throws(
    () => validateCameraSmokeFrameBound(194, options),
    /exceeded max_fps delivery bound/,
  );
});

test("formatCliCommand quotes human text without changing machine-readable flags", () => {
  assert.equal(
    formatCliCommand(["sensorium", "grant-revoke", "grant-1", "--reason", "Smoke test complete."]),
    "npm run cli -- sensorium grant-revoke grant-1 --reason 'Smoke test complete.'",
  );
});

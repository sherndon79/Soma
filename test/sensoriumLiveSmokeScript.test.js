import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SENSORIUM_SMOKE,
  buildSensoriumLiveSmokePlan,
  formatCliCommand,
  parseSensoriumLiveSmokeArgs,
  sensoriumLiveSmokeGuardErrors,
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

test("sensorium live smoke defaults to status-topic-only workflow", () => {
  const options = parseSensoriumLiveSmokeArgs([]);

  assert.equal(options.capability, DEFAULT_SENSORIUM_SMOKE.capability);
  assert.equal(options.provider, DEFAULT_SENSORIUM_SMOKE.provider);
  assert.equal(options.topic, DEFAULT_SENSORIUM_SMOKE.topic);
  assert.equal(options.maxSeconds, DEFAULT_SENSORIUM_SMOKE.maxSeconds);

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
  ]);
  assert.equal(options.provider, "soma.provider.sensorium.other");
  assert.equal(options.topic, "sensor/other/status");
  assert.equal(options.maxSeconds, "15");
});

test("sensorium live smoke plan preserves grant-before-subscribe order and runtime cleanup", () => {
  const labels = buildSensoriumLiveSmokePlan(DEFAULT_SENSORIUM_SMOKE).map((entry) => entry.label);

  assert.ok(labels.indexOf("create runtime session grant from approved proposal") < labels.indexOf("start bounded Sensorium subscription"));
  assert.ok(labels.indexOf("stop bounded Sensorium subscription") < labels.indexOf("revoke runtime session grant"));
});

test("formatCliCommand quotes human text without changing machine-readable flags", () => {
  assert.equal(
    formatCliCommand(["sensorium", "grant-revoke", "grant-1", "--reason", "Smoke test complete."]),
    "npm run cli -- sensorium grant-revoke grant-1 --reason 'Smoke test complete.'",
  );
});

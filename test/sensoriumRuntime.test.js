import assert from "node:assert/strict";
import test from "node:test";

import {
  createSensoriumRuntime,
  isSensoriumRuntimeEnabled,
} from "../src/sensoriumRuntime.js";

test("isSensoriumRuntimeEnabled recognizes explicit opt-in values only", () => {
  assert.equal(isSensoriumRuntimeEnabled({}), false);
  assert.equal(isSensoriumRuntimeEnabled({ SOMA_SENSORIUM_ENABLED: "0" }), false);
  assert.equal(isSensoriumRuntimeEnabled({ SOMA_SENSORIUM_ENABLED: "false" }), false);
  assert.equal(isSensoriumRuntimeEnabled({ SOMA_SENSORIUM_ENABLED: "1" }), true);
  assert.equal(isSensoriumRuntimeEnabled({ SOMA_SENSORIUM_ENABLED: "true" }), true);
  assert.equal(isSensoriumRuntimeEnabled({ SOMA_SENSORIUM_ENABLED: "YES" }), true);
});

test("createSensoriumRuntime returns default-off runtime without constructing helper", async () => {
  let managerConstructed = false;
  const runtime = await createSensoriumRuntime({
    env: {},
    managerFactory() {
      managerConstructed = true;
      throw new Error("should not construct manager when disabled");
    },
  });

  assert.equal(runtime.enabled, false);
  assert.equal(runtime.subscriber, null);
  assert.equal(runtime.helper_path, "");
  assert.equal(managerConstructed, false);
  await runtime.stop();
});

test("createSensoriumRuntime starts helper and constructs subscriber when enabled", async () => {
  const events = [];
  const runtime = await createSensoriumRuntime({
    env: {
      SOMA_SENSORIUM_ENABLED: "1",
      SOMA_SENSOR_BROKER: "/tmp/test-soma-sensor-broker",
    },
    logger: {
      info(message) {
        events.push(["info", message]);
      },
      error(message) {
        events.push(["error", message]);
      },
    },
    managerFactory({ binaryPath }) {
      events.push(["manager", binaryPath]);
      return {
        async start() {
          events.push(["start", binaryPath]);
          return { pid: 123 };
        },
        async stop() {
          events.push(["stop", binaryPath]);
        },
      };
    },
    subscriberFactory({ manager }) {
      events.push(["subscriber", Boolean(manager)]);
      return { kind: "fake-subscriber" };
    },
  });

  assert.equal(runtime.enabled, true);
  assert.deepEqual(runtime.subscriber, { kind: "fake-subscriber" });
  assert.equal(runtime.helper_path, "/tmp/test-soma-sensor-broker");
  await runtime.stop();
  assert.deepEqual(events, [
    ["manager", "/tmp/test-soma-sensor-broker"],
    ["start", "/tmp/test-soma-sensor-broker"],
    ["info", "Sensorium runtime enabled with helper /tmp/test-soma-sensor-broker"],
    ["subscriber", true],
    ["stop", "/tmp/test-soma-sensor-broker"],
  ]);
});

test("createSensoriumRuntime surfaces helper startup failure with stable code", async () => {
  const messages = [];
  await assert.rejects(
    () => createSensoriumRuntime({
      env: {
        SOMA_SENSORIUM_ENABLED: "true",
        SOMA_SENSOR_BROKER: "/tmp/missing-sensor-broker",
      },
      logger: {
        error(message) {
          messages.push(message);
        },
      },
      managerFactory() {
        return {
          async start() {
            throw new Error("missing executable");
          },
          async stop() {},
        };
      },
    }),
    (error) => {
      assert.equal(error.code, "sensorium_runtime_start_failed");
      assert.equal(error.helper_path, "/tmp/missing-sensor-broker");
      assert.match(error.message, /could not start sensor broker helper/);
      assert.match(error.cause.message, /missing executable/);
      return true;
    },
  );

  assert.equal(messages.length, 1);
  assert.match(messages[0], /Sensorium runtime opt-in failed/);
});

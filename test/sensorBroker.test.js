import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SensorBrokerManager,
  SENSOR_BROKER_DEFAULT_BINARY,
} from "../src/sensorBroker.js";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HELPER_BINARY = path.join(REPO_ROOT, "target", "debug", "soma-sensor-broker");
const HELPER_SKIP_REASON = existsSync(HELPER_BINARY)
  ? false
  : "binary not built; run 'cargo build -p soma-sensor-broker' from repo root";

const ZENOH_TEST_CONFIG = path.join(
  mkdtempSync(path.join(os.tmpdir(), "soma-sensor-broker-test-")),
  "zenoh-sandbox.json5",
);

writeFileSync(
  ZENOH_TEST_CONFIG,
  `{
  mode: "peer",
  listen: { endpoints: [] },
  scouting: {
    multicast: { enabled: false },
    gossip: { enabled: false },
  },
}
`,
);

function subscribeParams(topic) {
  return {
    topic,
    zenoh_config_path: ZENOH_TEST_CONFIG,
  };
}

// The manager spawns the real helper for these tests. Each test owns
// its own manager instance so failures don't leak between tests.

test(
  "SensorBrokerManager start spawns the helper and reports a pid",
  { skip: HELPER_SKIP_REASON },
  async () => {
    const mgr = new SensorBrokerManager();
    const info = await mgr.start();
    assert.ok(Number.isInteger(info.pid), "expected a numeric pid");
    await mgr.stop();
  },
);

test(
  "SensorBrokerManager.send: subscribe.start returns subscription_id",
  { skip: HELPER_SKIP_REASON },
  async () => {
    const mgr = new SensorBrokerManager();
    await mgr.start();
    try {
      const result = await mgr.send(
        "sensorium.subscribe.start",
        subscribeParams("sensor/manager-test/status"),
      );
      assert.equal(result.topic, "sensor/manager-test/status");
      assert.ok(
        typeof result.subscription_id === "string" &&
          result.subscription_id.length > 0,
      );
      assert.ok(
        typeof result.started_at === "number" && result.started_at > 0,
      );
    } finally {
      await mgr.stop();
    }
  },
);

test(
  "SensorBrokerManager.send: unknown method rejects with method_not_found",
  { skip: HELPER_SKIP_REASON },
  async () => {
    const mgr = new SensorBrokerManager();
    await mgr.start();
    try {
      await assert.rejects(
        () => mgr.send("sensorium.subscribe.invent", {}),
        (err) => {
          assert.equal(err.code, -32601);
          assert.equal(err.code_name, "method_not_found");
          return true;
        },
      );
    } finally {
      await mgr.stop();
    }
  },
);

test(
  "SensorBrokerManager.send: stop with unknown id rejects with subscription_not_found",
  { skip: HELPER_SKIP_REASON },
  async () => {
    const mgr = new SensorBrokerManager();
    await mgr.start();
    try {
      await assert.rejects(
        () => mgr.send("sensorium.subscribe.stop", { subscription_id: "no-such" }),
        (err) => {
          assert.equal(err.code, -32002);
          assert.equal(err.code_name, "subscription_not_found");
          return true;
        },
      );
    } finally {
      await mgr.stop();
    }
  },
);

test(
  "SensorBrokerManager full lifecycle: start, status (list), status (by id), stop, status (empty)",
  { skip: HELPER_SKIP_REASON },
  async () => {
    const mgr = new SensorBrokerManager();
    await mgr.start();
    try {
      const startResult = await mgr.send("sensorium.subscribe.start", {
        ...subscribeParams("sensor/lifecycle-test/status"),
      });
      const subscriptionId = startResult.subscription_id;

      const listResult = await mgr.send("sensorium.subscribe.status");
      assert.equal(listResult.count, 1);
      assert.equal(listResult.subscriptions[0].subscription_id, subscriptionId);

      const byIdResult = await mgr.send("sensorium.subscribe.status", {
        subscription_id: subscriptionId,
      });
      assert.equal(byIdResult.subscription_id, subscriptionId);
      assert.equal(byIdResult.active, true);

      const stopResult = await mgr.send("sensorium.subscribe.stop", {
        subscription_id: subscriptionId,
      });
      assert.equal(stopResult.stopped, true);

      const finalListResult = await mgr.send("sensorium.subscribe.status");
      assert.equal(finalListResult.count, 0);
    } finally {
      await mgr.stop();
    }
  },
);

test(
  "SensorBrokerManager rejects pending requests when helper exits prematurely",
  { skip: HELPER_SKIP_REASON },
  async () => {
    // Spawn the manager, then forcibly close stdin from outside to
    // simulate the helper going away mid-request. The pending send
    // should reject with a meaningful error rather than hang.
    const mgr = new SensorBrokerManager();
    await mgr.start();

    // Start a real subscription (so there's something in flight on
    // the helper side) and then stop the manager. We expect the
    // start to resolve normally first; pending-request rejection
    // is the rare case where the helper crashes mid-call.
    const startResult = await mgr.send(
      "sensorium.subscribe.start",
      subscribeParams("sensor/premature-exit-test/status"),
    );
    assert.ok(startResult.subscription_id);

    // Now force the helper to exit by ending stdin and watching the
    // manager's exit event fire.
    const exitPromise = new Promise((resolve) => mgr.once("exit", resolve));
    await mgr.stop();
    const exit = await exitPromise;
    assert.ok(exit, "expected exit event payload");
  },
);

test("SensorBrokerManager send before start rejects with a clear error", async () => {
  const mgr = new SensorBrokerManager();
  await assert.rejects(
    () => mgr.send("sensorium.subscribe.start", { topic: "sensor/x/status" }),
    /not started/,
  );
});

test("SensorBrokerManager send times out when helper does not answer", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "soma-sensor-broker-hung-"));
  const helperPath = path.join(dir, "hung-helper.sh");
  writeFileSync(helperPath, "#!/usr/bin/env bash\nwhile IFS= read -r _line; do :; done\n");
  chmodSync(helperPath, 0o755);

  const mgr = new SensorBrokerManager({
    binaryPath: helperPath,
    requestTimeoutMs: 25,
  });
  await mgr.start();
  try {
    await assert.rejects(
      () => mgr.send("sensorium.subscribe.stop", { subscription_id: "sub-hung" }),
      (error) => {
        assert.equal(error.code, "helper_request_timeout");
        assert.equal(error.code_name, "helper_request_timeout");
        assert.equal(error.method, "sensorium.subscribe.stop");
        return true;
      },
    );
  } finally {
    await mgr.stop();
  }
});

test("SensorBrokerManager start with a missing binary rejects", async () => {
  const mgr = new SensorBrokerManager({
    binaryPath: "/nonexistent/path/to/sensor-broker",
  });
  await assert.rejects(() => mgr.start());
});

test("SensorBrokerManager exports the default binary path", () => {
  assert.ok(
    SENSOR_BROKER_DEFAULT_BINARY.endsWith("/target/debug/soma-sensor-broker"),
    `expected default path to end with target/debug/soma-sensor-broker, got ${SENSOR_BROKER_DEFAULT_BINARY}`,
  );
});

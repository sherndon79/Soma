import assert from "node:assert/strict";
import test from "node:test";

import {
  createRemoteGraphicalRuntime,
  isRemoteGraphicalRuntimeRequested,
  resolveRemoteGraphicalRuntimePosture,
} from "../src/remoteGraphicalRuntime.js";

test("isRemoteGraphicalRuntimeRequested recognizes explicit opt-in values only", () => {
  assert.equal(isRemoteGraphicalRuntimeRequested({}), false);
  assert.equal(isRemoteGraphicalRuntimeRequested({ SOMA_REMOTE_GRAPHICAL_ENABLED: "0" }), false);
  assert.equal(isRemoteGraphicalRuntimeRequested({ SOMA_REMOTE_GRAPHICAL_ENABLED: "false" }), false);
  assert.equal(isRemoteGraphicalRuntimeRequested({ SOMA_REMOTE_GRAPHICAL_ENABLED: "1" }), true);
  assert.equal(isRemoteGraphicalRuntimeRequested({ SOMA_REMOTE_GRAPHICAL_ENABLED: "true" }), true);
  assert.equal(isRemoteGraphicalRuntimeRequested({ SOMA_REMOTE_GRAPHICAL_ENABLED: "YES" }), true);
  assert.equal(isRemoteGraphicalRuntimeRequested({ SOMA_REMOTE_GRAPHICAL_ENABLED: "on" }), true);
});

test("resolveRemoteGraphicalRuntimePosture keeps broker unconfigured until a provider is injected", () => {
  assert.deepEqual(resolveRemoteGraphicalRuntimePosture({}), {
    requested: false,
    enabled: false,
    configured: false,
  });
  assert.deepEqual(resolveRemoteGraphicalRuntimePosture({ SOMA_REMOTE_GRAPHICAL_ENABLED: "1" }), {
    requested: true,
    enabled: false,
    configured: false,
  });
});

test("createRemoteGraphicalRuntime constructs only a no-op posture broker", async () => {
  const events = [];
  const runtime = await createRemoteGraphicalRuntime({
    env: { SOMA_REMOTE_GRAPHICAL_ENABLED: "1" },
    brokerFactory({ posture }) {
      events.push(["broker", posture]);
      return {
        describeActive() {
          return { runtimePosture: posture };
        },
      };
    },
  });

  assert.equal(runtime.requested, true);
  assert.equal(runtime.enabled, false);
  assert.equal(runtime.configured, false);
  assert.equal(typeof runtime.broker.describeActive, "function");
  await runtime.stop();
  assert.deepEqual(events, [[
    "broker",
    {
      requested: true,
      enabled: false,
      configured: false,
    },
  ]]);
});

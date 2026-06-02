import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveRuntimeWritePosture,
  runtimeWritePostureFromEnv,
} from "../src/runtimeWritePosture.js";

test("resolveRuntimeWritePosture defaults to disabled non-authorizing posture", () => {
  const posture = resolveRuntimeWritePosture();

  assert.equal(posture.runtime_writes_enabled, false);
  assert.equal(posture.durable_grant_mutation_enabled, false);
  assert.equal(posture.activation_supported, false);
  assert.equal(posture.requested, false);
  assert.equal(posture.status, "disabled");
});

test("resolveRuntimeWritePosture enables durable grant mutation only when explicitly requested", () => {
  const posture = resolveRuntimeWritePosture({
    requested: true,
    source: "test",
  });

  assert.equal(posture.runtime_writes_enabled, true);
  assert.equal(posture.durable_grant_mutation_enabled, true);
  assert.equal(posture.activation_supported, true);
  assert.equal(posture.requested, true);
  assert.equal(posture.source, "test");
  assert.equal(posture.status, "enabled");
});

test("runtimeWritePostureFromEnv treats SOMA_RUNTIME_WRITES_ENABLED as durable write opt-in", () => {
  const posture = runtimeWritePostureFromEnv({ SOMA_RUNTIME_WRITES_ENABLED: "true" });

  assert.equal(posture.runtime_writes_enabled, true);
  assert.equal(posture.durable_grant_mutation_enabled, true);
  assert.equal(posture.requested, true);
  assert.equal(posture.source, "SOMA_RUNTIME_WRITES_ENABLED");
  assert.equal(posture.status, "enabled");
});

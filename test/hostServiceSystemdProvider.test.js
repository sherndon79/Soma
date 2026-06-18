import assert from "node:assert/strict";
import test from "node:test";

import {
  createSystemdProviderAdapter,
  createSystemdProviderProcess,
  validateProviderResponse,
} from "../src/hostServiceSystemdProvider.js";

test("operational systemd process is disabled by default and never spawns", async () => {
  let spawnCalls = 0;
  const provider = createSystemdProviderProcess({
    spawnFn() {
      spawnCalls += 1;
      throw new Error("must not spawn");
    },
  });
  await assert.rejects(
    provider.request({ method: "status_read", inventory_id: "fixture" }),
    (error) => error.code === "service_status_unavailable",
  );
  assert.equal(spawnCalls, 0);
});

test("synchronous real adapter is disabled by default and never spawns", () => {
  let spawnCalls = 0;
  const provider = createSystemdProviderAdapter({
    spawnSyncFn() {
      spawnCalls += 1;
      throw new Error("must not spawn");
    },
  });
  assert.throws(
    () => provider.inspectForPlan({ unit_inventory_id: "fixture" }),
    (error) => error.code === "service_status_unavailable",
  );
  assert.equal(spawnCalls, 0);
});

test("Node validator rejects extra provider fields and raw diagnostics", () => {
  assert.throws(
    () => validateProviderResponse({
      request_id: "request-1",
      ok: true,
      result: {
        ...validResult(),
        unit_name: "secret.service",
        status_text: "CANARY_SECRET",
      },
    }, "request-1"),
    (error) => error.code === "service_status_output_invalid",
  );
});

test("Node validator maps unknown provider errors to a stable refusal", () => {
  assert.throws(
    () => validateProviderResponse({
      request_id: "request-1",
      ok: false,
      error: {
        code: "raw.dbus.Error: secret.service",
        ambiguous: true,
      },
    }, "request-1"),
    (error) => {
      assert.equal(error.code, "service_status_unavailable");
      assert.equal(error.ambiguous, true);
      assert.doesNotMatch(error.message, /secret|dbus/i);
      return true;
    },
  );
});

function validResult() {
  return {
    load_state: "loaded",
    active_state: "active",
    sub_state: "running",
    unit_file_state_class: "enabled",
    can_restart: true,
    restart_policy_class: "allowed_with_confirmation",
    state_changed_at_bucket: "unknown",
    healthy: true,
    unit_definition_digest: "a".repeat(64),
    definition_digest_schema: "soma.systemd.effective-definition.v1",
    affected_closure: "target_only",
    closure_schema: "soma.systemd.affected-closure.v1",
    invocation_id: "b".repeat(32),
    activation_timestamp_monotonic: 123,
    dispatch_status: "not_dispatched",
  };
}

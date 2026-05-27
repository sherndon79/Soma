import assert from "node:assert/strict";
import test from "node:test";

import {
  REMOTE_GRAPHICAL_LIVE_BROKER_DEFAULT_BINARY,
} from "../src/remoteGraphicalLiveBrokerManager.js";
import {
  planRemoteGraphicalLiveBrokerManagerStartup,
} from "../src/remoteGraphicalLiveBrokerStartupPlan.js";
import {
  createRemoteGraphicalRuntime,
} from "../src/remoteGraphicalRuntime.js";

test("planRemoteGraphicalLiveBrokerManagerStartup refuses without runtime opt-in", () => {
  const plan = planRemoteGraphicalLiveBrokerManagerStartup();

  assert.equal(plan.eligible, false);
  assert.equal(plan.eligibility, "runtime_not_requested");
  assert.equal(plan.requested, false);
  assert.equal(plan.manager_constructed, false);
  assert.equal(plan.helper_started, false);
  assert.equal(plan.live_transport_used, false);
});

test("planRemoteGraphicalLiveBrokerManagerStartup requires configured manifest posture", () => {
  const plan = planRemoteGraphicalLiveBrokerManagerStartup({
    posture: {
      requested: true,
      configured: false,
      manifest_loaded: false,
    },
  });

  assert.equal(plan.eligible, false);
  assert.equal(plan.eligibility, "manifest_not_configured");
  assert.equal(plan.requested, true);
  assert.equal(plan.configured, false);
});

test("planRemoteGraphicalLiveBrokerManagerStartup requires manifest identity", () => {
  const plan = planRemoteGraphicalLiveBrokerManagerStartup({
    posture: {
      requested: true,
      configured: true,
      manifest_loaded: true,
      provider: "soma.provider.remote_desktop.sunshine",
    },
  });

  assert.equal(plan.eligible, false);
  assert.equal(plan.eligibility, "manifest_identity_incomplete");
});

test("planRemoteGraphicalLiveBrokerManagerStartup requires reviewed helper binary path", () => {
  const plan = planRemoteGraphicalLiveBrokerManagerStartup({
    posture: configuredPosture(),
    helperBinaryPath: "/tmp/operator-provided/moonlight-helper",
  });

  assert.equal(plan.eligible, false);
  assert.equal(plan.eligibility, "helper_binary_not_reviewed");
  assert.equal(plan.reviewed_helper_binary_path, false);
});

test("planRemoteGraphicalLiveBrokerManagerStartup marks default helper path eligible without construction", () => {
  const plan = planRemoteGraphicalLiveBrokerManagerStartup({
    posture: configuredPosture(),
  });

  assert.equal(plan.eligible, true);
  assert.equal(plan.eligibility, "eligible");
  assert.equal(plan.helper_binary_path, REMOTE_GRAPHICAL_LIVE_BROKER_DEFAULT_BINARY);
  assert.equal(plan.reviewed_helper_binary_path, true);
  assert.equal(plan.manager_constructed, false);
  assert.equal(plan.helper_started, false);
  assert.equal(plan.broker_called, false);
  assert.equal(plan.session_opened, false);
  assert.equal(plan.video_attached, false);
  assert.equal(plan.input_dispatched, false);
  assert.equal(plan.model_delivery, false);
  assert.equal(plan.live_transport_used, false);
});

test("createRemoteGraphicalRuntime remains on no-op broker path despite eligible startup plan", async () => {
  const events = [];
  const runtime = await createRemoteGraphicalRuntime({
    env: {
      SOMA_REMOTE_GRAPHICAL_ENABLED: "1",
      SOMA_REMOTE_GRAPHICAL_PROVIDER: "soma.provider.remote_desktop.sunshine",
    },
    async manifestLoader() {
      return {
        requested: true,
        configured: true,
        loaded: true,
        status: "provider_manifest_configured",
        provider: "soma.provider.remote_desktop.sunshine",
        target_host: "soma-agent-desktop.local.sthnet.org",
        locality: "lan",
        attended: true,
        manifest_source_kind: "repository_runtime_config",
        manifest_source: "config/remote-graphical-providers/soma.provider.remote_desktop.sunshine.json",
        summary: "Remote graphical provider manifest is configured; live broker activation remains disabled.",
      };
    },
    brokerFactory({ posture }) {
      events.push(["brokerFactory", posture]);
      return {
        describeActive() {
          return { runtimePosture: posture };
        },
      };
    },
  });

  const plan = planRemoteGraphicalLiveBrokerManagerStartup({ posture: runtime });
  assert.equal(plan.eligible, true);
  assert.equal(runtime.enabled, false);
  assert.equal(typeof runtime.broker.describeActive, "function");
  assert.deepEqual(events.map(([event]) => event), ["brokerFactory"]);
  await runtime.stop();
});

function configuredPosture() {
  return {
    requested: true,
    configured: true,
    manifest_loaded: true,
    provider: "soma.provider.remote_desktop.sunshine",
    target_host: "soma-agent-desktop.local.sthnet.org",
    manifest_source_kind: "repository_runtime_config",
  };
}

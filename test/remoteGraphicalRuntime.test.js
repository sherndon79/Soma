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
    async manifestLoader({ env }) {
      assert.equal(env.SOMA_REMOTE_GRAPHICAL_ENABLED, "1");
      return {
        requested: true,
        configured: false,
        loaded: false,
        status: "provider_id_required",
        summary: "Remote graphical runtime manifest loading requires SOMA_REMOTE_GRAPHICAL_PROVIDER.",
      };
    },
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
      provider: "",
      target_host: "",
      locality: "",
      attended: null,
      manifest_loaded: false,
      manifest_status: "provider_id_required",
      manifest_source_kind: "",
      manifest_source: "",
      summary: "Remote graphical runtime manifest loading requires SOMA_REMOTE_GRAPHICAL_PROVIDER.",
    },
  ]]);
});

test("createRemoteGraphicalRuntime carries configured manifest posture without enabling activation", async () => {
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
      return {
        describeActive() {
          return { runtimePosture: posture };
        },
      };
    },
  });

  assert.equal(runtime.requested, true);
  assert.equal(runtime.enabled, false);
  assert.equal(runtime.configured, true);
  assert.equal(runtime.provider, "soma.provider.remote_desktop.sunshine");
  assert.equal(runtime.target_host, "soma-agent-desktop.local.sthnet.org");
  assert.equal(runtime.manifest_loaded, true);
  assert.equal(runtime.manifest_status, "provider_manifest_configured");
  assert.equal(runtime.manifest_source_kind, "repository_runtime_config");
  await runtime.stop();
});

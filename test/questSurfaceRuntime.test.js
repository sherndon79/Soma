import assert from "node:assert/strict";
import test from "node:test";

import {
  createQuestSurfaceRuntime,
  isQuestSurfaceRuntimeEnabled,
} from "../src/questSurfaceRuntime.js";

test("quest surface runtime is explicit opt-in only", () => {
  assert.equal(isQuestSurfaceRuntimeEnabled({}), false);
  assert.equal(isQuestSurfaceRuntimeEnabled({ SOMA_QUEST_SURFACE_ENABLED: "0" }), false);
  assert.equal(isQuestSurfaceRuntimeEnabled({ SOMA_QUEST_SURFACE_ENABLED: "true" }), true);
  assert.equal(isQuestSurfaceRuntimeEnabled({ SOMA_QUEST_SURFACE_ENABLED: "YES" }), true);
});

test("quest surface runtime does not read TLS files or construct a provider when disabled", async () => {
  let readCalled = false;
  let providerConstructed = false;
  const runtime = await createQuestSurfaceRuntime({
    env: {},
    async readFileImpl() {
      readCalled = true;
    },
    providerFactory() {
      providerConstructed = true;
    },
  });

  assert.equal(runtime.enabled, false);
  assert.equal(runtime.provider, null);
  assert.equal(readCalled, false);
  assert.equal(providerConstructed, false);
  await runtime.stop();
});

test("quest surface runtime fails closed on incomplete opt-in configuration", async () => {
  await assert.rejects(
    () => createQuestSurfaceRuntime({ env: { SOMA_QUEST_SURFACE_ENABLED: "1" } }),
    (error) => error.code === "quest_surface_configuration_incomplete",
  );
});

test("quest surface runtime reads external TLS files and starts the fixture without creating authority", async () => {
  const events = [];
  const provider = {
    async start(options) {
      events.push(["start", options]);
      return { address: "127.0.0.1", family: "IPv4", port: 48793 };
    },
    async stop() {
      events.push(["stop"]);
    },
  };
  const runtime = await createQuestSurfaceRuntime({
    env: {
      SOMA_QUEST_SURFACE_ENABLED: "1",
      SOMA_QUEST_SURFACE_TLS_KEY: "/run/quest/server.key",
      SOMA_QUEST_SURFACE_TLS_CERT: "/run/quest/server.pem",
      SOMA_QUEST_SURFACE_CLIENT_CA: "/run/quest/ca.pem",
      SOMA_QUEST_SURFACE_GRANT_ID: "grant-quest-v1a",
      SOMA_QUEST_SURFACE_HOST: "192.168.50.1",
      SOMA_QUEST_SURFACE_PORT: "8793",
      SOMA_QUEST_SURFACE_LEASE_TTL_MS: "45000",
      SOMA_QUEST_SURFACE_PANEL_TEXT: "HELLO QUEST",
    },
    async readFileImpl(path) {
      events.push(["read", path]);
      return Buffer.from(path);
    },
    providerFactory(options) {
      events.push(["provider", {
        grant_id: options.grantId,
        lease_ttl_ms: options.leaseTtlMs,
        panel_text: options.panel.text,
        key_loaded: Boolean(options.tlsOptions.key),
        cert_loaded: Boolean(options.tlsOptions.cert),
        ca_loaded: Boolean(options.tlsOptions.ca),
      }]);
      return provider;
    },
    logger: { info(message) { events.push(["info", message]); } },
  });

  assert.equal(runtime.enabled, true);
  assert.equal(runtime.grant_id, "grant-quest-v1a");
  assert.equal(runtime.port, 48793);
  assert.deepEqual(events.slice(0, 5), [
    ["read", "/run/quest/server.key"],
    ["read", "/run/quest/server.pem"],
    ["read", "/run/quest/ca.pem"],
    ["provider", {
      grant_id: "grant-quest-v1a",
      lease_ttl_ms: 45000,
      panel_text: "HELLO QUEST",
      key_loaded: true,
      cert_loaded: true,
      ca_loaded: true,
    }],
    ["start", { host: "192.168.50.1", port: 8793 }],
  ]);
  await runtime.stop();
  assert.deepEqual(events.at(-1), ["stop"]);
});

test("quest surface runtime surfaces unreadable external TLS material without logging secrets", async () => {
  await assert.rejects(
    () => createQuestSurfaceRuntime({
      env: {
        SOMA_QUEST_SURFACE_ENABLED: "1",
        SOMA_QUEST_SURFACE_TLS_KEY: "/missing/key",
        SOMA_QUEST_SURFACE_TLS_CERT: "/missing/cert",
        SOMA_QUEST_SURFACE_CLIENT_CA: "/missing/ca",
        SOMA_QUEST_SURFACE_GRANT_ID: "grant-quest-v1a",
      },
      async readFileImpl() {
        throw new Error("secret-bearing raw read failure");
      },
    }),
    (error) => {
      assert.equal(error.code, "quest_surface_tls_read_failed");
      assert.doesNotMatch(error.message, /secret-bearing/);
      return true;
    },
  );
});

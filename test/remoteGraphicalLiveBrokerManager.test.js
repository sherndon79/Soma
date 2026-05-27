import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  RemoteGraphicalLiveBrokerManager,
  REMOTE_GRAPHICAL_LIVE_BROKER_DEFAULT_BINARY,
} from "../src/remoteGraphicalLiveBrokerManager.js";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HELPER_BINARY = path.join(REPO_ROOT, "target", "debug", "soma-moonlight-broker");
const HELPER_SKIP_REASON = existsSync(HELPER_BINARY)
  ? false
  : "binary not built; run 'cargo build -p soma-moonlight-broker' from repo root";

test("RemoteGraphicalLiveBrokerManager send before start rejects with a clear error", async () => {
  const manager = new RemoteGraphicalLiveBrokerManager();
  await assert.rejects(
    () => manager.status(),
    /not started/,
  );
});

test("RemoteGraphicalLiveBrokerManager start with a missing binary rejects", async () => {
  const manager = new RemoteGraphicalLiveBrokerManager({
    binaryPath: "/nonexistent/path/to/soma-moonlight-broker",
  });
  await assert.rejects(() => manager.start());
});

test("RemoteGraphicalLiveBrokerManager exports the default binary path", () => {
  assert.ok(
    REMOTE_GRAPHICAL_LIVE_BROKER_DEFAULT_BINARY.endsWith("/target/debug/soma-moonlight-broker"),
    `expected default path to end with target/debug/soma-moonlight-broker, got ${REMOTE_GRAPHICAL_LIVE_BROKER_DEFAULT_BINARY}`,
  );
});

test(
  "RemoteGraphicalLiveBrokerManager starts helper and returns implementation-pending status",
  { skip: HELPER_SKIP_REASON },
  async () => {
    const manager = new RemoteGraphicalLiveBrokerManager();
    const info = await manager.start();
    assert.ok(Number.isInteger(info.pid), "expected a numeric pid");
    try {
      await assert.rejects(
        () => manager.status({
          provider: "soma.provider.remote_desktop.sunshine",
          target_host: "soma-agent-desktop.local.sthnet.org",
        }),
        (error) => {
          assert.equal(error.code, -32001);
          assert.equal(error.code_name, "method_implementation_pending");
          assert.match(error.message, /remote_graphical\.status recognized/);
          return true;
        },
      );
    } finally {
      await manager.stop();
    }
  },
);

test(
  "RemoteGraphicalLiveBrokerManager maps all live methods to implementation-pending errors",
  { skip: HELPER_SKIP_REASON },
  async () => {
    const manager = new RemoteGraphicalLiveBrokerManager();
    await manager.start();
    try {
      for (const call of [
        () => manager.status(),
        () => manager.openSession({}),
        () => manager.describeActive(),
        () => manager.cleanupForGrant({ grant_id: "grant-1" }),
      ]) {
        await assert.rejects(call, (error) => {
          assert.equal(error.code, -32001);
          assert.equal(error.code_name, "method_implementation_pending");
          return true;
        });
      }
    } finally {
      await manager.stop();
    }
  },
);

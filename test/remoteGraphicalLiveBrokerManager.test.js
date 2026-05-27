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

test("RemoteGraphicalLiveBrokerManager validates synthetic successful helper results", async () => {
  const manager = new SyntheticResultManager({
    "remote_graphical.status": {
      provider: "soma.provider.remote_desktop.sunshine",
      target_host: "soma-agent-desktop.local.sthnet.org",
      configured: true,
    },
    "remote_graphical.describe_active": {
      provider: "soma.provider.remote_desktop.sunshine",
      target_host: "soma-agent-desktop.local.sthnet.org",
      sessions: [{
        session_id: "live-session-1",
        source_grant_id: "grant-remote-video",
      }],
    },
    "remote_graphical.cleanup_for_grant": {
      source_grant_id: "grant-remote-video",
      stopped_session_ids: ["live-session-1"],
    },
  });

  const status = await manager.status();
  assert.equal(status.schema_matches_expected, true);
  assert.equal(status.status, "provider_configured");
  assert.equal(status.session_opened, false);

  const active = await manager.describeActive();
  assert.equal(active.active_count, 1);
  assert.equal(active.sessions[0].state, "open_observe_inactive");
  assert.equal(active.sessions[0].video_attached, false);

  const cleanup = await manager.cleanupForGrant({ grant_id: "grant-remote-video" });
  assert.equal(cleanup.status, "cleanup_completed");
  assert.equal(cleanup.stopped_count, 1);
  assert.equal(cleanup.video_attached, false);
});

test("RemoteGraphicalLiveBrokerManager rejects over-disclosing synthetic helper results", async () => {
  const manager = new SyntheticResultManager({
    "remote_graphical.status": {
      provider: "soma.provider.remote_desktop.sunshine",
      target_host: "soma-agent-desktop.local.sthnet.org",
      configured: true,
      screenshot_bytes: "not allowed",
    },
    "remote_graphical.describe_active": {
      sessions: [{
        session_id: "live-session-1",
        source_grant_id: "grant-remote-video",
        provider: "soma.provider.remote_desktop.sunshine",
        target_host: "soma-agent-desktop.local.sthnet.org",
        clipboard_text: "not allowed",
      }],
    },
    "remote_graphical.cleanup_for_grant": {
      source_grant_id: "grant-remote-video",
      stderr: "not allowed",
    },
  });

  await assert.rejects(
    () => manager.status(),
    { code: "remote_graphical_live_status_forbidden_field" },
  );
  await assert.rejects(
    () => manager.describeActive(),
    { code: "remote_graphical_live_active_sessions_forbidden_field" },
  );
  await assert.rejects(
    () => manager.cleanupForGrant(),
    { code: "remote_graphical_live_cleanup_result_forbidden_field" },
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

class SyntheticResultManager extends RemoteGraphicalLiveBrokerManager {
  #results;

  constructor(results) {
    super({ binaryPath: "/not/used/by/synthetic-manager" });
    this.#results = results;
  }

  send(method) {
    if (!Object.hasOwn(this.#results, method)) {
      return Promise.reject(new Error(`No synthetic result for ${method}`));
    }
    return Promise.resolve(this.#results[method]);
  }
}

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

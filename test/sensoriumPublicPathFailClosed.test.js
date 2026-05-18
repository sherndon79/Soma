// Step-8 fail-closed verification for the Sensorium integration.
//
// Steps 1-7 each verified one layer of the fail-closed property:
//
//   step 1   catalog entries have default_status = "disabled"
//   step 2   provider claim does not flip harness_status
//   step 3   validator rejects malformed requests
//   step 4   validator rejects cross-capability and overreach payloads
//   step 5   provenance shape records consumption, not content
//   step 6   disclosure shape never leaks frame content
//   step 7   sensor-broker helper returns implementation_pending for
//            every method
//
// This test file walks the *public path* end-to-end and asserts the
// composite fail-closed property explicitly, so a future regression
// that accidentally activates any one of these layers gets caught
// here with a clear message identifying which layer broke.
//
// The test is a tripwire. It will only "pass" while no Sensorium
// subscription can actually flow; activation (step 9) will require
// updating these assertions in lockstep with whatever layer it
// touches.

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SensorBrokerManager } from "../src/sensorBroker.js";
import {
  buildCapabilityView,
  loadCapabilityCatalog,
  loadProviderRegistry,
} from "../src/capabilityCatalog.js";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const SENSORIUM_KEYS = [
  "perception.sensorium.color.subscribe",
  "perception.sensorium.depth.subscribe",
  "perception.sensorium.imu.subscribe",
  "perception.sensorium.location.subscribe",
  "perception.sensorium.status.subscribe",
];

const SENSORIUM_HELPER_METHODS = [
  "sensorium.subscribe.start",
  "sensorium.subscribe.stop",
  "sensorium.subscribe.status",
];

// ── Layer 1 + 2: catalog + provider registry ───────────────────────────────

test("public path fail-closed: capability view reports all Sensorium entries as disabled+requestable", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();
  const view = buildCapabilityView({ catalog, providerRegistry });

  for (const key of SENSORIUM_KEYS) {
    const cap = view.capabilities.find((c) => c.key === key);
    assert.ok(cap, `expected ${key} in capability view`);
    assert.equal(
      cap.harness_status,
      "disabled",
      `${key} harness_status flipped — fail-closed broken at the catalog/grant layer`,
    );
    assert.notEqual(
      cap.status,
      "active",
      `${key} status went active — fail-closed broken at the catalog/grant layer`,
    );
  }
});

// ── Grants layer ────────────────────────────────────────────────────────────

test("public path fail-closed: no active grant authorizes any Sensorium capability", () => {
  const grantsPath = path.join(REPO_ROOT, "config", "grants.json");
  const raw = readFileSync(grantsPath, "utf8");
  const config = JSON.parse(raw);

  const offending = (config.grants ?? []).filter(
    (grant) =>
      grant.status === "active" && SENSORIUM_KEYS.includes(grant.capability),
  );

  assert.equal(
    offending.length,
    0,
    `found ${offending.length} active grant(s) for Sensorium capabilities: ${offending
      .map((g) => `${g.id} → ${g.capability}`)
      .join(", ")} — fail-closed broken at the grant store`,
  );
});

// ── Helper layer ───────────────────────────────────────────────────────────

const HELPER_BINARY = path.join(
  REPO_ROOT,
  "target",
  "debug",
  "soma-sensor-broker",
);

const HELPER_SKIP_REASON = existsSync(HELPER_BINARY)
  ? false
  : `binary not built; run 'cargo build -p soma-sensor-broker' from repo root`;

const ZENOH_TEST_CONFIG = path.join(
  mkdtempSync(path.join(os.tmpdir(), "soma-sensorium-public-path-test-")),
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

// As of step 9b, the helper is fully activated:
//   subscribe.start   → opens a Zenoh subscriber, returns subscription_id
//   subscribe.stop    → looks up by subscription_id, aborts, removes
//   subscribe.status  → reports active subscriptions (list or by id)
//
// The PUBLIC path stays fail-closed at the Node layers (no grant, no
// HTTP route mentions Sensorium), which is still verified by the
// other tests in this file. The helper-layer assertion is therefore
// no longer about "everything errors" — it's about the lifecycle
// being well-formed end to end.

test(
  "public path fail-closed: helper full lifecycle works while public path stays closed (step 9b)",
  { skip: HELPER_SKIP_REASON },
  async () => {
    // Drive the helper through start → status → stop → status. All
    // four operations should succeed. This proves the helper is the
    // right shape to plug into a future Node-side manager, while the
    // OTHER tripwire tests (catalog/view, grants, public-route grep)
    // continue to assert the public path is fail-closed.
    const mgr = new SensorBrokerManager();
    await mgr.start();
    try {
      const startResp = await mgr.send("sensorium.subscribe.start", {
        topic: "sensor/fail-closed-test/status",
        zenoh_config_path: ZENOH_TEST_CONFIG,
      });
      const subscriptionId = startResp.subscription_id;
      assert.ok(
        typeof subscriptionId === "string" && subscriptionId.length > 0,
        "subscription_id should be a non-empty string",
      );

      const statusResp = await mgr.send("sensorium.subscribe.status");
      assert.equal(
        statusResp.count,
        1,
        "status should report exactly one active subscription",
      );
      assert.equal(
        statusResp.subscriptions[0].subscription_id,
        subscriptionId,
      );

      const stopResp = await mgr.send("sensorium.subscribe.stop", {
        subscription_id: subscriptionId,
      });
      assert.equal(stopResp.stopped, true);

      const finalStatus = await mgr.send("sensorium.subscribe.status");
      assert.equal(finalStatus.count, 0);

      // Verify subscription_not_found is the right error class: the
      // helper distinguishes "no such subscription" from "malformed
      // request" and "method not found."
      await assert.rejects(
        () =>
          mgr.send("sensorium.subscribe.stop", {
            subscription_id: "definitely-not-a-real-id",
          }),
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

// ── Public HTTP surface (step 9e: activation crossed into routes) ─────────
//
// Step 9e activated the HTTP route. The earlier "no public route
// mentions Sensorium" assertion is intentionally retired: the route
// now exists, by design. The fail-closed property at the public layer
// has shifted from "no route" to "the route refuses without a grant."
//
// The route-existence positive check below is the new proxy: it
// confirms the routing block is in place, which is what the activation
// slice was supposed to add. A runtime fail-closed check
// (POST returns 403 with no grant) lives in test/app.test.js where
// the app construction harness already exists.

test("public path fail-closed: app.js now contains the activated /sensorium/subscriptions route", () => {
  const appPath = path.join(REPO_ROOT, "src", "app.js");
  const content = readFileSync(appPath, "utf8");
  assert.ok(
    content.includes("/sensorium/subscriptions"),
    "expected app.js to contain the /sensorium/subscriptions route after step 9e activation",
  );
  assert.ok(
    content.includes("sensorium_subscription_no_grant"),
    "expected app.js to surface the sensorium_subscription_no_grant error code (fail-closed-without-grant)",
  );
});

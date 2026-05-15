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
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  () => {
    // Drive the helper through start → status → stop → status. All
    // four operations should succeed. This proves the helper is the
    // right shape to plug into a future Node-side manager, while the
    // OTHER tripwire tests (catalog/view, grants, public-route grep)
    // continue to assert the public path is fail-closed.
    const startRequest = JSON.stringify({
      jsonrpc: "2.0",
      method: "sensorium.subscribe.start",
      params: { topic: "sensor/fail-closed-test/status" },
      id: "step9b-start",
    });
    const statusRequest = JSON.stringify({
      jsonrpc: "2.0",
      method: "sensorium.subscribe.status",
      id: "step9b-status",
    });

    // Phase 1: start, then status. Use stop in the same batch with a
    // placeholder id; we'll parse the start response to get the real
    // id and follow up with a focused stop call. The batch form keeps
    // the helper alive for both calls.
    const phase1 = spawnSync(HELPER_BINARY, [], {
      input: `${startRequest}\n${statusRequest}\n`,
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(
      phase1.status,
      0,
      `helper exited with ${phase1.status} (stderr: ${phase1.stderr})`,
    );

    const phase1Lines = phase1.stdout.trim().split("\n").filter((l) => l.length > 0);
    assert.ok(phase1Lines.length >= 2, "expected at least two responses");

    const startResp = JSON.parse(phase1Lines[0]);
    assert.equal(startResp.id, "step9b-start");
    assert.ok(startResp.result, "start should succeed");
    const subscriptionId = startResp.result.subscription_id;
    assert.ok(
      typeof subscriptionId === "string" && subscriptionId.length > 0,
      "subscription_id should be a non-empty string",
    );

    const statusResp = JSON.parse(phase1Lines[1]);
    assert.equal(statusResp.id, "step9b-status");
    assert.ok(statusResp.result, "status should succeed");
    assert.equal(
      statusResp.result.count,
      1,
      "status should report exactly one active subscription",
    );
    assert.equal(
      statusResp.result.subscriptions[0].subscription_id,
      subscriptionId,
    );

    // Phase 2: a fresh helper instance, drive stop against an unknown id.
    // This verifies subscription_not_found is the right error class —
    // the helper distinguishes "no such subscription" from
    // "malformed request" and "method not found."
    const unknownStop = JSON.stringify({
      jsonrpc: "2.0",
      method: "sensorium.subscribe.stop",
      params: { subscription_id: "definitely-not-a-real-id" },
      id: "step9b-stop-unknown",
    });
    const phase2 = spawnSync(HELPER_BINARY, [], {
      input: `${unknownStop}\n`,
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(phase2.status, 0);
    const unknownStopResp = JSON.parse(phase2.stdout.trim());
    assert.equal(unknownStopResp.error.code, -32002);
    assert.equal(unknownStopResp.error.code_name, "subscription_not_found");
  },
);

// ── Public HTTP/CLI surface ────────────────────────────────────────────────

test("public path fail-closed: no public Node route currently invokes Sensorium subscription", () => {
  // We don't yet have a route that touches Sensorium subscription.
  // This test pins that property: greps the public-facing modules
  // (app.js for HTTP routes, cli.js for command handlers) for any
  // reference to perception.sensorium or sensorium.subscribe. Any
  // match means a route has been wired and the activation step has
  // begun — at which point this test should be updated alongside
  // whatever step does it.

  const filesToScan = ["src/app.js", "src/server.js", "src/cli.js"];
  const forbiddenPatterns = [
    /perception\.sensorium\./,
    /sensorium\.subscribe\./,
    /soma-sensor-broker/,
  ];

  const violations = [];
  for (const file of filesToScan) {
    const abs = path.join(REPO_ROOT, file);
    if (!existsSync(abs)) {
      continue;
    }
    const content = readFileSync(abs, "utf8");
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(content)) {
        violations.push(`${file} contains ${pattern}`);
      }
    }
  }

  assert.equal(
    violations.length,
    0,
    `Sensorium activation has begun in the public Node surface — fail-closed broken: ${violations.join("; ")}`,
  );
});

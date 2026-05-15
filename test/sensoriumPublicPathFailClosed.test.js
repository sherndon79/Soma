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

test(
  "public path fail-closed: sensor-broker helper returns method_implementation_pending for every known method",
  { skip: HELPER_SKIP_REASON },
  () => {
    for (const method of SENSORIUM_HELPER_METHODS) {
      const request = JSON.stringify({
        jsonrpc: "2.0",
        method,
        params: {},
        id: `fail-closed-test-${method}`,
      });
      const result = spawnSync(HELPER_BINARY, [], {
        input: `${request}\n`,
        encoding: "utf8",
        timeout: 5000,
      });
      assert.equal(
        result.status,
        0,
        `helper exited with ${result.status} for method ${method} (stderr: ${result.stderr})`,
      );

      const response = JSON.parse(result.stdout.trim());

      assert.equal(response.jsonrpc, "2.0", `${method}: bad jsonrpc version`);
      assert.equal(response.id, `fail-closed-test-${method}`, `${method}: id not echoed`);
      assert.ok(
        response.error,
        `${method}: response missing error field — helper may have been activated`,
      );
      assert.equal(
        response.error.code,
        -32001,
        `${method}: error code is ${response.error.code}; expected -32001 (method_implementation_pending)`,
      );
      assert.equal(response.error.code_name, "method_implementation_pending");
      assert.equal(
        "result" in response,
        false,
        `${method}: response contains a result field — fail-closed broken at the helper`,
      );
    }
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

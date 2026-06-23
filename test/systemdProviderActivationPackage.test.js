import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";

import {
  createSystemdProviderSocketAdapter,
  createSystemdProviderSocketClient,
} from "../src/hostServiceSystemdProvider.js";

test("operational socket client is disabled without opening a connection", async () => {
  let connections = 0;
  const client = createSystemdProviderSocketClient({
    connectFn() {
      connections += 1;
      throw new Error("must not connect");
    },
  });
  await assert.rejects(
    client.request({ method: "status_read", inventory_id: "lab" }),
    { code: "service_status_unavailable" },
  );
  assert.equal(connections, 0);
});

test("operational socket client exchanges one bounded typed request when explicitly enabled", async () => {
  const directory = await mkdtemp(join(tmpdir(), "soma-provider-socket-"));
  const socketPath = join(directory, "provider.sock");
  const server = createServer((socket) => {
    socket.once("data", (data) => {
      const request = JSON.parse(String(data).trim());
      socket.end(`${JSON.stringify({
        request_id: request.request_id,
        ok: true,
        result: {
          load_state: "loaded",
          active_state: "active",
          sub_state: "running",
          unit_file_state_class: "enabled",
          can_restart: true,
          restart_policy_class: "no",
          state_changed_at_bucket: "recent",
          healthy: true,
          unit_definition_digest: "a".repeat(64),
          definition_digest_schema: "soma.systemd.effective-definition.v1",
          affected_closure: "target_only",
          closure_schema: "soma.systemd.affected-closure.v1",
          invocation_id: "b".repeat(32),
          activation_timestamp_monotonic: 1,
          dispatch_status: "not_requested",
        },
      })}\n`);
    });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    const client = createSystemdProviderSocketClient({ socketPath, enabled: true });
    const result = await client.request({ method: "status_read", inventory_id: "lab" });
    assert.equal(result.active_state, "active");
    client.stop();
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("attended-host socket adapter uses the production channel and counts one restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "soma-provider-adapter-"));
  const socketPath = join(directory, "provider.sock");
  const server = createServer((socket) => {
    socket.on("data", (data) => {
      for (const line of String(data).trim().split("\n")) {
        const request = JSON.parse(line);
        socket.write(`${JSON.stringify({
          request_id: request.request_id,
          ok: true,
          result: {
            load_state: "loaded",
            active_state: "active",
            sub_state: "running",
            unit_file_state_class: "enabled",
            can_restart: true,
            restart_policy_class: "no",
            state_changed_at_bucket: "recent",
            healthy: true,
            unit_definition_digest: "a".repeat(64),
            definition_digest_schema: "soma.systemd.effective-definition.v1",
            affected_closure: "target_only",
            closure_schema: "soma.systemd.affected-closure.v1",
            invocation_id: "b".repeat(32),
            activation_timestamp_monotonic: 1,
            dispatch_status: request.method === "restart_apply" ? "dispatched" : "not_requested",
          },
        })}\n`);
      }
    });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    const adapter = createSystemdProviderSocketAdapter({ socketPath, enabled: true });
    const descriptor = {
      descriptor_digest: "descriptor",
      unit_inventory_id: "lab",
    };
    assert.equal((await adapter.inspectForPlan(descriptor)).active_state, "active");
    await adapter.restart(descriptor);
    assert.equal(adapter.restartCallCount(), 1);
    adapter.stop();
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("attended confirmation-only mode exits before receipt or restart runtime creation", async () => {
  const source = await readFile("scripts/systemd-provider-attended-host.mjs", "utf8");
  const confirmationOnly = source.indexOf("SOMA_SYSTEMD_ATTENDED_CONFIRM_ONLY");
  const confirmationAuthority = source.indexOf("createLocalConfirmationAuthority({", confirmationOnly);
  const restartRuntime = source.indexOf("createAsyncHostServiceRestartRuntime({", confirmationOnly);
  assert.ok(confirmationOnly > 0);
  assert.ok(confirmationAuthority > confirmationOnly);
  assert.ok(restartRuntime > confirmationOnly);
  assert.match(
    source.slice(confirmationOnly, confirmationAuthority),
    /outcome:\s*"confirmation_verified"[\s\S]*restart_dispatched:\s*false[\s\S]*else \{/,
  );
});

test("attended dispatch requires deterministic reviewed plan bindings", async () => {
  const source = await readFile("scripts/systemd-provider-attended-host.mjs", "utf8");
  for (const marker of [
    "SOMA_SYSTEMD_ATTENDED_RUN_ID",
    "SOMA_SYSTEMD_PLAN_CREATED_AT_MS",
    "SOMA_SYSTEMD_EXPECTED_PLAN_DIGEST",
    "live plan does not match the reviewed plan digest",
    "random: () => runId",
    "now: () => planCreatedAt",
  ]) {
    assert.ok(source.includes(marker), `missing attended binding: ${marker}`);
  }
});

test("attended host runbook preserves ordered isolation and rollback gates", async () => {
  const runbook = await readFile(
    "docs/runbooks/systemd-provider-exact-host-activation.md",
    "utf8",
  );
  const orderedMarkers = [
    "## Emergency Off",
    "## Gate 0: Preconditions",
    "## Gate 1: Install Inert Packages",
    "## Gate 2: Provider Read-Only Preflight",
    "## Gate 3: Stage Exact Provider Authority",
    "## Gate 4: Install Udev Isolation",
    "## Gate 5: Two-Touch Enrollment",
    "## Gate 6: Install Enrollment And Prove OTP Isolation",
    "## Gate 7: Preview With All Restart Authority Off",
    "## Gate 8: One Attended Restart",
    "## Final Rollback",
  ];
  let previous = -1;
  for (const marker of orderedMarkers) {
    const index = runbook.indexOf(marker);
    assert.ok(index > previous, `runbook marker out of order: ${marker}`);
    previous = index;
  }
  for (const invariant of [
    "ID_USB_INTERFACE_NUM=01",
    "ID_USB_INTERFACE_NUM=00",
    "scripts/lca-hardware-isolation-drill.sh",
    "SOMA_SYSTEMD_ATTENDED_CONFIRM_ONLY=1",
    "SOMA_SYSTEMD_EXPECTED_PLAN_DIGEST",
    "cmp -s \"$STAGE/otp-canary-before.txt\" \"$STAGE/otp-canary-after.txt\"",
    "signature counter advances on every successful touch",
    "controlled_testing != .attended_host_activation",
    "systemctl stop soma-local-confirmation-issuer.service",
    "restart_dispatched == false",
  ]) {
    assert.ok(runbook.includes(invariant), `runbook missing invariant: ${invariant}`);
  }
});

test("polkit generator emits one exact restart grant and creates no host artifact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "soma-polkit-"));
  const output = join(directory, "00-soma-systemd-provider.rules");
  try {
    const generated = spawnSync(
      process.execPath,
      ["scripts/generate-systemd-provider-polkit.mjs", "soma-lab-proof.service", output],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(generated.status, 0, generated.stderr);
    const rule = await readFile(output, "utf8");
    assert.match(rule, /unit === "soma-lab-proof\.service"/);
    assert.match(rule, /verb === "restart"/);
    assert.match(rule, /return polkit\.Result\.NO/);
    assert.doesNotMatch(rule, /@@/);
    assert.equal((await stat(output)).mode & 0o777, 0o600);

    const invalid = spawnSync(
      process.execPath,
      ["scripts/generate-systemd-provider-polkit.mjs", "not-a-service"],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(invalid.status, 64);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("inert package validator proves disabled defaults and hardening surface", () => {
  const validation = spawnSync(
    process.execPath,
    ["scripts/validate-systemd-provider-package.mjs"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(validation.status, 0, validation.stderr);
  assert.match(validation.stdout, /PASS/);
});

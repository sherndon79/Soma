import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";

import { createSystemdProviderSocketClient } from "../src/hostServiceSystemdProvider.js";

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

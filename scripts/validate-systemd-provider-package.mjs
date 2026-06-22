#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const service = await read("packaging/systemd/soma-systemd-provider.service");
const socket = await read("packaging/systemd/soma-systemd-provider.socket");
const tmpfiles = await read("packaging/tmpfiles/soma-systemd-provider.conf");
const template = await read("packaging/polkit/00-soma-systemd-provider.rules.in");
const manifest = JSON.parse(await read("packaging/systemd-provider-manifest.json"));
const inventory = JSON.parse(await read("config/systemd-provider-inventory.json"));
const registry = JSON.parse(await read("config/provider-registry.json"));

for (const directive of [
  "User=soma-systemd-provider",
  "Group=soma-systemd-provider",
  "NoNewPrivileges=yes",
  "CapabilityBoundingSet=",
  "AmbientCapabilities=",
  "ProtectSystem=strict",
  "ProtectHome=yes",
  "PrivateTmp=yes",
  "PrivateDevices=yes",
  "PrivateNetwork=yes",
  "RestrictAddressFamilies=AF_UNIX",
  "IPAddressDeny=any",
  "ProtectKernelTunables=yes",
  "ProtectKernelModules=yes",
  "ProtectKernelLogs=yes",
  "ProtectControlGroups=yes",
  "ProtectHostname=yes",
  "ProtectClock=yes",
  "RestrictNamespaces=yes",
  "RestrictSUIDSGID=yes",
  "RestrictRealtime=yes",
  "LockPersonality=yes",
  "MemoryDenyWriteExecute=yes",
  "SystemCallArchitectures=native",
  "SystemCallFilter=@system-service",
  "ProcSubset=pid",
  "ProtectProc=invisible",
  "DevicePolicy=closed",
  "RemoveIPC=yes",
  "ReadOnlyPaths=/run/dbus/system_bus_socket",
]) {
  assert.ok(service.includes(directive), `missing hardening directive: ${directive}`);
}
assert.ok(!service.includes("PrivateUsers="), "PrivateUsers must remain omitted for stable polkit identity");
assert.doesNotMatch(service, /^\[Install\]$/m, "service must not be install-enabled");
assert.doesNotMatch(socket, /^\[Install\]$/m, "socket must not be install-enabled");
assert.match(socket, /SocketGroup=soma-harness/);
assert.match(socket, /SocketMode=0660/);
assert.match(socket, /Requires=systemd-tmpfiles-setup\.service/);
assert.match(socket, /After=systemd-tmpfiles-setup\.service/);
assert.match(socket, /ConditionPathIsDirectory=\/run\/soma/);
assert.equal(tmpfiles.trim(), "d /run/soma 0750 root soma-harness -");
assert.match(template, /subject\.user !== "soma-systemd-provider"/);
assert.match(template, /verb === "restart"/);
assert.match(template, /return polkit\.Result\.NO/);
assert.equal(manifest.activation_status, "disabled");
const inventoryArtifact = manifest.artifacts.find(
  (artifact) => artifact.destination === "/etc/soma/systemd-provider-inventory.json",
);
assert.deepEqual(
  {
    mode: inventoryArtifact?.mode,
    owner: inventoryArtifact?.owner,
    group: inventoryArtifact?.group,
  },
  { mode: "0640", owner: "root", group: "soma-systemd-provider" },
);
const tmpfilesArtifact = manifest.artifacts.find(
  (artifact) => artifact.destination === "/usr/lib/tmpfiles.d/soma-systemd-provider.conf",
);
assert.deepEqual(
  {
    mode: tmpfilesArtifact?.mode,
    owner: tmpfilesArtifact?.owner,
    group: tmpfilesArtifact?.group,
  },
  { mode: "0644", owner: "root", group: "root" },
);
const channelArtifact = manifest.generated_artifacts.find(
  (artifact) => artifact.destination === "/etc/soma/systemd-provider-channel.conf",
);
assert.deepEqual(
  {
    mode: channelArtifact?.mode,
    owner: channelArtifact?.owner,
    group: channelArtifact?.group,
  },
  { mode: "0600", owner: "root", group: "root" },
);
for (const field of [
  "creates_identities",
  "installs_artifacts",
  "starts_units",
  "enables_route",
  "populates_inventory",
]) {
  assert.equal(manifest[field], false, `${field} must remain false`);
}
assert.equal(inventory.activation_status, "disabled");
assert.equal(inventory.restart_enabled, false);
assert.equal(inventory.controlled_testing, false);
assert.equal(inventory.attended_host_activation, false);
assert.deepEqual(inventory.units, []);
const operational = registry.providers.find((provider) => provider.id === "soma.provider.systemd-local");
assert.equal(operational?.activation_status, "disabled");

const systemdAnalyze = spawnSync("systemd-analyze", ["--version"], { encoding: "utf8" });
if (systemdAnalyze.status === 0) {
  const directory = await mkdtemp(join(tmpdir(), "soma-systemd-units-"));
  try {
    const servicePath = join(directory, "soma-systemd-provider.service");
    const socketPath = join(directory, "soma-systemd-provider.socket");
    const verifiableService = service
      .replace(
        "ExecStart=/usr/libexec/soma/soma-systemd-provider --socket-activated",
        "ExecStart=/bin/true",
      )
      .replace(
        "EnvironmentFile=/etc/soma/systemd-provider-channel.conf",
        "EnvironmentFile=-/dev/null",
      );
    await writeFile(servicePath, verifiableService);
    await writeFile(socketPath, socket);
    const verify = spawnSync("systemd-analyze", ["verify", socketPath, servicePath], {
      encoding: "utf8",
    });
    assert.equal(verify.status, 0, verify.stderr);
    const security = spawnSync(
      "systemd-analyze",
      ["security", "--offline=yes", servicePath],
      { encoding: "utf8" },
    );
    assert.equal(security.status, 0, security.stderr);
    assert.match(security.stdout, /Overall exposure level/);
    const exposure = security.stdout.match(/Overall exposure level[^:]*:\s*([0-9.]+)/);
    assert.ok(exposure, "systemd-analyze security did not report an exposure score");
    assert.ok(Number(exposure[1]) <= 1.0, `systemd unit exposure score is too high: ${exposure[1]}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

console.log("systemd provider inert package validation: PASS");

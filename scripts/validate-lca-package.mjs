#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const earlyRule = await read("packaging/udev/71-soma-lca-fido-isolation.rules");
const finalRule = await read("packaging/udev/99-soma-lca-fido-isolation.rules");
const service = await read("packaging/systemd/soma-local-confirmation-issuer.service");
const socket = await read("packaging/systemd/soma-local-confirmation-issuer.socket");
const tmpfiles = await read("packaging/tmpfiles/soma-local-confirmation-issuer.conf");
const deviceDropIn = await read("packaging/systemd/soma-local-confirmation-issuer-device.conf.in");
const manifest = JSON.parse(await read("packaging/lca-manifest.json"));

for (const rule of [earlyRule, finalRule]) {
  assert.match(rule, /SUBSYSTEM=="hidraw"/);
  assert.match(rule, /ENV\{ID_FIDO_TOKEN\}=="1"/);
  assert.match(rule, /ENV\{ID_VENDOR_ID\}=="1050"/);
  assert.match(rule, /ENV\{ID_MODEL_ID\}=="0407"/);
  assert.match(rule, /ENV\{ID_USB_INTERFACE_NUM\}=="01"/);
  assert.match(rule, /TAG-="uaccess"/);
}
assert.match(finalRule, /OWNER="root"/);
assert.match(finalRule, /GROUP="soma-lca"/);
assert.match(finalRule, /MODE="0660"/);
assert.match(finalRule, /setfacl -b/);

for (const directive of [
  "User=soma-lca",
  "Group=soma-lca",
  "NoNewPrivileges=yes",
  "CapabilityBoundingSet=",
  "AmbientCapabilities=",
  "ProtectSystem=strict",
  "PrivateNetwork=yes",
  "RestrictAddressFamilies=AF_UNIX",
  "DevicePolicy=closed",
  "ReadOnlyPaths=/etc/soma/lca/policy.json",
  "ReadWritePaths=/var/lib/soma-lca",
]) {
  assert.ok(service.includes(directive), `missing service directive: ${directive}`);
}
assert.doesNotMatch(service, /^DeviceAllow=/m, "base service must not allow any unenrolled device");
assert.equal(
  deviceDropIn.trim().split("\n").at(-1),
  "DeviceAllow=@@FIDO_DEVICE@@ rw",
);
assert.doesNotMatch(service, /^\[Install\]$/m);
assert.doesNotMatch(socket, /^\[Install\]$/m);
assert.match(socket, /SocketGroup=soma-harness/);
assert.match(tmpfiles, /d \/var\/lib\/soma-lca 0700 soma-lca soma-lca/);
assert.match(tmpfiles, /d \/run\/soma 0750 root soma-harness/);
assert.match(tmpfiles, /f \/var\/lib\/soma-lca\/replay-state\.json 0600 soma-lca soma-lca/);

assert.equal(manifest.activation_status, "disabled");
assert.equal(manifest.hardware_backend, "not_built");
assert.equal(manifest.enrollment_status, "absent");
for (const field of [
  "creates_identity",
  "installs_artifacts",
  "reloads_udev",
  "triggers_device",
  "starts_units",
  "enrolls_credential",
  "enables_restart",
]) {
  assert.equal(manifest[field], false, `${field} must remain false`);
}

const udevVerify = spawnSync(
  "udevadm",
  [
    "verify",
    "--resolve-names=never",
    "packaging/udev/71-soma-lca-fido-isolation.rules",
    "packaging/udev/99-soma-lca-fido-isolation.rules",
  ],
  { encoding: "utf8" },
);
if (!udevVerify.error || udevVerify.error.code !== "ENOENT") {
  assert.equal(udevVerify.status, 0, udevVerify.stderr);
}

console.log("LCA inert package validation: PASS");

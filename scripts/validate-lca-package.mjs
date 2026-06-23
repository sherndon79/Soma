#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const earlyRule = await read("packaging/udev/71-soma-lca-fido-isolation.rules");
const finalRule = await read("packaging/udev/99-soma-lca-fido-isolation.rules");
const service = await read("packaging/systemd/soma-local-confirmation-issuer.service");
const tmpfiles = await read("packaging/tmpfiles/soma-local-confirmation-issuer.conf");
const deviceDropIn = await read("packaging/systemd/soma-local-confirmation-issuer-device.conf.in");
const manifest = JSON.parse(await read("packaging/lca-manifest.json"));
const lcaCargo = await read("crates/soma-local-confirmation-issuer/Cargo.toml");
const lcaMain = await read("crates/soma-local-confirmation-issuer/src/main.rs");
const lcaEnrollment = await read("crates/soma-local-confirmation-issuer/src/enroll.rs");

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
  "ReadWritePaths=/run/soma-lca",
  "ConditionPathIsDirectory=/run/soma-lca",
  "Environment=SOMA_LCA_SOCKET_PATH=/run/soma-lca/issuer.sock",
  "UnsetEnvironment=LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT",
]) {
  assert.ok(service.includes(directive), `missing service directive: ${directive}`);
}
assert.doesNotMatch(service, /^DeviceAllow=/m, "base service must not allow any unenrolled device");
assert.equal(
  deviceDropIn.trim().split("\n").at(-1),
  "DeviceAllow=@@FIDO_DEVICE@@ rw",
);
assert.match(deviceDropIn, /Environment=SOMA_LCA_FIDO_DEVICE=@@FIDO_DEVICE@@/);
assert.match(lcaCargo, /^hardware-fido = \[/m);
assert.match(lcaCargo, /required-features = \["hardware-fido"\]/);
assert.match(lcaMain, /SOMA_LCA_FIDO_DEVICE/);
assert.match(await read("crates/soma-local-confirmation-issuer/src/hardware.rs"), /\.env_clear\(\)/);
assert.match(lcaEnrollment, /EXPECTED_AAGUID.*d7781e5de35346aaafe23ca49f13332a/);
assert.match(lcaEnrollment, /value == "external"/);
assert.match(lcaEnrollment, /value == "wired"/);
assert.match(lcaEnrollment, /verify_attestation_trust/);
assert.match(lcaEnrollment, /minimum_counter = baseline_counter/);
assert.doesNotMatch(service, /^\[Install\]$/m);
assert.match(tmpfiles, /d \/var\/lib\/soma-lca 0700 soma-lca soma-lca/);
assert.match(tmpfiles, /d \/run\/soma-lca 0750 soma-lca soma-harness/);
assert.match(tmpfiles, /f \/var\/lib\/soma-lca\/replay-state\.json 0600 soma-lca soma-lca/);

assert.equal(manifest.activation_status, "disabled");
assert.equal(manifest.hardware_backend, "feature_gated");
assert.equal(manifest.enrollment_status, "tool_available_not_run");
const enrollmentTool = manifest.artifacts.find(
  (artifact) => artifact.destination === "/usr/libexec/soma/soma-local-confirmation-enroll",
);
assert.deepEqual(enrollmentTool.required_cargo_features, ["hardware-fido"]);
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

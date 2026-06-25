import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("sensorium broker service is hardened and inert until attended DeviceAllow drop-in", async () => {
  const service = await read("packaging/systemd/soma-sensor-broker.service");

  for (const directive of [
    "User=soma-sensorium",
    "Group=soma-sensorium",
    "UMask=0077",
    "ExecStart=/usr/libexec/soma/soma-sensor-broker",
    "Environment=SOMA_SENSORIUM_LIVE_DEPTH_PRESENCE_ALLOWED=false",
    "NoNewPrivileges=yes",
    "CapabilityBoundingSet=",
    "AmbientCapabilities=",
    "ProtectSystem=strict",
    "ProtectHome=yes",
    "PrivateTmp=yes",
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
    "SystemCallFilter=~@mount @module @raw-io @reboot @swap @keyring",
    "ProcSubset=pid",
    "ProtectProc=invisible",
    "DevicePolicy=closed",
    "RemoveIPC=yes",
    "RuntimeDirectory=soma/sensorium",
    "RuntimeDirectoryMode=0700",
    "ReadWritePaths=/run/soma/sensorium",
    "Restart=on-failure",
    "RestartSec=5s",
    "TimeoutStopSec=10s",
  ]) {
    assert.ok(service.includes(directive), `missing directive: ${directive}`);
  }
  assert.doesNotMatch(service, /^DeviceAllow=/m);
  assert.doesNotMatch(service, /^\[Install\]$/m);
});

test("sensorium RealSense udev template is product-pinned and isolated from FIDO group", async () => {
  const rule = await read("packaging/udev/71-soma-sensorium-realsense.rules.in");

  assert.match(rule, /ATTR\{idVendor\}=="8086"/);
  assert.match(rule, /ATTR\{idProduct\}=="@@REALSENSE_PRODUCT_ID@@"/);
  assert.match(rule, /ENV\{ID_VENDOR_ID\}=="8086"/);
  assert.match(rule, /ENV\{ID_MODEL_ID\}=="@@REALSENSE_PRODUCT_ID@@"/);
  assert.match(rule, /GROUP="soma-sensorium"/);
  assert.match(rule, /MODE="0660"/);
  assert.match(rule, /TAG-="uaccess"/);
  assert.doesNotMatch(rule, /soma-lca/);
});

test("sensorium DeviceAllow script renders depth-preferred drop-in and flags color exclusion", () => {
  const fixture = JSON.stringify([
    device("/dev/bus/usb/003/004", "usb", "Intel RealSense D435i control"),
    device("/dev/video2", "video4linux", "Intel RealSense D435i Depth"),
    device("/dev/video3", "video4linux", "Intel RealSense D435i RGB Camera"),
    device("/dev/media1", "media", "Intel RealSense D435i media controller"),
  ]);
  const result = spawnSync(
    "node",
    [
      "scripts/sensorium-realsense-device-allow.mjs",
      "--product-id",
      "0b3a",
      "--fixture-json",
      fixture,
      "--drop-in",
    ],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^\[Service\]/);
  assert.match(result.stdout, /DeviceAllow=\/dev\/bus\/usb\/003\/004 rw/);
  assert.match(result.stdout, /DeviceAllow=\/dev\/video2 rw/);
  assert.match(result.stdout, /DeviceAllow=\/dev\/media1 rw/);
  assert.doesNotMatch(result.stdout, /DeviceAllow=\/dev\/video3/);
  assert.match(result.stdout, /Excluded color nodes: \/dev\/video3/);
});

test("sensorium runbook requires independent stream mapping before DeviceAllow install", async () => {
  const runbook = await read("docs/runbooks/sensorium-realsense-sandbox-activation.md");
  const crossCheckAt = runbook.indexOf("## Cross-Check Stream Mapping");
  const installAt = runbook.indexOf("## Install The DeviceAllow Drop-In");

  assert.ok(crossCheckAt > 0, "runbook must include independent stream mapping gate");
  assert.ok(installAt > crossCheckAt, "stream mapping gate must precede DeviceAllow install");
  assert.match(runbook, /rs-enumerate-devices/);
  assert.match(runbook, /v4l2-ctl --list-devices/);
  assert.match(runbook, /no node listed in `device_allow` is a color\/RGB stream node/);
  assert.match(runbook, /do not describe it as topology-enforced color denial/);
});

function device(devname, subsystem, product) {
  return {
    devname,
    subsystem,
    properties: {
      ID_VENDOR_ID: "8086",
      ID_MODEL_ID: "0b3a",
      ID_V4L_PRODUCT: product,
    },
  };
}

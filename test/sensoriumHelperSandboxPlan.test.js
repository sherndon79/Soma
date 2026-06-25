import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSensoriumHelperSandboxPlan,
  buildSensoriumHelperSandboxPlan,
} from "../src/sensoriumHelperSandboxPlan.js";

test("sensorium helper sandbox plan spells out dedicated-user network-denied USB scope", () => {
  const plan = buildSensoriumHelperSandboxPlan({
    devicePaths: ["/dev/bus/usb/003/004", "/dev/video2", "/dev/media1", "/dev/hidraw4"],
  });

  assert.equal(plan.live_depth_presence_allowed, false);
  assert.equal(plan.isolation_model, "dedicated_user_network_denied_device_scoped");
  assert.equal(plan.systemd_unit.Service.ExecStart, "/usr/libexec/soma/soma-sensor-broker");
  assert.equal(plan.systemd_unit.Service.User, "soma-sensorium");
  assert.equal(plan.systemd_unit.Service.Group, "soma-sensorium");
  assert.equal(plan.systemd_unit.Service.UMask, "0077");
  assert.equal(
    plan.systemd_unit.Service.Environment,
    "SOMA_SENSORIUM_LIVE_DEPTH_PRESENCE_ALLOWED=false",
  );
  assert.equal(plan.systemd_unit.Service.PrivateNetwork, "yes");
  assert.equal(plan.systemd_unit.Service.IPAddressDeny, "any");
  assert.equal(plan.systemd_unit.Service.DevicePolicy, "closed");
  assert.deepEqual(plan.systemd_unit.Service.DeviceAllow, [
    "/dev/bus/usb/003/004",
    "/dev/video2",
    "/dev/media1",
    "/dev/hidraw4",
  ]);
  assert.deepEqual(plan.systemd_unit.Service.RestrictAddressFamilies, ["AF_UNIX"]);
  assert.deepEqual(plan.systemd_unit.Service.ReadWritePaths, ["/run/soma/sensorium"]);
  assert.equal(plan.systemd_unit.Service.RuntimeDirectoryMode, "0700");
  assert.equal(plan.systemd_unit.Service.Restart, "on-failure");
  assert.deepEqual(plan.systemd_unit.Service.SystemCallFilter, [
    "@system-service",
    "~@mount @module @raw-io @reboot @swap @keyring",
  ]);
  assert.equal(assertSensoriumHelperSandboxPlan(plan), true);
});

test("sensorium helper sandbox plan rejects network and device broadening", () => {
  const plan = buildSensoriumHelperSandboxPlan({
    binaryPath: "/usr/local/libexec/soma-sensor-broker",
    usbDevicePaths: ["/dev/bus/usb/003/004"],
  });
  const broadened = {
    ...plan,
    systemd_unit: {
      ...plan.systemd_unit,
      Service: {
        ...plan.systemd_unit.Service,
        PrivateNetwork: "no",
        DevicePolicy: "auto",
      },
    },
  };

  assert.throws(
    () => assertSensoriumHelperSandboxPlan(broadened),
    (error) => {
      assert.equal(error.code, "sensorium_helper_sandbox_plan_invalid");
      assert.ok(error.findings.some((finding) => finding.includes("PrivateNetwork")));
      assert.ok(error.findings.some((finding) => finding.includes("DevicePolicy")));
      return true;
    },
  );
});

test("sensorium helper sandbox plan requires explicit USB device paths", () => {
  assert.throws(
    () => buildSensoriumHelperSandboxPlan({
      binaryPath: "/usr/local/libexec/soma-sensor-broker",
      devicePaths: ["/dev/input/event0"],
    }),
    /must point under \/dev\/bus\/usb, \/dev\/video, \/dev\/media, or \/dev\/hidraw/,
  );
});

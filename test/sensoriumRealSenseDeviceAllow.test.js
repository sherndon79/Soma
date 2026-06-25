import assert from "node:assert/strict";
import test from "node:test";

import { buildRealSenseDeviceAllowPlan } from "../src/sensoriumRealSenseDeviceAllow.js";

test("RealSense DeviceAllow planner prefers depth nodes and excludes separable color", () => {
  const plan = buildRealSenseDeviceAllowPlan({
    productId: "0b3a",
    devices: [
      device("/dev/bus/usb/003/004", "usb", "Intel RealSense D435i control"),
      device("/dev/video2", "video4linux", "Intel RealSense D435i Depth"),
      device("/dev/video3", "video4linux", "Intel RealSense D435i Infrared"),
      device("/dev/video4", "video4linux", "Intel RealSense D435i RGB Camera"),
      device("/dev/media1", "media", "Intel RealSense D435i media controller"),
      device("/dev/hidraw4", "hidraw", "Intel RealSense D435i gyro accel"),
    ],
  });

  assert.equal(plan.minimal_depth_set_preferred, true);
  assert.equal(plan.minimal_depth_set_clean, true);
  assert.equal(plan.fallback_required, false);
  assert.deepEqual(plan.device_allow, [
    "/dev/bus/usb/003/004",
    "/dev/video2",
    "/dev/video3",
    "/dev/media1",
    "/dev/hidraw4",
  ]);
  assert.deepEqual(plan.excluded_color_nodes, ["/dev/video4"]);
  assert.deepEqual(plan.unresolved_nodes, []);
});

test("RealSense DeviceAllow planner flags unknown matched video nodes for manual review", () => {
  const plan = buildRealSenseDeviceAllowPlan({
    productId: "0b3a",
    devices: [
      device("/dev/video2", "video4linux", "Intel RealSense D435i Depth"),
      device("/dev/video4", "video4linux", "Intel RealSense D435i RGB Camera"),
      device("/dev/video5", "video4linux", "Intel RealSense D435i Stream 5"),
    ],
  });

  assert.equal(plan.minimal_depth_set_clean, false);
  assert.equal(plan.fallback_required, true);
  assert.match(plan.fallback_reason, /could not be classified/);
  assert.deepEqual(plan.device_allow, ["/dev/video2"]);
  assert.deepEqual(plan.excluded_color_nodes, ["/dev/video4"]);
  assert.deepEqual(plan.unresolved_nodes, ["/dev/video5"]);
});

test("RealSense DeviceAllow planner ignores other vendors and product ids", () => {
  const plan = buildRealSenseDeviceAllowPlan({
    productId: "0b3a",
    devices: [
      device("/dev/video2", "video4linux", "Intel RealSense D435i Depth", {
        ID_VENDOR_ID: "1050",
      }),
      device("/dev/video3", "video4linux", "Intel RealSense other Depth", {
        ID_MODEL_ID: "ffff",
      }),
    ],
  });

  assert.deepEqual(plan.device_allow, []);
  assert.equal(plan.fallback_required, true);
});

function device(devname, subsystem, product, overrides = {}) {
  return {
    devname,
    subsystem,
    properties: {
      ID_VENDOR_ID: "8086",
      ID_MODEL_ID: "0b3a",
      ID_V4L_PRODUCT: product,
      ...overrides,
    },
  };
}

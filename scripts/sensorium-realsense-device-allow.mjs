#!/usr/bin/env node

import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";

import { buildRealSenseDeviceAllowPlan } from "../src/sensoriumRealSenseDeviceAllow.js";

const args = parseArgs(process.argv.slice(2));
const devices = args.fixture
  ? JSON.parse(args.fixture)
  : await discoverDevices();
const plan = buildRealSenseDeviceAllowPlan({
  devices,
  productId: args.productId,
});

if (args.dropIn) {
  console.log(renderDeviceAllowDropIn(plan));
} else {
  console.log(JSON.stringify(plan, null, 2));
}

if (plan.fallback_required) {
  process.exitCode = 2;
}

async function discoverDevices() {
  const candidates = [
    ...(await globDev("/dev", /^video\d+$/)),
    ...(await globDev("/dev", /^media\d+$/)),
    ...(await globDev("/dev", /^hidraw\d+$/)),
    ...(await globUsbBus()),
  ];
  return candidates
    .map((devname) => udevDevice(devname))
    .filter(Boolean);
}

async function globDev(dir, pattern) {
  try {
    const entries = await readdir(dir);
    return entries
      .filter((entry) => pattern.test(entry))
      .map((entry) => join(dir, entry));
  } catch {
    return [];
  }
}

async function globUsbBus() {
  const root = "/dev/bus/usb";
  const devices = [];
  try {
    for (const bus of await readdir(root)) {
      const busPath = join(root, bus);
      if (!(await isDirectory(busPath))) {
        continue;
      }
      for (const device of await readdir(busPath)) {
        devices.push(join(busPath, device));
      }
    }
  } catch {
    return [];
  }
  return devices;
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function udevDevice(devname) {
  const result = spawnSync("udevadm", ["info", "--query=property", "--name", devname], {
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  return {
    devname,
    subsystem: propertyValue(result.stdout, "SUBSYSTEM"),
    properties: parseProperties(result.stdout),
  };
}

function parseProperties(text) {
  return Object.fromEntries(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const equalsAt = line.indexOf("=");
        return [line.slice(0, equalsAt), line.slice(equalsAt + 1)];
      }),
  );
}

function propertyValue(text, name) {
  return parseProperties(text)[name] || "";
}

function renderDeviceAllowDropIn(plan) {
  const lines = [
    "[Service]",
    "# Generated during attended sensorium deployment from live udev graph.",
    "# Do not hand-edit without rerunning sensorium-realsense-device-allow.",
    "Environment=SOMA_SENSORIUM_LIVE_DEPTH_PRESENCE_ALLOWED=false",
  ];
  for (const device of plan.device_allow) {
    lines.push(`DeviceAllow=${device} rw`);
  }
  if (plan.excluded_color_nodes.length > 0) {
    lines.push(`# Excluded color nodes: ${plan.excluded_color_nodes.join(" ")}`);
  }
  if (plan.fallback_required) {
    lines.push(`# MANUAL_REVIEW_REQUIRED: ${plan.fallback_reason}`);
    for (const device of plan.unresolved_nodes) {
      lines.push(`# Unresolved matched node: ${device}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const parsed = {
    productId: "",
    fixture: "",
    dropIn: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--product-id") {
      parsed.productId = argv[++index] || "";
    } else if (arg === "--fixture-json") {
      parsed.fixture = argv[++index] || "";
    } else if (arg === "--drop-in") {
      parsed.dropIn = true;
    } else if (arg === "--help") {
      usage(0);
    } else {
      usage(1, `unknown argument: ${arg}`);
    }
  }
  if (!parsed.productId) {
    usage(1, "--product-id is required, from Seth's lsusb value for 8086:PID");
  }
  return parsed;
}

function usage(status, message = "") {
  if (message) {
    console.error(message);
  }
  console.error(
    [
      "Usage: node scripts/sensorium-realsense-device-allow.mjs --product-id <pid> [--drop-in]",
      "",
      "Discovers RealSense /dev nodes with udevadm and prints a depth-preferred DeviceAllow plan.",
      "Exit code 2 means the live graph needs manual review before installing the drop-in.",
    ].join("\n"),
  );
  process.exit(status);
}

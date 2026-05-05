import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { assertDesktopInspectionResult } from "./desktopInspectionSchema.js";

const execFileAsync = promisify(execFile);
const DEFAULT_HELPER_PATH = fileURLToPath(
  new URL("../target/debug/soma-desktop-broker", import.meta.url),
);

export async function inspectDesktopBrokerEnvironment({
  mode = "environment",
  maxApps,
  maxChildren,
  env = process.env,
  helperPath = env.SOMA_DESKTOP_BROKER ?? DEFAULT_HELPER_PATH,
} = {}) {
  const normalizedMode = normalizeInspectionMode(mode);
  const helperInspection = await inspectWithRustHelper(helperPath, normalizedMode);
  const limits = normalizeInspectionLimits({ maxApps, maxChildren });
  if (helperInspection) {
    return limitDesktopInspectionResult(assertDesktopInspectionResult(helperInspection), limits);
  }
  return limitDesktopInspectionResult(
    assertDesktopInspectionResult(await inspectDesktopBrokerEnvironmentFallback({ env, mode: normalizedMode })),
    limits,
  );
}

export async function inspectDesktopBrokerEnvironmentFallback({ env = process.env, mode = "environment" } = {}) {
  const commands = await detectCommands(["gdbus", "busctl", "qdbus", "wtype", "ydotool"], env);
  const sessionBusAvailable = Boolean(env.DBUS_SESSION_BUS_ADDRESS);
  const desktopSession = env.XDG_CURRENT_DESKTOP ?? "";
  const sessionType = env.XDG_SESSION_TYPE ?? "";

  if (mode === "atspi") {
    return {
      mode: "read_only_atspi_probe",
      broker_source: "javascript_fallback",
      platform: process.platform,
      release: os.release(),
      desktop_session: desktopSession,
      session_type: sessionType,
      dbus_session_bus_available: sessionBusAvailable,
      atspi_likely_available: sessionBusAvailable && (Boolean(env.DISPLAY) || Boolean(env.WAYLAND_DISPLAY)),
      atspi_bus_address_available: false,
      application_count: 0,
      window_count: 0,
      tree: null,
      tree_available: false,
      unavailable_reason: "rust_helper_unavailable",
    };
  }

  return {
    mode: "read_only_environment_probe",
    broker_source: "javascript_fallback",
    platform: process.platform,
    release: os.release(),
    desktop_session: desktopSession,
    session_type: sessionType,
    wayland_display_present: Boolean(env.WAYLAND_DISPLAY),
    x11_display_present: Boolean(env.DISPLAY),
    dbus_session_bus_available: sessionBusAvailable,
    atspi_likely_available: sessionBusAvailable && (Boolean(env.DISPLAY) || Boolean(env.WAYLAND_DISPLAY)),
    candidate_adapters: {
      atspi_dbus: commands.gdbus || commands.busctl,
      kde_kwin: desktopSession.toLowerCase().includes("kde") && (commands.qdbus || commands.busctl),
      xdg_desktop_portal: sessionBusAvailable,
      wayland_keyboard_input: commands.wtype,
      uinput_input: commands.ydotool,
    },
    commands,
    tree: null,
    tree_available: false,
  };
}

async function inspectWithRustHelper(helperPath, mode) {
  if (!helperPath || !(await isExecutable(helperPath))) {
    return null;
  }

  try {
    const command = mode === "atspi" ? "inspect-atspi" : "inspect-environment";
    const { stdout } = await execFileAsync(helperPath, [command], {
      timeout: 2000,
      maxBuffer: 256_000,
    });
    const payload = JSON.parse(stdout);
    return {
      ...payload,
      broker_source: payload.broker_source ?? "rust_helper",
    };
  } catch {
    return null;
  }
}

function normalizeInspectionMode(mode) {
  return mode === "atspi" ? "atspi" : "environment";
}

function normalizeInspectionLimits({ maxApps, maxChildren }) {
  return {
    maxApps: boundedInteger(maxApps, 1, 64),
    maxChildren: boundedInteger(maxChildren, 0, 8),
  };
}

function boundedInteger(value, minimum, maximum) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return null;
  }
  return Math.max(minimum, Math.min(maximum, number));
}

function limitDesktopInspectionResult(inspection, { maxApps, maxChildren }) {
  if (!inspection.tree || !Array.isArray(inspection.tree.applications)) {
    return inspection;
  }

  const applications = maxApps === null
    ? inspection.tree.applications
    : inspection.tree.applications.slice(0, maxApps);
  const limitedApplications = applications.map((application) => {
    if (!application.root_object || maxChildren === null) {
      return application;
    }
    return {
      ...application,
      root_object: {
        ...application.root_object,
        children_sample: application.root_object.children_sample.slice(0, maxChildren),
        child_metadata_sample: application.root_object.child_metadata_sample.slice(0, maxChildren),
      },
    };
  });

  return {
    ...inspection,
    application_count: limitedApplications.length,
    root_object_available_count: limitedApplications.filter((application) => application.root_object).length,
    tree: {
      ...inspection.tree,
      applications: limitedApplications,
    },
  };
}

async function isExecutable(candidatePath) {
  try {
    await access(candidatePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function detectCommands(names, env) {
  const results = {};
  await Promise.all(names.map(async (name) => {
    results[name] = await commandExists(name, env);
  }));
  return results;
}

async function commandExists(name, env) {
  const paths = String(env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const directory of paths) {
    try {
      await access(path.join(directory, name));
      return true;
    } catch {
      // Continue searching PATH.
    }
  }
  return false;
}

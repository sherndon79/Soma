import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  assertDesktopInspectionResult,
  assertTraversalAuthorizedDesktopInspectionResult,
} from "./desktopInspectionSchema.js";
import { validateFutureDesktopTraversalOutput } from "./desktopTraversalOutput.js";

const execFileAsync = promisify(execFile);
const DEFAULT_HELPER_PATH = fileURLToPath(
  new URL("../target/debug/soma-desktop-broker", import.meta.url),
);
const MAX_ROOT_CHILD_METADATA_LIMIT = 4;
const TRAVERSAL_HELPER_LIMITS = {
  maxDepth: [1, 4],
  maxNodes: [1, 256],
  maxChildrenPerNode: [1, 32],
};

export function desktopBrokerHelperArgs({ mode = "environment", maxApps, maxChildren } = {}) {
  const normalizedMode = normalizeInspectionMode(mode);
  const command = normalizedMode === "atspi" ? "inspect-atspi" : "inspect-environment";
  if (normalizedMode !== "atspi") {
    return [command];
  }

  const limits = normalizeInspectionLimits({ maxApps, maxChildren });
  const args = [command];
  if (limits.maxApps !== null) {
    args.push("--max-applications", String(limits.maxApps));
  }
  if (limits.maxChildren !== null) {
    args.push(
      "--max-root-child-refs",
      String(limits.maxChildren),
      "--max-root-child-metadata",
      String(Math.min(limits.maxChildren, MAX_ROOT_CHILD_METADATA_LIMIT)),
    );
  }
  return args;
}

export function desktopTraversalHelperArgs({
  authorizedRoot,
  maxDepth,
  maxNodes,
  maxChildrenPerNode,
} = {}) {
  if (
    typeof authorizedRoot?.service !== "string" ||
    typeof authorizedRoot?.path !== "string" ||
    authorizedRoot.service.length === 0 ||
    authorizedRoot.path.length === 0
  ) {
    throw new TypeError("authorizedRoot.service and authorizedRoot.path are required");
  }
  assertTraversalHelperLimit(maxDepth, "maxDepth");
  assertTraversalHelperLimit(maxNodes, "maxNodes");
  assertTraversalHelperLimit(maxChildrenPerNode, "maxChildrenPerNode");

  return [
    "inspect-atspi-traversal",
    "--root-service",
    authorizedRoot.service,
    "--root-path",
    authorizedRoot.path,
    "--max-depth",
    String(maxDepth),
    "--max-nodes",
    String(maxNodes),
    "--max-children-per-node",
    String(maxChildrenPerNode),
  ];
}

function assertTraversalHelperLimit(value, name) {
  const [minimum, maximum] = TRAVERSAL_HELPER_LIMITS[name];
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
}

export async function inspectDesktopBrokerEnvironment({
  mode = "environment",
  maxApps,
  maxChildren,
  env = process.env,
  helperPath = env.SOMA_DESKTOP_BROKER ?? DEFAULT_HELPER_PATH,
} = {}) {
  const normalizedMode = normalizeInspectionMode(mode);
  const helperArgs = desktopBrokerHelperArgs({ mode: normalizedMode, maxApps, maxChildren });
  const helperInspection = await inspectWithRustHelper(helperPath, helperArgs);
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

export async function inspectFocusedDesktopObject({
  env = process.env,
  helperPath = env.SOMA_DESKTOP_BROKER ?? DEFAULT_HELPER_PATH,
} = {}) {
  const helperInspection = await inspectFocusWithRustHelper(helperPath);
  if (helperInspection) {
    return assertFocusedDesktopInspection(helperInspection);
  }
  return assertFocusedDesktopInspection(focusedObjectUnavailable({
    brokerSource: "javascript_fallback",
    env,
    unavailableReason: "rust_helper_unavailable",
  }));
}

export async function inspectDesktopTraversalWithRustHelper({
  authorizedRoot,
  maxDepth,
  maxNodes,
  maxChildrenPerNode,
  env = process.env,
  helperPath = env.SOMA_DESKTOP_BROKER ?? DEFAULT_HELPER_PATH,
} = {}) {
  const helperArgs = desktopTraversalHelperArgs({
    authorizedRoot,
    maxDepth,
    maxNodes,
    maxChildrenPerNode,
  });
  const helperTraversal = await inspectTraversalWithRustHelper(helperPath, helperArgs);
  if (helperTraversal === null) {
    return null;
  }
  return assertFutureDesktopTraversalHelperOutput(helperTraversal);
}

export function assertFutureDesktopTraversalHelperOutput(value) {
  const result = validateFutureDesktopTraversalOutput(value);
  if (!result.valid) {
    const error = new Error(`Desktop traversal helper output failed validation: ${result.errors.join("; ")}`);
    error.statusCode = 502;
    error.code = "desktop_traversal_helper_output_invalid";
    error.validation_errors = result.errors;
    throw error;
  }
  return value;
}

export function attachTraversalToDesktopInspectionResult({ inspection, traversal } = {}) {
  const validatedTraversal = assertFutureDesktopTraversalHelperOutput(traversal);
  if (!inspection?.tree || !Array.isArray(inspection.tree.applications)) {
    throw new TypeError("inspection.tree.applications is required");
  }

  let attached = false;
  const applications = inspection.tree.applications.map((application) => {
    const rootObject = application.root_object;
    if (
      !attached &&
      rootObject &&
      application.service === validatedTraversal.root.service &&
      rootObject.path === validatedTraversal.root.path
    ) {
      attached = true;
      return {
        ...application,
        root_object: {
          ...rootObject,
          traversal: validatedTraversal,
        },
      };
    }
    return application;
  });

  if (!attached) {
    const error = new Error("Traversal root was not present in desktop inspection result.");
    error.code = "desktop_traversal_root_not_in_inspection";
    throw error;
  }

  return assertTraversalAuthorizedDesktopInspectionResult({
    ...inspection,
    tree: {
      ...inspection.tree,
      applications,
    },
  });
}

async function inspectWithRustHelper(helperPath, args) {
  if (!helperPath || !(await isExecutable(helperPath))) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync(helperPath, args, {
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

async function inspectFocusWithRustHelper(helperPath) {
  if (!helperPath || !(await isExecutable(helperPath))) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync(helperPath, ["inspect-focus"], {
      timeout: 2000,
      maxBuffer: 128_000,
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

async function inspectTraversalWithRustHelper(helperPath, args) {
  if (!helperPath || !(await isExecutable(helperPath))) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync(helperPath, args, {
      timeout: 2000,
      maxBuffer: 512_000,
    });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function focusedObjectUnavailable({ brokerSource, env, unavailableReason }) {
  return {
    mode: "read_only_focused_object_probe",
    broker_source: brokerSource,
    platform: process.platform,
    release: os.release(),
    desktop_session: env.XDG_CURRENT_DESKTOP ?? "",
    session_type: env.XDG_SESSION_TYPE ?? "",
    focus_available: false,
    focused_object: null,
    unavailable_reason: unavailableReason,
    text_content_included: false,
    withheld_fields: ["name", "description", "text", "states", "actions"],
  };
}

function assertFocusedDesktopInspection(result) {
  const errors = [];
  const allowedTopLevel = new Set([
    "mode",
    "broker_source",
    "platform",
    "release",
    "desktop_session",
    "session_type",
    "dbus_session_bus_available",
    "focus_available",
    "focused_object",
    "unavailable_reason",
    "text_content_included",
    "withheld_fields",
  ]);
  for (const key of Object.keys(result ?? {})) {
    if (!allowedTopLevel.has(key)) {
      errors.push(`result.${key} is not allowed`);
    }
  }

  if (result?.mode !== "read_only_focused_object_probe") {
    errors.push("result.mode must be read_only_focused_object_probe");
  }
  if (result?.text_content_included !== false) {
    errors.push("result.text_content_included must be false");
  }
  if (typeof result?.focus_available !== "boolean") {
    errors.push("result.focus_available must be boolean");
  }
  if (!Array.isArray(result?.withheld_fields)) {
    errors.push("result.withheld_fields must be an array");
  }

  if (result?.focus_available === true) {
    validateFocusedObject(result.focused_object, errors);
  } else if (result?.focused_object !== null) {
    errors.push("result.focused_object must be null when focus is unavailable");
  }

  if (errors.length > 0) {
    const error = new Error("Focused desktop inspection result exceeded its schema.");
    error.statusCode = 502;
    error.code = "focused_desktop_inspection_schema_invalid";
    error.validation_errors = errors;
    throw error;
  }

  return result;
}

function validateFocusedObject(focusedObject, errors) {
  if (!focusedObject || typeof focusedObject !== "object" || Array.isArray(focusedObject)) {
    errors.push("result.focused_object must be an object when focus is available");
    return;
  }

  const allowedFocusedObject = new Set(["service", "path", "role", "child_count", "application"]);
  for (const key of Object.keys(focusedObject)) {
    if (!allowedFocusedObject.has(key)) {
      errors.push(`result.focused_object.${key} is not allowed`);
    }
  }
  if (typeof focusedObject.service !== "string") {
    errors.push("result.focused_object.service must be string");
  }
  if (typeof focusedObject.path !== "string") {
    errors.push("result.focused_object.path must be string");
  }
  if (typeof focusedObject.role !== "string") {
    errors.push("result.focused_object.role must be string");
  }
  if (!Number.isInteger(focusedObject.child_count) || focusedObject.child_count < 0) {
    errors.push("result.focused_object.child_count must be a non-negative integer");
  }
  if (focusedObject.application !== undefined) {
    validateFocusedApplication(focusedObject.application, errors);
  }
}

function validateFocusedApplication(application, errors) {
  if (!application || typeof application !== "object" || Array.isArray(application)) {
    errors.push("result.focused_object.application must be an object");
    return;
  }
  const allowedApplication = new Set(["service", "path"]);
  for (const key of Object.keys(application)) {
    if (!allowedApplication.has(key)) {
      errors.push(`result.focused_object.application.${key} is not allowed`);
    }
  }
  if (typeof application.service !== "string") {
    errors.push("result.focused_object.application.service must be string");
  }
  if (typeof application.path !== "string") {
    errors.push("result.focused_object.application.path must be string");
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

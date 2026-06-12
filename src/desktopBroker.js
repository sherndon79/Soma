import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  assertDesktopInspectionResult,
  assertDesktopTextInspectionResult,
  assertDesktopWindowsInspectionResult,
  assertTraversalAuthorizedDesktopInspectionResult,
} from "./desktopInspectionSchema.js";
import { loadSyntheticDesktopFixture } from "./desktopSyntheticFixtures.js";
import { validateDesktopTraversalOutput } from "./desktopTraversalOutput.js";

const execFileAsync = promisify(execFile);
const DEFAULT_HELPER_PATH = fileURLToPath(
  new URL("../target/debug/soma-desktop-broker", import.meta.url),
);
const DEFAULT_DESKTOP_REALISM_COMPOSE_FILE = "docker-compose.desktop-realism.yml";
const DEFAULT_DESKTOP_REALISM_PROJECT = "soma-desktop-realism";
const DEFAULT_DESKTOP_REALISM_SERVICE = "desktop-realism";
const DEFAULT_DESKTOP_REALISM_INSPECT_COMMAND = "/usr/local/bin/desktop-realism-broker-inspect";
const DEFAULT_DESKTOP_REALISM_WINDOWS_COMMAND = "/usr/local/bin/soma-desktop-broker";
const DEFAULT_DESKTOP_REALISM_TEXT_COMMAND = "/usr/local/bin/soma-desktop-broker";
const DEFAULT_DESKTOP_REALISM_TIMEOUT_MS = 5000;
const DESKTOP_ACTUATION_METADATA = Symbol("desktopActuationMetadata");
const ACT_KINDS = new Set(["invoke_default", "text_insert", "text_set"]);
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

export async function inspectDesktopAccessibilityTreeWithDescriptor({
  descriptor = {},
  env = process.env,
  helperPath = env.SOMA_DESKTOP_BROKER ?? DEFAULT_HELPER_PATH,
} = {}) {
  if (descriptor.capability !== "desktop.inspect.accessibility_tree") {
    const error = new Error("Desktop accessibility descriptor capability is invalid.");
    error.code = "desktop_descriptor_capability_invalid";
    error.statusCode = 400;
    throw error;
  }
  const limits = normalizeInspectionLimits({
    maxApps: descriptor.limits?.max_apps,
    maxChildren: descriptor.limits?.max_children,
  });
  if (descriptor.provider_mode === "synthetic_fixture") {
    if (descriptor.synthetic !== true || descriptor.domain !== "testing") {
      const error = new Error("Synthetic desktop fixtures are only available in the testing domain.");
      error.code = "synthetic_desktop_domain_required";
      error.statusCode = 403;
      throw error;
    }
    const loaded = assertDesktopInspectionResult(await loadSyntheticDesktopFixture(descriptor.fixture_id));
    return assertDesktopInspectionResult(limitDesktopInspectionResult(loaded, limits));
  }
  if (descriptor.provider_mode === "synthetic_container_live") {
    if (descriptor.synthetic !== true || descriptor.domain !== "testing") {
      const error = new Error("Synthetic container desktop inspection is only available in the testing domain.");
      error.code = "synthetic_desktop_domain_required";
      error.statusCode = 403;
      throw error;
    }
    return inspectSyntheticContainerDesktop({ descriptor, env });
  }
  if (descriptor.provider_mode === "live_helper") {
    return inspectDesktopBrokerEnvironment({
      mode: "atspi",
      maxApps: descriptor.limits?.max_apps,
      maxChildren: descriptor.limits?.max_children,
      env,
      helperPath,
    });
  }
  const error = new Error("Desktop descriptor provider mode is not supported.");
  error.code = "desktop_provider_mode_unsupported";
  error.statusCode = 400;
  throw error;
}

export function syntheticContainerDesktopBrokerArgs({ descriptor = {}, env = process.env } = {}) {
  const limits = normalizeInspectionLimits({
    maxApps: descriptor.limits?.max_apps,
    maxChildren: descriptor.limits?.max_children,
  });
  const args = [
    "compose",
    "-p",
    String(env.SOMA_DESKTOP_REALISM_COMPOSE_PROJECT ?? DEFAULT_DESKTOP_REALISM_PROJECT),
    "-f",
    String(env.SOMA_DESKTOP_REALISM_COMPOSE_FILE ?? DEFAULT_DESKTOP_REALISM_COMPOSE_FILE),
    "exec",
    "-T",
  ];
  if (limits.maxApps !== null) {
    args.push("-e", `DESKTOP_REALISM_BROKER_MAX_APPS=${limits.maxApps}`);
  }
  if (limits.maxChildren !== null) {
    args.push("-e", `DESKTOP_REALISM_BROKER_MAX_CHILDREN=${limits.maxChildren}`);
  }
  args.push(
    String(env.SOMA_DESKTOP_REALISM_SERVICE ?? DEFAULT_DESKTOP_REALISM_SERVICE),
    String(env.SOMA_DESKTOP_REALISM_INSPECT_COMMAND ?? DEFAULT_DESKTOP_REALISM_INSPECT_COMMAND),
  );
  return args;
}

export function syntheticContainerDesktopWindowsBrokerArgs({ env = process.env } = {}) {
  const command = String(env.SOMA_DESKTOP_REALISM_WINDOWS_COMMAND ?? DEFAULT_DESKTOP_REALISM_WINDOWS_COMMAND);
  const mode = String(env.SOMA_DESKTOP_REALISM_WINDOWS_ACTUATION_METADATA === "1" ? "inspect-windows-actuation" : "inspect-windows");
  return [
    "compose",
    "-p",
    String(env.SOMA_DESKTOP_REALISM_COMPOSE_PROJECT ?? DEFAULT_DESKTOP_REALISM_PROJECT),
    "-f",
    String(env.SOMA_DESKTOP_REALISM_COMPOSE_FILE ?? DEFAULT_DESKTOP_REALISM_COMPOSE_FILE),
    "exec",
    "-T",
    String(env.SOMA_DESKTOP_REALISM_SERVICE ?? DEFAULT_DESKTOP_REALISM_SERVICE),
    "sh",
    "-lc",
    syntheticContainerBrokerShellCommand(command, mode),
  ];
}

export function syntheticContainerDesktopTextBrokerArgs({ env = process.env } = {}) {
  const command = String(env.SOMA_DESKTOP_REALISM_TEXT_COMMAND ?? DEFAULT_DESKTOP_REALISM_TEXT_COMMAND);
  const mode = String(env.SOMA_DESKTOP_REALISM_TEXT_ACTUATION_METADATA === "1" ? "inspect-text-actuation" : "inspect-text");
  return [
    "compose",
    "-p",
    String(env.SOMA_DESKTOP_REALISM_COMPOSE_PROJECT ?? DEFAULT_DESKTOP_REALISM_PROJECT),
    "-f",
    String(env.SOMA_DESKTOP_REALISM_COMPOSE_FILE ?? DEFAULT_DESKTOP_REALISM_COMPOSE_FILE),
    "exec",
    "-T",
    String(env.SOMA_DESKTOP_REALISM_SERVICE ?? DEFAULT_DESKTOP_REALISM_SERVICE),
    "sh",
    "-lc",
    syntheticContainerBrokerShellCommand(command, mode),
  ];
}

export function syntheticContainerDesktopActBrokerArgs({ actKind = "", locator = {}, text = "", env = process.env } = {}) {
  const args = [
    "compose",
    "-p",
    String(env.SOMA_DESKTOP_REALISM_COMPOSE_PROJECT ?? DEFAULT_DESKTOP_REALISM_PROJECT),
    "-f",
    String(env.SOMA_DESKTOP_REALISM_COMPOSE_FILE ?? DEFAULT_DESKTOP_REALISM_COMPOSE_FILE),
    "exec",
    "-T",
  ];
  if (text !== "") {
    args.push("-e", `SOMA_DESKTOP_ACT_TEXT=${text}`);
  }
  const command = String(env.SOMA_DESKTOP_REALISM_TEXT_COMMAND ?? DEFAULT_DESKTOP_REALISM_TEXT_COMMAND);
  args.push(
    String(env.SOMA_DESKTOP_REALISM_SERVICE ?? DEFAULT_DESKTOP_REALISM_SERVICE),
    "sh",
    "-lc",
    syntheticContainerBrokerShellCommand(
      command,
      actKind === "invoke_default" ? "act-invoke" : "act-text",
      [
        "--service",
        String(locator.service ?? ""),
        "--path",
        String(locator.path ?? ""),
        "--act-kind",
        String(actKind ?? ""),
      ],
    ),
  );
  return args;
}

export function desktopActuationMetadata(inspection) {
  return inspection?.[DESKTOP_ACTUATION_METADATA] ?? null;
}

async function inspectSyntheticContainerDesktop({ descriptor = {}, env = process.env } = {}) {
  const dockerPath = String(env.SOMA_DESKTOP_REALISM_DOCKER ?? "docker");
  const args = syntheticContainerDesktopBrokerArgs({ descriptor, env });
  let payload;
  try {
    const { stdout } = await execFileAsync(dockerPath, args, {
      env,
      timeout: desktopRealismTimeoutMs(env),
      maxBuffer: 512_000,
    });
    payload = JSON.parse(stdout);
  } catch (cause) {
    const error = new Error("Synthetic container desktop inspection provider is unreachable.");
    error.code = "desktop_synthetic_container_unreachable";
    error.statusCode = 503;
    error.cause = cause;
    throw error;
  }

  let inspection;
  try {
    inspection = assertDesktopInspectionResult({
      ...payload,
      broker_source: payload.broker_source ?? "rust_helper",
    });
  } catch (cause) {
    const error = new Error("Synthetic container desktop inspection provider returned an invalid contract.");
    error.code = "desktop_synthetic_container_contract_invalid";
    error.statusCode = 502;
    error.cause = cause;
    throw error;
  }

  if (inspection.tree_available !== true || !inspection.tree) {
    const error = new Error("Synthetic container desktop inspection tree is unavailable.");
    error.code = "desktop_synthetic_container_tree_unavailable";
    error.statusCode = 503;
    throw error;
  }
  const limits = normalizeInspectionLimits({
    maxApps: descriptor.limits?.max_apps,
    maxChildren: descriptor.limits?.max_children,
  });
  return assertDesktopInspectionResult(limitDesktopInspectionResult(inspection, limits));
}

export async function inspectDesktopWindowsWithDescriptor({
  descriptor = {},
  env = process.env,
} = {}) {
  if (descriptor.capability !== "desktop.inspect.windows") {
    const error = new Error("Desktop windows descriptor capability is invalid.");
    error.code = "desktop_windows_descriptor_capability_invalid";
    error.statusCode = 400;
    throw error;
  }
  if (descriptor.provider_mode !== "synthetic_container_live") {
    const error = new Error("Desktop windows inspection is only routed through the synthetic container provider.");
    error.code = "desktop_windows_provider_mode_unsupported";
    error.statusCode = 403;
    throw error;
  }
  if (descriptor.synthetic !== true || descriptor.domain !== "testing") {
    const error = new Error("Synthetic container desktop window inspection is only available in the testing domain.");
    error.code = "synthetic_desktop_domain_required";
    error.statusCode = 403;
    throw error;
  }
  return inspectSyntheticContainerDesktopWindows({ descriptor, env });
}

export async function inspectDesktopTextWithDescriptor({
  descriptor = {},
  env = process.env,
} = {}) {
  if (descriptor.capability !== "desktop.inspect.text") {
    const error = new Error("Desktop text descriptor capability is invalid.");
    error.code = "desktop_text_descriptor_capability_invalid";
    error.statusCode = 400;
    throw error;
  }
  if (descriptor.provider_mode !== "synthetic_container_live") {
    const error = new Error("Desktop text inspection is only routed through the synthetic container provider.");
    error.code = "desktop_text_provider_mode_unsupported";
    error.statusCode = 403;
    throw error;
  }
  if (descriptor.synthetic !== true || descriptor.domain !== "testing") {
    const error = new Error("Synthetic container desktop text inspection is only available in the testing domain.");
    error.code = "synthetic_desktop_domain_required";
    error.statusCode = 403;
    throw error;
  }
  return inspectSyntheticContainerDesktopText({ descriptor, env });
}

async function inspectSyntheticContainerDesktopWindows({ descriptor = {}, env = process.env } = {}) {
  const dockerPath = String(env.SOMA_DESKTOP_REALISM_DOCKER ?? "docker");
  const args = syntheticContainerDesktopWindowsBrokerArgs({
    descriptor,
    env: { ...env, SOMA_DESKTOP_REALISM_WINDOWS_ACTUATION_METADATA: "1" },
  });
  let payload;
  try {
    const { stdout } = await execFileAsync(dockerPath, args, {
      env,
      timeout: desktopRealismTimeoutMs(env),
      maxBuffer: 512_000,
    });
    payload = JSON.parse(stdout);
  } catch (cause) {
    const error = new Error("Synthetic container desktop window inspection provider is unreachable.");
    error.code = "desktop_synthetic_container_windows_unreachable";
    error.statusCode = 503;
    error.cause = cause;
    throw error;
  }

  try {
    const { publicPayload, metadata } = extractWindowsActuationMetadata({
      ...payload,
      broker_source: payload.broker_source ?? "rust_helper",
    });
    const inspection = assertDesktopWindowsInspectionResult(publicPayload);
    attachDesktopActuationMetadata(inspection, metadata);
    return inspection;
  } catch (cause) {
    const error = new Error("Synthetic container desktop window inspection provider returned an invalid contract.");
    error.code = "desktop_synthetic_container_windows_contract_invalid";
    error.statusCode = 502;
    error.cause = cause;
    error.validation_errors = cause.validation_errors;
    throw error;
  }
}

async function inspectSyntheticContainerDesktopText({ descriptor = {}, env = process.env } = {}) {
  const dockerPath = String(env.SOMA_DESKTOP_REALISM_DOCKER ?? "docker");
  const args = syntheticContainerDesktopTextBrokerArgs({
    descriptor,
    env: { ...env, SOMA_DESKTOP_REALISM_TEXT_ACTUATION_METADATA: "1" },
  });
  let payload;
  try {
    const { stdout } = await execFileAsync(dockerPath, args, {
      env,
      timeout: desktopRealismTimeoutMs(env),
      maxBuffer: 1_024_000,
    });
    payload = JSON.parse(stdout);
  } catch (cause) {
    const error = new Error("Synthetic container desktop text inspection provider is unreachable.");
    error.code = "desktop_synthetic_container_text_unreachable";
    error.statusCode = 503;
    error.cause = cause;
    throw error;
  }

  try {
    const { publicPayload, metadata } = extractTextActuationMetadata({
      ...payload,
      broker_source: payload.broker_source ?? "rust_helper",
    });
    const inspection = assertDesktopTextInspectionResult(publicPayload);
    attachDesktopActuationMetadata(inspection, metadata);
    return inspection;
  } catch (cause) {
    const error = new Error("Synthetic container desktop text inspection provider returned an invalid contract.");
    error.code = "desktop_synthetic_container_text_contract_invalid";
    error.statusCode = 502;
    error.cause = cause;
    error.validation_errors = cause.validation_errors;
    throw error;
  }
}

export async function invokeDesktopActuationWithDescriptor({
  descriptor = {},
  actKind = "",
  locator = {},
  text = "",
  env = process.env,
} = {}) {
  if (descriptor.capability !== "desktop.act.invoke_action" && descriptor.capability !== "desktop.act.text_input") {
    const error = new Error("Desktop actuation descriptor capability is invalid.");
    error.code = "desktop_act_descriptor_capability_invalid";
    error.statusCode = 400;
    throw error;
  }
  if (descriptor.provider_mode !== "synthetic_container_live") {
    const error = new Error("Desktop actuation is only routed through the synthetic container provider.");
    error.code = "desktop_act_provider_mode_unsupported";
    error.statusCode = 403;
    throw error;
  }
  const dockerPath = String(env.SOMA_DESKTOP_REALISM_DOCKER ?? "docker");
  const args = syntheticContainerDesktopActBrokerArgs({ descriptor, actKind, locator, text, env });
  let payload;
  try {
    const { stdout } = await execFileAsync(dockerPath, args, {
      env: { ...env, SOMA_DESKTOP_ACT_TEXT: String(text ?? "") },
      timeout: desktopRealismTimeoutMs(env),
      maxBuffer: 512_000,
    });
    payload = JSON.parse(stdout);
  } catch (cause) {
    const error = new Error("Synthetic container desktop actuation provider is unreachable.");
    error.code = "desktop_synthetic_container_act_unreachable";
    error.statusCode = 503;
    error.cause = cause;
    throw error;
  }
  const outcome = String(payload?.outcome ?? "").trim();
  if (![
    "success",
    "provider_unavailable",
    "target_unavailable",
    "action_failed",
    "text_failed",
    "op_not_allowed",
    "bounds_exceeded",
    "contract_invalid",
  ].includes(outcome)) {
    const error = new Error("Synthetic container desktop actuation provider returned an invalid contract.");
    error.code = "desktop_synthetic_container_act_contract_invalid";
    error.statusCode = 502;
    throw error;
  }
  return { outcome };
}

function desktopRealismTimeoutMs(env = process.env) {
  const value = Number.parseInt(String(env.SOMA_DESKTOP_REALISM_TIMEOUT_MS ?? ""), 10);
  return Number.isInteger(value) && value >= 1000 ? value : DEFAULT_DESKTOP_REALISM_TIMEOUT_MS;
}

function extractWindowsActuationMetadata(payload) {
  const metadata = [];
  const publicPayload = {
    ...payload,
    windows: Array.isArray(payload.windows)
      ? payload.windows.map((window) => {
        const sanitized = sanitizeActuationNode(window);
        if (sanitized.metadata) {
          metadata.push({
            node_path: ["windows", sanitized.publicNode.index],
            role: sanitized.publicNode.role,
            window_index: sanitized.publicNode.index,
            op_class: "invoke_action",
            ...sanitized.metadata,
          });
        }
        return sanitized.publicNode;
      })
      : payload.windows,
  };
  return { publicPayload, metadata };
}

function extractTextActuationMetadata(payload) {
  const metadata = [];
  const publicPayload = {
    ...payload,
    windows: Array.isArray(payload.windows)
      ? payload.windows.map((window) => ({
        ...window,
        text_items: Array.isArray(window.text_items)
          ? window.text_items.map((item, itemIndex) => {
            const sanitized = sanitizeActuationNode(item);
            if (sanitized.metadata) {
              metadata.push({
                node_path: ["windows", window.index, "text_items", itemIndex],
                role: sanitized.publicNode.role,
                window_index: window.index,
                op_class: sanitized.metadata.act_kinds.includes("text_insert")
                  || sanitized.metadata.act_kinds.includes("text_set")
                  ? "text_input"
                  : "invoke_action",
                ...sanitized.metadata,
              });
            }
            return sanitized.publicNode;
          })
          : window.text_items,
      }))
      : payload.windows,
  };
  return { publicPayload, metadata };
}

function sanitizeActuationNode(node) {
  if (!Array.isArray(node?.act_kinds) || !isValidActKinds(node.act_kinds)) {
    return { publicNode: node, metadata: null };
  }
  if (typeof node.service !== "string" || typeof node.path !== "string") {
    return { publicNode: node, metadata: null };
  }
  const stripped = stripRawActuationFields(node);
  return {
    publicNode: {
      ...stripped.publicNode,
      act_kinds: [...new Set(node.act_kinds)],
    },
    metadata: {
      act_kinds: [...new Set(node.act_kinds)],
      locator: {
        service: node.service,
        path: node.path,
      },
    },
  };
}

function stripRawActuationFields(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return { publicNode: node, metadata: null };
  }
  const {
    service: _service,
    path: _path,
    actions: _actions,
    action_names: _actionNames,
    raw_atspi_locators: _raw,
    ...publicNode
  } = node;
  return { publicNode, metadata: null };
}

function isValidActKinds(value) {
  return value.every((entry) => typeof entry === "string" && ACT_KINDS.has(entry));
}

function attachDesktopActuationMetadata(inspection, metadata) {
  Object.defineProperty(inspection, DESKTOP_ACTUATION_METADATA, {
    value: metadata,
    enumerable: false,
    configurable: false,
  });
}

function syntheticContainerBrokerShellCommand(command, subcommand, args = []) {
  const parts = [
    "export DBUS_SESSION_BUS_ADDRESS=\"$(cat /tmp/soma-session-bus-address 2>/dev/null || true)\";",
    "exec",
    shellQuote(command),
    shellQuote(subcommand),
    ...args.map(shellQuote),
  ];
  return parts.join(" ");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
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

export async function inspectDesktopWindows({
  env = process.env,
  helperPath = env.SOMA_DESKTOP_BROKER ?? DEFAULT_HELPER_PATH,
} = {}) {
  const helperInspection = await inspectWindowsWithRustHelper(helperPath);
  if (helperInspection) {
    return assertDesktopWindowsInspectionResult(helperInspection);
  }
  return assertDesktopWindowsInspectionResult(windowsUnavailable({
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
  return assertDesktopTraversalHelperOutput(helperTraversal);
}

export function assertDesktopTraversalHelperOutput(value) {
  const result = validateDesktopTraversalOutput(value);
  if (!result.valid) {
    const error = new Error(`Desktop traversal helper output failed validation: ${result.errors.join("; ")}`);
    error.statusCode = 502;
    error.code = "desktop_traversal_helper_output_invalid";
    error.validation_errors = result.errors;
    throw error;
  }
  return value;
}

export function assertFutureDesktopTraversalHelperOutput(value) {
  return assertDesktopTraversalHelperOutput(value);
}

export function attachTraversalToDesktopInspectionResult({ inspection, traversal } = {}) {
  const validatedTraversal = assertDesktopTraversalHelperOutput(traversal);
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

async function inspectWindowsWithRustHelper(helperPath) {
  if (!helperPath || !(await isExecutable(helperPath))) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync(helperPath, ["inspect-windows"], {
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
    platform_family: process.platform,
    focus_available: false,
    focused_object: null,
    unavailable_reason: unavailableReason,
    text_content_included: false,
    withheld_fields: ["name", "description", "text", "states", "actions"],
  };
}

function windowsUnavailable({ brokerSource, env, unavailableReason }) {
  return {
    mode: "read_only_window_probe",
    broker_source: brokerSource,
    platform_family: process.platform,
    dbus_session_bus_available: Boolean(env.DBUS_SESSION_BUS_ADDRESS),
    atspi_bus_address_available: false,
    window_count: 0,
    windows: [],
    bounded: true,
    geometry_included: true,
    focus_included: true,
    identity_fields_included: false,
    text_content_included: false,
    titles_included: false,
    withheld_fields: [
      "name",
      "description",
      "text",
      "title",
      "pid",
      "process",
      "service",
      "path",
      "registry",
      "raw_atspi_locators",
      "states",
      "actions",
      "screenshots",
    ],
    unavailable_reason: unavailableReason,
  };
}

function assertFocusedDesktopInspection(result) {
  const errors = [];
  const allowedTopLevel = new Set([
    "mode",
    "broker_source",
    "platform_family",
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
  if (typeof result?.platform_family !== "string") {
    errors.push("result.platform_family must be string");
  }
  for (const forbidden of ["platform", "release", "desktop_session", "session_type"]) {
    if (Object.hasOwn(result ?? {}, forbidden)) {
      errors.push(`result.${forbidden} is not allowed`);
    }
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
        ...(Array.isArray(application.root_object.children_sample)
          ? { children_sample: application.root_object.children_sample.slice(0, maxChildren) }
          : {}),
        child_metadata_sample: Array.isArray(application.root_object.child_metadata_sample)
          ? application.root_object.child_metadata_sample.slice(0, maxChildren)
          : [],
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

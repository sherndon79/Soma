import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants as fsConstants } from "node:fs";
import path from "node:path";

import { sanitizeDisplayText } from "./textSanitization.js";

export const DESKTOP_NOTIFICATION_TITLE = "Soma: capability requested";
export const DESKTOP_NOTIFICATION_REASON_MAX_CHARS = 160;
const ACTIONABLE_RISK_CLASSES = new Set(["low", "sensitive"]);

export function createDesktopNotificationAdapter({
  enabled = isDesktopNotificationEnabled(),
  command = process.env.SOMA_DESKTOP_NOTIFY_COMMAND || "notify-send",
  actionBaseUrl = process.env.SOMA_DESKTOP_NOTIFY_ACTION_URL ?? process.env.SOMA_URL ?? "http://127.0.0.1:8765",
  timeoutMs = 1000,
  execFileFn = execFile,
  spawnFn = spawn,
  fetchFn = globalThis.fetch,
  commandExistsFn = commandExists,
} = {}) {
  return {
    async emitCapabilityProposal(proposal, context = {}) {
      if (!enabled) {
        return desktopNotificationResult({
          status: "skipped",
          reason: "disabled",
          proposal,
          context,
        });
      }

      const notification = buildCapabilityProposalDesktopNotification(proposal, context);
      if (notification.actionable) {
        try {
          if (!commandExistsFn(command)) {
            const error = new Error(`Command ${command} is not available.`);
            error.code = "ENOENT";
            throw error;
          }
          startDesktopNotificationActionWaiter({
            command,
            args: notification.args,
            spawnFn,
            fetchFn,
            actionBaseUrl,
            proposal,
            requestedScope: notification.requested_scope,
          });
          return desktopNotificationResult({
            status: "emitted",
            reason: "",
            proposal,
            context,
            notification,
            command,
          });
        } catch (error) {
          return desktopNotificationResult({
            status: "failed",
            reason: error?.code === "ENOENT" ? "notify_send_unavailable" : "notify_send_failed",
            proposal,
            context,
            notification,
            command,
            error,
          });
        }
      }

      try {
        await execFilePromise(execFileFn, command, notification.args, { timeout: timeoutMs });
        return desktopNotificationResult({
          status: "emitted",
          reason: "",
          proposal,
          context,
          notification,
          command,
        });
      } catch (error) {
        return desktopNotificationResult({
          status: "failed",
          reason: error?.code === "ENOENT" ? "notify_send_unavailable" : "notify_send_failed",
          proposal,
          context,
          notification,
          command,
          error,
        });
      }
    },
  };
}

export function buildCapabilityProposalDesktopNotification(proposal = {}, context = {}) {
  const capability = sanitizeNotificationText(proposal.capability, Number.MAX_SAFE_INTEGER) || "unknown";
  const proposalId = String(proposal.id ?? "").trim() || "proposal-id";
  const requestedScope = String(proposal.requested_scope ?? "").trim() || "session";
  const riskClass = controlledRiskClassForProposal(proposal, context);
  const catalogDefinition = capabilityDefinitionFromCatalog(context.catalog, proposal.capability);
  const actionable = ACTIONABLE_RISK_CLASSES.has(riskClass) && catalogDefinition?.reversible === true;
  const unboundedReason = sanitizeNotificationText(proposal.reason, Number.MAX_SAFE_INTEGER);
  const reason = unboundedReason.slice(0, DESKTOP_NOTIFICATION_REASON_MAX_CHARS);
  const body = [
    `capability: ${capability}`,
    `risk_class: ${riskClass}`,
    `reason: ${reason || "not provided"}`,
    actionable
      ? `approve: soma proposals approve ${proposalId} --scope ${requestedScope}`
      : `review required: soma proposals show ${proposalId}`,
  ].join("\n");
  const args = actionable
    ? [
        "--expire-time=0",
        "-A",
        "approve=Approve",
        "-A",
        "deny=Deny",
        "--",
        DESKTOP_NOTIFICATION_TITLE,
        body,
      ]
    : [
        "--",
        DESKTOP_NOTIFICATION_TITLE,
        body,
      ];

  return {
    title: DESKTOP_NOTIFICATION_TITLE,
    body,
    args,
    actionable,
    capability,
    proposal_id: proposalId,
    requested_scope: requestedScope,
    risk_class: riskClass,
    reason,
    reason_truncated: unboundedReason.length > DESKTOP_NOTIFICATION_REASON_MAX_CHARS,
  };
}

export function sanitizeNotificationText(value = "", maxChars = DESKTOP_NOTIFICATION_REASON_MAX_CHARS) {
  return sanitizeDisplayText(value, maxChars);
}

export function createDesktopNotificationProvenanceEvent(result = {}, { caller = "" } = {}) {
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: "desktop.notification.emitted",
    capability: "desktop.notification.emit",
    caller_identity: caller,
    allowed: result.status === "emitted",
    notification_status: result.status ?? "unknown",
    skip_reason: result.status === "skipped" ? result.reason ?? "" : "",
    failure_reason: result.status === "failed" ? result.reason ?? "" : "",
    source_event_type: "capability.proposal.created",
    proposal_id: result.proposal_id ?? "",
    requested_capability: result.requested_capability ?? "",
    risk_class: result.risk_class ?? "unknown",
    title_template: DESKTOP_NOTIFICATION_TITLE,
    action_waiter_started: Boolean(result.action_waiter_started),
    reason_included: Boolean(result.reason_preview),
    reason_truncated: Boolean(result.reason_truncated),
    approval_performed: false,
    activation_performed: false,
    grant_written: false,
    durable: false,
  };
}

function controlledRiskClassForProposal(proposal = {}, context = {}) {
  const catalogRisk = normalizeRiskClass(capabilityDefinitionFromCatalog(context.catalog, proposal.capability)?.risk_class);
  if (catalogRisk) {
    return catalogRisk;
  }
  return normalizeRiskClass(proposal.risk_class ?? proposal.risk);
}

function capabilityDefinitionFromCatalog(catalog = {}, capability = "") {
  const capabilities = Array.isArray(catalog.capabilities) ? catalog.capabilities : [];
  return capabilities.find((entry) => entry?.key === capability) ?? null;
}

function normalizeRiskClass(value = "") {
  const riskClass = String(value ?? "").trim();
  return ["low", "sensitive", "high"].includes(riskClass) ? riskClass : "unknown";
}

function desktopNotificationResult({
  status,
  reason,
  proposal = {},
  context = {},
  notification = null,
  command = "",
  error = null,
}) {
  const proposalId = String(proposal.id ?? "").trim();
  const requestedCapability = notification?.capability
    ?? sanitizeNotificationText(proposal.capability, Number.MAX_SAFE_INTEGER);
  const riskClass = notification?.risk_class ?? controlledRiskClassForProposal(proposal, context);
  return {
    status,
    reason,
    proposal_id: proposalId,
    requested_capability: requestedCapability,
    risk_class: riskClass,
    command,
    action_waiter_started: Boolean(notification?.actionable && status === "emitted"),
    title_template: DESKTOP_NOTIFICATION_TITLE,
    reason_preview: notification?.reason ?? "",
    reason_truncated: Boolean(notification?.reason_truncated),
    error_code: String(error?.code ?? ""),
    error_message: error ? String(error.message ?? "") : "",
  };
}

function startDesktopNotificationActionWaiter({
  command,
  args,
  spawnFn,
  fetchFn,
  actionBaseUrl,
  proposal,
  requestedScope,
}) {
  if (typeof fetchFn !== "function") {
    const error = new Error("Desktop notification action waiter requires fetch.");
    error.code = "notify_action_fetch_unavailable";
    throw error;
  }
  const child = spawnFn(command, args, {
    stdio: ["ignore", "pipe", "ignore"],
    detached: true,
  });
  let selectedAction = "";
  child.stdout?.setEncoding?.("utf8");
  child.stdout?.on?.("data", (chunk) => {
    selectedAction += chunk;
  });
  child.on?.("error", () => {});
  child.on?.("close", () => {
    void handleSelectedNotificationAction({
      selectedAction,
      fetchFn,
      actionBaseUrl,
      proposal,
      requestedScope,
    });
  });
  child.unref?.();
}

async function handleSelectedNotificationAction({
  selectedAction,
  fetchFn,
  actionBaseUrl,
  proposal,
  requestedScope,
}) {
  const action = String(selectedAction ?? "").trim();
  if (!["approve", "deny"].includes(action)) {
    return;
  }
  const proposalId = encodeURIComponent(String(proposal.id ?? ""));
  if (!proposalId) {
    return;
  }
  const path = action === "approve" ? "approve" : "deny";
  const body = action === "approve"
    ? { approved_scope: requestedScope || proposal.requested_scope || "session", decided_by: "user" }
    : { reason: "Denied from desktop notification.", decided_by: "user" };
  try {
    const response = await fetchFn(`${actionBaseUrl.replace(/\/$/, "")}/capability-proposals/${proposalId}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response?.status === 409) {
      return;
    }
  } catch {
    // Best-effort UX only. Lost action delivery must not affect proposal creation.
  }
}

function execFilePromise(execFileFn, command, args, options) {
  return new Promise((resolve, reject) => {
    execFileFn(command, args, options, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function isDesktopNotificationEnabled(env = process.env) {
  return env.SOMA_DESKTOP_NOTIFY === "1"
    || env.SOMA_DESKTOP_NOTIFY === "true"
    || env.SOMA_DESKTOP_NOTIFY === "yes";
}

function cryptoRandomId() {
  return randomUUID();
}

function commandExists(command) {
  const candidate = String(command ?? "").trim();
  if (!candidate) {
    return false;
  }
  if (candidate.includes(path.sep)) {
    return canExecute(candidate);
  }
  const pathEntries = String(process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  return pathEntries.some((entry) => canExecute(path.join(entry, candidate)));
}

function canExecute(candidate) {
  try {
    accessSync(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

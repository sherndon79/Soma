import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

export const DESKTOP_NOTIFICATION_TITLE = "Soma: capability requested";
export const DESKTOP_NOTIFICATION_REASON_MAX_CHARS = 160;

export function createDesktopNotificationAdapter({
  enabled = isDesktopNotificationEnabled(),
  command = process.env.SOMA_DESKTOP_NOTIFY_COMMAND || "notify-send",
  timeoutMs = 1000,
  execFileFn = execFile,
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
  const unboundedReason = sanitizeNotificationText(proposal.reason, Number.MAX_SAFE_INTEGER);
  const reason = unboundedReason.slice(0, DESKTOP_NOTIFICATION_REASON_MAX_CHARS);
  const body = [
    `capability: ${capability}`,
    `risk_class: ${riskClass}`,
    `reason: ${reason || "not provided"}`,
    `approve: soma proposals approve ${proposalId} --scope ${requestedScope}`,
  ].join("\n");

  return {
    title: DESKTOP_NOTIFICATION_TITLE,
    body,
    args: [
      "--",
      DESKTOP_NOTIFICATION_TITLE,
      body,
    ],
    capability,
    proposal_id: proposalId,
    risk_class: riskClass,
    reason,
    reason_truncated: unboundedReason.length > DESKTOP_NOTIFICATION_REASON_MAX_CHARS,
  };
}

export function sanitizeNotificationText(value = "", maxChars = DESKTOP_NOTIFICATION_REASON_MAX_CHARS) {
  const limit = Number.isInteger(maxChars) && maxChars > 0 ? maxChars : DESKTOP_NOTIFICATION_REASON_MAX_CHARS;
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/[<>&]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
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
    reason_included: Boolean(result.reason_preview),
    reason_truncated: Boolean(result.reason_truncated),
    approval_performed: false,
    activation_performed: false,
    grant_written: false,
    durable: false,
  };
}

function controlledRiskClassForProposal(proposal = {}, context = {}) {
  const catalogRisk = riskClassFromCatalog(context.catalog, proposal.capability);
  if (catalogRisk) {
    return catalogRisk;
  }
  return normalizeRiskClass(proposal.risk_class ?? proposal.risk);
}

function riskClassFromCatalog(catalog = {}, capability = "") {
  const capabilities = Array.isArray(catalog.capabilities) ? catalog.capabilities : [];
  const definition = capabilities.find((entry) => entry?.key === capability);
  return normalizeRiskClass(definition?.risk_class);
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
    title_template: DESKTOP_NOTIFICATION_TITLE,
    reason_preview: notification?.reason ?? "",
    reason_truncated: Boolean(notification?.reason_truncated),
    error_code: String(error?.code ?? ""),
    error_message: error ? String(error.message ?? "") : "",
  };
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

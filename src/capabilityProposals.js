import { randomUUID } from "node:crypto";

const VALID_SCOPES = new Set(["once", "session"]);

export class CapabilityProposalStore {
  constructor({ now = () => new Date() } = {}) {
    this.now = now;
    this.proposals = [];
  }

  create(input, options = {}) {
    const proposal = normalizeProposal(input, this.now, options);
    this.proposals.push(proposal);
    return proposal;
  }

  list({ status = "" } = {}) {
    const entries = [...this.proposals];
    if (!status) {
      return entries;
    }
    return entries.filter((proposal) => proposal.status === status);
  }

  notifications({ status = "pending" } = {}) {
    return this.list({ status }).map(proposalNotification);
  }

  pendingCount() {
    return this.proposals.filter((proposal) => proposal.status === "pending").length;
  }

  decide(id, input, decision) {
    if (!["approved", "denied"].includes(decision)) {
      throw validationError("decision must be approved or denied.");
    }
    const proposal = this.find(id);
    if (proposal.status !== "pending") {
      throw conflictError("Capability proposal has already been decided.");
    }
    const decidedAt = this.now().toISOString();
    const decisionRecord = decision === "approved"
      ? normalizeApproval(input, decidedAt)
      : normalizeDenial(input, decidedAt);
    proposal.status = decision;
    proposal.decision = {
      decision,
      ...decisionRecord,
      activation_performed: false,
    };
    proposal.updated_at = decidedAt;
    return proposal;
  }

  find(id) {
    const proposal = this.proposals.find((entry) => entry.id === id);
    if (!proposal) {
      const error = new Error("Capability proposal not found.");
      error.statusCode = 404;
      error.code = "capability_proposal_not_found";
      throw error;
    }
    return proposal;
  }
}

export function proposalNotification(proposal) {
  return {
    id: `notification-${proposal.id}`,
    type: "capability_proposal",
    status: proposal.status,
    title: proposal.notification?.title ?? "Capability requested",
    proposal_id: proposal.id,
    requested_by: proposal.requested_by,
    capability: proposal.capability,
    reason: proposal.reason,
    requested_scope: proposal.requested_scope,
    data_exposed: proposal.data_exposed,
    excluded_data: proposal.excluded_data,
    risk: proposal.risk,
    fallback: proposal.fallback,
    choices: [
      {
        action: "show",
        method: "GET",
        path: `/capability-proposals/${proposal.id}`,
      },
      {
        action: "approve",
        method: "POST",
        path: `/capability-proposals/${proposal.id}/approve`,
      },
      {
        action: "deny",
        method: "POST",
        path: `/capability-proposals/${proposal.id}/deny`,
      },
    ],
    created_at: proposal.created_at,
    updated_at: proposal.updated_at ?? "",
    provenance_id: proposal.provenance_id ?? "",
    activation_performed: false,
    durable: false,
  };
}

export function summarizeNotifications(notifications = []) {
  const byType = {};
  const byStatus = {};
  for (const notification of notifications) {
    byType[notification.type] = (byType[notification.type] ?? 0) + 1;
    byStatus[notification.status] = (byStatus[notification.status] ?? 0) + 1;
  }
  return {
    total: notifications.length,
    by_type: byType,
    by_status: byStatus,
  };
}

export function normalizeProposal(input, now = () => new Date(), { allowReviewMetadata = false } = {}) {
  const requestedBy = requiredString(input?.requested_by, "requested_by");
  const capability = requiredString(input?.capability, "capability");
  const reason = requiredString(input?.reason, "reason");
  const requestedScope = requiredScope(input?.requested_scope);
  const dataExposed = requiredStringArray(input?.data_exposed, "data_exposed");
  const risk = requiredString(input?.risk, "risk");
  const fallback = requiredString(input?.fallback, "fallback");
  const excludedData = optionalStringArray(input?.excluded_data, "excluded_data");
  const reviewContext = optionalReviewMetadata(input?.review_context, "review_context", allowReviewMetadata);
  const grantIntent = optionalReviewMetadata(input?.grant_intent, "grant_intent", allowReviewMetadata);

  const proposal = {
    id: randomUUID(),
    type: "capability_proposal",
    status: "pending",
    requested_by: requestedBy,
    capability,
    reason,
    requested_scope: requestedScope,
    data_exposed: dataExposed,
    excluded_data: excludedData,
    risk,
    fallback,
    notification: {
      title: "Capability requested",
      requested_by: requestedBy,
      capability,
      reason,
      requested_scope: requestedScope,
      data_exposed: dataExposed,
      excluded_data: excludedData,
      risk,
      fallback,
      choices: ["approve", "deny"],
    },
    created_at: now().toISOString(),
  };

  if (reviewContext) {
    proposal.review_context = reviewContext;
  }
  if (grantIntent) {
    proposal.grant_intent = grantIntent;
  }

  return proposal;
}

function requiredString(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw validationError(`${field} is required.`);
  }
  return normalized;
}

function requiredScope(value) {
  const normalized = requiredString(value, "requested_scope");
  if (!VALID_SCOPES.has(normalized)) {
    throw validationError("requested_scope must be once or session.");
  }
  return normalized;
}

function normalizeApproval(input, decidedAt) {
  return {
    approved_scope: requiredScope(input?.approved_scope ?? input?.scope),
    decided_by: requiredString(input?.decided_by ?? input?.approved_by ?? "user", "decided_by"),
    decided_at: decidedAt,
  };
}

function normalizeDenial(input, decidedAt) {
  return {
    denial_reason: requiredString(input?.reason, "reason"),
    decided_by: requiredString(input?.decided_by ?? input?.denied_by ?? "user", "decided_by"),
    decided_at: decidedAt,
  };
}

function requiredStringArray(value, field) {
  const normalized = optionalStringArray(value, field);
  if (normalized.length === 0) {
    throw validationError(`${field} must include at least one entry.`);
  }
  return normalized;
}

function optionalStringArray(value, field) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw validationError(`${field} must be an array.`);
  }
  return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
}

function optionalReviewMetadata(value, field, allowed) {
  if (value === undefined) {
    return null;
  }
  if (!allowed) {
    throw validationError(`${field} is not accepted on generic capability proposals.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError(`${field} must be an object.`);
  }
  return structuredClone(value);
}

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = "invalid_capability_proposal";
  return error;
}

function conflictError(message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = "capability_proposal_already_decided";
  return error;
}

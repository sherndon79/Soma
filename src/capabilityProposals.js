import { randomUUID } from "node:crypto";

const VALID_SCOPES = new Set(["once", "session"]);

export class CapabilityProposalStore {
  constructor({ now = () => new Date() } = {}) {
    this.now = now;
    this.proposals = [];
  }

  create(input) {
    const proposal = normalizeProposal(input, this.now);
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

  pendingCount() {
    return this.proposals.filter((proposal) => proposal.status === "pending").length;
  }
}

export function normalizeProposal(input, now = () => new Date()) {
  const requestedBy = requiredString(input?.requested_by, "requested_by");
  const capability = requiredString(input?.capability, "capability");
  const reason = requiredString(input?.reason, "reason");
  const requestedScope = requiredScope(input?.requested_scope);
  const dataExposed = requiredStringArray(input?.data_exposed, "data_exposed");
  const risk = requiredString(input?.risk, "risk");
  const fallback = requiredString(input?.fallback, "fallback");
  const excludedData = optionalStringArray(input?.excluded_data, "excluded_data");

  return {
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

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = "invalid_capability_proposal";
  return error;
}

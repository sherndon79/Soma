const GRANT_MUTATION_EVENT_TYPES = new Set([
  "grant.created",
  "grant.revoked",
  "grant.superseded",
  "grant.expired",
]);

export class GrantMutationProvenanceError extends Error {
  constructor(message, code = "grant_mutation_provenance_invalid") {
    super(message);
    this.name = "GrantMutationProvenanceError";
    this.code = code;
    this.statusCode = 400;
  }
}

export function createGrantCreatedProvenanceEvent({ grant } = {}) {
  const normalized = normalizeGrant(grant);
  requireGrantFields(normalized, ["id", "capability", "provider", "scope", "approved_by", "reason", "created_at"]);
  return grantMutationEvent({
    eventType: "grant.created",
    grant: normalized,
    actor: normalized.approved_by,
    reason: normalized.reason,
    timestamp: normalized.created_at,
  });
}

export function createGrantRevokedProvenanceEvent({ grant } = {}) {
  const normalized = normalizeGrant(grant);
  requireGrantFields(normalized, ["id", "capability", "provider", "scope", "revoked_by", "revocation_reason", "revoked_at"]);
  return grantMutationEvent({
    eventType: "grant.revoked",
    grant: normalized,
    actor: normalized.revoked_by,
    reason: normalized.revocation_reason,
    timestamp: normalized.revoked_at,
  });
}

export function createGrantSupersededProvenanceEvent({ grant } = {}) {
  const normalized = normalizeGrant(grant);
  requireGrantFields(normalized, [
    "id",
    "capability",
    "provider",
    "scope",
    "revoked_by",
    "revocation_reason",
    "revoked_at",
    "replacement_grant_id",
  ]);
  return grantMutationEvent({
    eventType: "grant.superseded",
    grant: normalized,
    actor: normalized.revoked_by,
    reason: normalized.revocation_reason,
    timestamp: normalized.revoked_at,
  });
}

export function createGrantExpiredProvenanceEvent({ grant } = {}) {
  const normalized = normalizeGrant(grant);
  requireGrantFields(normalized, ["id", "capability", "provider", "scope", "revoked_at"]);
  return grantMutationEvent({
    eventType: "grant.expired",
    grant: normalized,
    actor: normalized.revoked_by || "system",
    reason: normalized.revocation_reason || "Grant scope or time boundary expired.",
    timestamp: normalized.revoked_at,
  });
}

export function assertGrantMutationProvenanceEvent(event = {}) {
  if (!isPlainObject(event)) {
    throwGrantMutationProvenanceError("event must be an object");
  }
  if (!GRANT_MUTATION_EVENT_TYPES.has(event.event_type)) {
    throwGrantMutationProvenanceError("event_type must be a known grant mutation event");
  }
  requireEventFields(event, [
    "event_type",
    "grant_id",
    "capability",
    "provider",
    "scope",
    "actor",
    "reason",
    "timestamp",
  ]);
  if (event.activation_performed !== false) {
    throwGrantMutationProvenanceError("activation_performed must be false");
  }
  if (event.event_type === "grant.superseded" && !event.replacement_grant_id) {
    throwGrantMutationProvenanceError("grant.superseded requires replacement_grant_id");
  }
  return event;
}

function grantMutationEvent({ eventType, grant, actor, reason, timestamp }) {
  const event = {
    event_type: eventType,
    grant_id: grant.id,
    capability: grant.capability,
    provider: grant.provider,
    scope: grant.scope,
    actor,
    reason,
    timestamp,
    source_proposal_id: grant.source_proposal_id || grant.proposal_id || "",
    approval_provenance_id: grant.approval_provenance_id || "",
    replacement_grant_id: grant.replacement_grant_id || "",
    activation_performed: false,
  };
  return assertGrantMutationProvenanceEvent(event);
}

function normalizeGrant(grant) {
  if (!isPlainObject(grant)) {
    throwGrantMutationProvenanceError("grant must be an object");
  }
  return {
    id: stringValue(grant.id),
    capability: stringValue(grant.capability),
    provider: stringValue(grant.provider),
    scope: stringValue(grant.scope),
    approved_by: stringValue(grant.approved_by),
    reason: stringValue(grant.reason),
    created_at: stringValue(grant.created_at),
    approval_provenance_id: stringValue(grant.approval_provenance_id),
    source_proposal_id: stringValue(grant.source_proposal_id),
    proposal_id: stringValue(grant.proposal_id),
    revoked_at: stringValue(grant.revoked_at),
    revoked_by: stringValue(grant.revoked_by),
    revocation_reason: stringValue(grant.revocation_reason),
    replacement_grant_id: stringValue(grant.replacement_grant_id),
  };
}

function requireGrantFields(grant, fields) {
  const missing = fields.filter((field) => !grant[field]);
  if (missing.length > 0) {
    throwGrantMutationProvenanceError(`grant missing required field(s): ${missing.join(", ")}`);
  }
}

function requireEventFields(event, fields) {
  const missing = fields.filter((field) => !event[field]);
  if (missing.length > 0) {
    throwGrantMutationProvenanceError(`event missing required field(s): ${missing.join(", ")}`);
  }
}

function stringValue(value) {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function throwGrantMutationProvenanceError(message) {
  throw new GrantMutationProvenanceError(message);
}

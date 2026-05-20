import { normalizeGrantStore, publicGrant } from "./grants.js";

const TERMINAL_EVENT_BY_STATUS = {
  revoked: "grant.revoked",
  superseded: "grant.superseded",
  expired: "grant.expired",
};

const KNOWN_STATUSES = new Set(["active", "revoked", "superseded", "expired"]);

export function inspectGrantMutationRecovery({ store, provenanceEvents = [] } = {}) {
  const normalized = normalizeGrantStore(store);
  const events = Array.isArray(provenanceEvents) ? provenanceEvents : [];
  const findings = [];

  for (const grant of normalized.grants.map(publicGrant)) {
    findings.push(...inspectGrant(grant, events));
  }

  return {
    ok: findings.length === 0,
    degraded: findings.length > 0,
    grant_count: normalized.grants.length,
    finding_count: findings.length,
    findings,
  };
}

function inspectGrant(grant, events) {
  const findings = [];
  if (!KNOWN_STATUSES.has(grant.status)) {
    findings.push(finding("unknown_grant_status", grant, {
      status: grant.status,
    }));
    return findings;
  }

  const creationEvent = findGrantMutationEvent(events, grant, "grant.created");
  if (!creationEvent) {
    findings.push(finding("missing_grant_created_provenance", grant));
  } else {
    findings.push(...compareEventToGrant(creationEvent, grant));
  }

  if (grant.activation_performed) {
    findings.push(finding("grant_mutation_claims_activation", grant));
  }

  if (grant.status === "active") {
    return findings;
  }

  if (!grant.revoked_at) {
    findings.push(finding("terminal_grant_missing_revoked_at", grant));
  }

  const terminalEventType = TERMINAL_EVENT_BY_STATUS[grant.status];
  const terminalEvent = findGrantMutationEvent(events, grant, terminalEventType);
  if (!terminalEvent) {
    findings.push(finding("missing_terminal_grant_provenance", grant, {
      expected_event_type: terminalEventType,
    }));
  } else {
    findings.push(...compareEventToGrant(terminalEvent, grant));
  }

  if (grant.status === "superseded" && !grant.replacement_grant_id) {
    findings.push(finding("superseded_grant_missing_replacement", grant));
  }

  return findings;
}

function findGrantMutationEvent(events, grant, eventType) {
  return events.find((event) => (
    event?.event_type === eventType
    && event?.grant_id === grant.id
  )) ?? null;
}

function compareEventToGrant(event, grant) {
  const findings = [];
  for (const field of ["capability", "provider", "scope"]) {
    if (String(event[field] ?? "") !== String(grant[field] ?? "")) {
      findings.push(finding("grant_provenance_metadata_mismatch", grant, {
        event_type: event.event_type,
        field,
        grant_value: String(grant[field] ?? ""),
        event_value: String(event[field] ?? ""),
      }));
    }
  }

  if (event.activation_performed !== false) {
    findings.push(finding("grant_provenance_claims_activation", grant, {
      event_type: event.event_type,
    }));
  }

  if (event.event_type === "grant.created") {
    compareCreatedEvent(findings, event, grant);
  }
  if (event.event_type === "grant.revoked" || event.event_type === "grant.superseded"
    || event.event_type === "grant.expired") {
    compareTerminalEvent(findings, event, grant);
  }
  return findings;
}

function compareCreatedEvent(findings, event, grant) {
  if (String(event.actor ?? "") !== grant.approved_by) {
    findings.push(finding("grant_provenance_metadata_mismatch", grant, {
      event_type: event.event_type,
      field: "actor",
      grant_value: grant.approved_by,
      event_value: String(event.actor ?? ""),
    }));
  }
  if (String(event.reason ?? "") !== grant.reason) {
    findings.push(finding("grant_provenance_metadata_mismatch", grant, {
      event_type: event.event_type,
      field: "reason",
      grant_value: grant.reason,
      event_value: String(event.reason ?? ""),
    }));
  }
  if (String(event.timestamp ?? "") !== grant.created_at) {
    findings.push(finding("grant_provenance_metadata_mismatch", grant, {
      event_type: event.event_type,
      field: "timestamp",
      grant_value: grant.created_at,
      event_value: String(event.timestamp ?? ""),
    }));
  }
}

function compareTerminalEvent(findings, event, grant) {
  if (String(event.actor ?? "") !== grant.revoked_by) {
    findings.push(finding("grant_provenance_metadata_mismatch", grant, {
      event_type: event.event_type,
      field: "actor",
      grant_value: grant.revoked_by,
      event_value: String(event.actor ?? ""),
    }));
  }
  if (String(event.reason ?? "") !== grant.revocation_reason) {
    findings.push(finding("grant_provenance_metadata_mismatch", grant, {
      event_type: event.event_type,
      field: "reason",
      grant_value: grant.revocation_reason,
      event_value: String(event.reason ?? ""),
    }));
  }
  if (String(event.timestamp ?? "") !== String(grant.revoked_at ?? "")) {
    findings.push(finding("grant_provenance_metadata_mismatch", grant, {
      event_type: event.event_type,
      field: "timestamp",
      grant_value: String(grant.revoked_at ?? ""),
      event_value: String(event.timestamp ?? ""),
    }));
  }
  if (event.event_type === "grant.superseded"
    && String(event.replacement_grant_id ?? "") !== grant.replacement_grant_id) {
    findings.push(finding("grant_provenance_metadata_mismatch", grant, {
      event_type: event.event_type,
      field: "replacement_grant_id",
      grant_value: grant.replacement_grant_id,
      event_value: String(event.replacement_grant_id ?? ""),
    }));
  }
}

function finding(code, grant, details = {}) {
  return {
    code,
    grant_id: grant.id,
    status: grant.status,
    capability: grant.capability,
    provider: grant.provider,
    scope: grant.scope,
    authorizing_safe: false,
    ...details,
  };
}

import assert from "node:assert/strict";
import test from "node:test";

import {
  GrantMutationProvenanceError,
  assertGrantMutationProvenanceEvent,
  createGrantCreatedProvenanceEvent,
  createGrantExpiredProvenanceEvent,
  createGrantRevokedProvenanceEvent,
  createGrantSupersededProvenanceEvent,
} from "../src/grantMutationProvenance.js";

const activeGrant = {
  id: "grant-created",
  status: "active",
  capability: "desktop.inspect.focus",
  provider: "soma.provider.desktop-broker",
  scope: "session",
  constraints: {
    include_text: false,
    payload_bytes: "must not be copied",
  },
  approved_by: "user",
  approval_provenance_id: "prov-approval",
  source_proposal_id: "proposal-focus",
  reason: "Inspect the focused desktop object for this session.",
  created_at: "2026-05-20T12:00:00.000Z",
  activation_performed: true,
};

test("grant.created provenance contains authority metadata without activating capability", () => {
  const event = createGrantCreatedProvenanceEvent({ grant: activeGrant });

  assert.deepEqual(event, {
    event_type: "grant.created",
    grant_id: "grant-created",
    capability: "desktop.inspect.focus",
    provider: "soma.provider.desktop-broker",
    scope: "session",
    actor: "user",
    reason: "Inspect the focused desktop object for this session.",
    timestamp: "2026-05-20T12:00:00.000Z",
    source_proposal_id: "proposal-focus",
    approval_provenance_id: "prov-approval",
    replacement_grant_id: "",
    activation_performed: false,
  });
});

test("grant.created provenance accepts direct user action without separate approval id", () => {
  const event = createGrantCreatedProvenanceEvent({
    grant: {
      ...activeGrant,
      approval_provenance_id: "",
      source_proposal_id: "",
    },
  });

  assert.equal(event.event_type, "grant.created");
  assert.equal(event.actor, "user");
  assert.equal(event.approval_provenance_id, "");
  assert.equal(event.source_proposal_id, "");
  assert.equal(event.activation_performed, false);
});

test("grant.revoked provenance records revocation metadata without constraints or payloads", () => {
  const event = createGrantRevokedProvenanceEvent({
    grant: {
      ...activeGrant,
      status: "revoked",
      revoked_at: "2026-05-20T12:30:00.000Z",
      revoked_by: "user",
      revocation_reason: "No longer needed.",
    },
  });

  assert.equal(event.event_type, "grant.revoked");
  assert.equal(event.actor, "user");
  assert.equal(event.reason, "No longer needed.");
  assert.equal(event.timestamp, "2026-05-20T12:30:00.000Z");
  assert.equal(event.activation_performed, false);
  assert.equal(JSON.stringify(event).includes("payload_bytes"), false);
  assert.equal(JSON.stringify(event).includes("constraints"), false);
});

test("grant.superseded provenance links source and replacement grants", () => {
  const event = createGrantSupersededProvenanceEvent({
    grant: {
      ...activeGrant,
      status: "superseded",
      revoked_at: "2026-05-20T12:45:00.000Z",
      revoked_by: "user",
      revocation_reason: "Replace with narrower scope.",
      replacement_grant_id: "grant-replacement",
    },
  });

  assert.equal(event.event_type, "grant.superseded");
  assert.equal(event.grant_id, "grant-created");
  assert.equal(event.replacement_grant_id, "grant-replacement");
  assert.equal(event.activation_performed, false);
});

test("grant.expired provenance records system expiration without user revocation", () => {
  const event = createGrantExpiredProvenanceEvent({
    grant: {
      ...activeGrant,
      status: "expired",
      revoked_at: "2026-05-20T13:00:00.000Z",
      revoked_by: "system",
      revocation_reason: "Grant scope or time boundary expired.",
    },
  });

  assert.equal(event.event_type, "grant.expired");
  assert.equal(event.actor, "system");
  assert.equal(event.reason, "Grant scope or time boundary expired.");
  assert.equal(event.activation_performed, false);
});

test("grant mutation provenance validator rejects malformed events", () => {
  assert.throws(
    () => assertGrantMutationProvenanceEvent({
      event_type: "grant.created",
      grant_id: "grant-created",
      capability: "desktop.inspect.focus",
      provider: "soma.provider.desktop-broker",
      scope: "session",
      actor: "user",
      reason: "Approved.",
      timestamp: "2026-05-20T12:00:00.000Z",
      approval_provenance_id: "prov-approval",
      activation_performed: true,
    }),
    (error) => error instanceof GrantMutationProvenanceError
      && error.message.includes("activation_performed must be false"),
  );

  assert.throws(
    () => createGrantSupersededProvenanceEvent({
      grant: {
        ...activeGrant,
        revoked_at: "2026-05-20T12:45:00.000Z",
        revoked_by: "user",
        revocation_reason: "Replace with narrower scope.",
      },
    }),
    (error) => error instanceof GrantMutationProvenanceError
      && error.message.includes("replacement_grant_id"),
  );
});

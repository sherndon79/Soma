import assert from "node:assert/strict";
import test from "node:test";

import {
  createGrantCreatedProvenanceEvent,
  createGrantRevokedProvenanceEvent,
  createGrantSupersededProvenanceEvent,
} from "../src/grantMutationProvenance.js";
import { inspectGrantMutationRecovery } from "../src/grantMutationRecovery.js";

const activeGrant = {
  id: "grant-active",
  status: "active",
  capability: "desktop.inspect.focus",
  provider: "soma.provider.desktop-broker",
  scope: "session",
  constraints: { include_text: false },
  approved_by: "user",
  approval_provenance_id: "approval-active",
  reason: "Inspect the focused desktop object for this session.",
  created_at: "2026-05-20T12:00:00.000Z",
  review_required: false,
  revoked_at: null,
  revoked_by: "",
  revocation_reason: "",
  replacement_grant_id: "",
  activation_performed: false,
};

const revokedGrant = {
  ...activeGrant,
  id: "grant-revoked",
  status: "revoked",
  revoked_at: "2026-05-20T12:30:00.000Z",
  revoked_by: "user",
  revocation_reason: "Focused inspection no longer needed.",
};

const replacementGrant = {
  ...activeGrant,
  id: "grant-replacement",
  reason: "Narrower replacement grant.",
  created_at: "2026-05-20T12:40:00.000Z",
};

const supersededGrant = {
  ...activeGrant,
  id: "grant-superseded",
  status: "superseded",
  revoked_at: "2026-05-20T12:45:00.000Z",
  revoked_by: "user",
  revocation_reason: "Replace with narrower grant.",
  replacement_grant_id: "grant-replacement",
};

test("grant mutation recovery inspector accepts matching creation and terminal provenance", () => {
  const report = inspectGrantMutationRecovery({
    store: {
      schema_version: 1,
      grants: [activeGrant, revokedGrant, replacementGrant, supersededGrant],
      examples: [],
    },
    provenanceEvents: [
      createGrantCreatedProvenanceEvent({ grant: activeGrant }),
      createGrantCreatedProvenanceEvent({ grant: revokedGrant }),
      createGrantRevokedProvenanceEvent({ grant: revokedGrant }),
      createGrantCreatedProvenanceEvent({ grant: replacementGrant }),
      createGrantCreatedProvenanceEvent({ grant: supersededGrant }),
      createGrantSupersededProvenanceEvent({ grant: supersededGrant }),
    ],
  });

  assert.equal(report.ok, true);
  assert.equal(report.degraded, false);
  assert.equal(report.finding_count, 0);
  assert.deepEqual(report.findings, []);
});

test("grant mutation recovery inspector detects missing creation provenance", () => {
  const report = inspectGrantMutationRecovery({
    store: {
      schema_version: 1,
      grants: [activeGrant],
      examples: [],
    },
    provenanceEvents: [],
  });

  assert.equal(report.ok, false);
  assert.equal(report.degraded, true);
  assert.deepEqual(report.findings.map((finding) => finding.code), [
    "missing_grant_created_provenance",
  ]);
  assert.equal(report.findings[0].authorizing_safe, false);
});

test("grant mutation recovery inspector detects terminal provenance gaps", () => {
  const report = inspectGrantMutationRecovery({
    store: {
      schema_version: 1,
      grants: [revokedGrant],
      examples: [],
    },
    provenanceEvents: [
      createGrantCreatedProvenanceEvent({ grant: revokedGrant }),
    ],
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.findings.map((finding) => finding.code), [
    "missing_terminal_grant_provenance",
  ]);
  assert.equal(report.findings[0].expected_event_type, "grant.revoked");
});

test("grant mutation recovery inspector detects metadata mismatch without trusting authority", () => {
  const report = inspectGrantMutationRecovery({
    store: {
      schema_version: 1,
      grants: [activeGrant],
      examples: [],
    },
    provenanceEvents: [
      {
        ...createGrantCreatedProvenanceEvent({ grant: activeGrant }),
        capability: "desktop.inspect.text",
      },
    ],
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.findings.map((finding) => finding.code), [
    "grant_provenance_metadata_mismatch",
  ]);
  assert.equal(report.findings[0].field, "capability");
  assert.equal(report.findings[0].grant_value, "desktop.inspect.focus");
  assert.equal(report.findings[0].event_value, "desktop.inspect.text");
  assert.equal(report.findings[0].authorizing_safe, false);
});

test("grant mutation recovery inspector rejects activation claims and malformed statuses", () => {
  const report = inspectGrantMutationRecovery({
    store: {
      schema_version: 1,
      grants: [
        {
          ...activeGrant,
          activation_performed: true,
        },
        {
          ...activeGrant,
          id: "grant-unknown-status",
          status: "paused",
        },
      ],
      examples: [],
    },
    provenanceEvents: [
      createGrantCreatedProvenanceEvent({ grant: activeGrant }),
      {
        ...createGrantCreatedProvenanceEvent({
          grant: { ...activeGrant, id: "grant-unknown-status", status: "paused" },
        }),
        grant_id: "grant-unknown-status",
      },
    ],
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.findings.map((finding) => finding.code), [
    "grant_mutation_claims_activation",
    "unknown_grant_status",
  ]);
});

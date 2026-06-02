import assert from "node:assert/strict";
import test from "node:test";

import { authorizeGrantUse, recoveryFindingsForGrant } from "../src/grantAuthorization.js";
import { createGrantCreatedProvenanceEvent } from "../src/grantMutationProvenance.js";
import { inspectGrantMutationRecovery } from "../src/grantMutationRecovery.js";

const activeGrant = {
  id: "grant-active",
  status: "active",
  capability: "desktop.inspect.focus",
  provider: "soma.provider.desktop-broker",
  scope: "session",
  constraints: {},
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

const catalog = {
  capabilities: [
    { key: "desktop.inspect.focus" },
  ],
};

const providerRegistry = {
  providers: [
    {
      id: "soma.provider.desktop-broker",
      capabilities: ["desktop.inspect.focus"],
    },
  ],
};

test("grant authorization allows active grants with clean recovery provenance", () => {
  const store = {
    schema_version: 1,
    grants: [activeGrant],
  };
  const recoveryReport = inspectGrantMutationRecovery({
    store,
    provenanceEvents: [
      createGrantCreatedProvenanceEvent({ grant: activeGrant }),
    ],
  });

  const decision = authorizeGrantUse({
    store,
    capability: "desktop.inspect.focus",
    provider: "soma.provider.desktop-broker",
    scope: "session",
    recoveryReport,
    catalog,
    providerRegistry,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.code, "grant_authorized");
  assert.equal(decision.grant.id, "grant-active");
  assert.equal(decision.recovery_required, false);
});

test("grant authorization fails closed when matching grant has recovery findings", () => {
  const store = {
    schema_version: 1,
    grants: [activeGrant],
  };
  const recoveryReport = inspectGrantMutationRecovery({
    store,
    provenanceEvents: [],
  });

  const decision = authorizeGrantUse({
    store,
    capability: "desktop.inspect.focus",
    provider: "soma.provider.desktop-broker",
    scope: "session",
    recoveryReport,
    catalog,
    providerRegistry,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "grant_recovery_degraded");
  assert.equal(decision.recovery_required, true);
  assert.deepEqual(decision.findings.map((finding) => finding.code), [
    "missing_grant_created_provenance",
  ]);
});

test("grant authorization ignores recovery findings for unrelated grants", () => {
  const degradedGrant = {
    ...activeGrant,
    id: "grant-degraded",
    capability: "desktop.inspect.windows",
  };
  const store = {
    schema_version: 1,
    grants: [activeGrant, degradedGrant],
  };
  const recoveryReport = inspectGrantMutationRecovery({
    store,
    provenanceEvents: [
      createGrantCreatedProvenanceEvent({ grant: activeGrant }),
    ],
  });

  const decision = authorizeGrantUse({
    store,
    capability: "desktop.inspect.focus",
    provider: "soma.provider.desktop-broker",
    scope: "session",
    recoveryReport,
    catalog,
    providerRegistry,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.grant.id, "grant-active");
  assert.equal(decision.recovery_required, false);
});

test("grant authorization denies a forged grant while a legitimate grant beside it authorizes", () => {
  const forgedGrant = {
    ...activeGrant,
    id: "grant-forged",
    approval_provenance_id: "approval-forged",
    created_at: "2026-05-20T12:05:00.000Z",
  };
  const store = {
    schema_version: 1,
    grants: [activeGrant, forgedGrant],
  };
  const recoveryReport = inspectGrantMutationRecovery({
    store,
    provenanceEvents: [
      createGrantCreatedProvenanceEvent({ grant: activeGrant }),
    ],
  });

  const forgedDecision = authorizeGrantUse({
    store,
    grantId: "grant-forged",
    capability: "desktop.inspect.focus",
    provider: "soma.provider.desktop-broker",
    scope: "session",
    recoveryReport,
    catalog,
    providerRegistry,
  });
  assert.equal(forgedDecision.allowed, false);
  assert.equal(forgedDecision.code, "grant_recovery_degraded");
  assert.deepEqual(forgedDecision.findings.map((finding) => finding.code), [
    "missing_grant_created_provenance",
  ]);

  const legitimateDecision = authorizeGrantUse({
    store,
    grantId: "grant-active",
    capability: "desktop.inspect.focus",
    provider: "soma.provider.desktop-broker",
    scope: "session",
    recoveryReport,
    catalog,
    providerRegistry,
  });
  assert.equal(legitimateDecision.allowed, true);
  assert.equal(legitimateDecision.grant.id, "grant-active");
});

test("grant authorization fails closed for global corrupt-store recovery findings", () => {
  const decision = authorizeGrantUse({
    store: { schema_version: 1, grants: [] },
    grantId: "grant-from-corrupt-store",
    capability: "desktop.inspect.focus",
    provider: "soma.provider.desktop-broker",
    scope: "session",
    recoveryReport: {
      ok: false,
      degraded: true,
      findings: [
        {
          code: "grant_store_unreadable",
          grant_id: "",
          authorizing_safe: false,
        },
      ],
    },
    catalog,
    providerRegistry,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "grant_recovery_degraded");
  assert.equal(decision.recovery_required, true);
  assert.equal(decision.findings[0].code, "grant_store_unreadable");
});

test("grant authorization rejects unknown status and absent active grants", () => {
  const decision = authorizeGrantUse({
    store: {
      schema_version: 1,
      grants: [
        { ...activeGrant, status: "paused" },
      ],
    },
    capability: "desktop.inspect.focus",
    provider: "soma.provider.desktop-broker",
    scope: "session",
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "grant_not_found");
});

test("grant authorization rejects newer grant-store schema versions", () => {
  const decision = authorizeGrantUse({
    store: {
      schema_version: 2,
      grants: [activeGrant],
    },
    capability: "desktop.inspect.focus",
    provider: "soma.provider.desktop-broker",
    scope: "session",
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "grant_store_schema_unsupported");
  assert.equal(decision.details.supported_schema_version, 1);
});

test("grant authorization can target a specific grant id", () => {
  const replacementGrant = {
    ...activeGrant,
    id: "grant-other",
  };
  const decision = authorizeGrantUse({
    store: {
      schema_version: 1,
      grants: [replacementGrant, activeGrant],
    },
    grantId: "grant-active",
    capability: "desktop.inspect.focus",
    provider: "soma.provider.desktop-broker",
    scope: "session",
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.grant.id, "grant-active");
});

test("grant authorization checks catalog and provider support when supplied", () => {
  const cleanRecovery = inspectGrantMutationRecovery({
    store: { schema_version: 1, grants: [activeGrant] },
    provenanceEvents: [createGrantCreatedProvenanceEvent({ grant: activeGrant })],
  });

  const missingCapability = authorizeGrantUse({
    store: { schema_version: 1, grants: [activeGrant] },
    capability: "desktop.inspect.focus",
    provider: "soma.provider.desktop-broker",
    scope: "session",
    recoveryReport: cleanRecovery,
    catalog: { capabilities: [] },
    providerRegistry,
  });
  assert.equal(missingCapability.allowed, false);
  assert.equal(missingCapability.code, "grant_capability_not_in_catalog");

  const mismatchedProvider = authorizeGrantUse({
    store: { schema_version: 1, grants: [activeGrant] },
    capability: "desktop.inspect.focus",
    provider: "soma.provider.desktop-broker",
    scope: "session",
    recoveryReport: cleanRecovery,
    catalog,
    providerRegistry: {
      providers: [
        { id: "soma.provider.desktop-broker", capabilities: ["desktop.inspect.windows"] },
      ],
    },
  });
  assert.equal(mismatchedProvider.allowed, false);
  assert.equal(mismatchedProvider.code, "grant_provider_capability_mismatch");
});

test("recoveryFindingsForGrant filters findings by grant id", () => {
  const recoveryReport = {
    findings: [
      { grant_id: "grant-a", code: "missing_grant_created_provenance" },
      { grant_id: "grant-b", code: "grant_provenance_metadata_mismatch" },
    ],
  };

  assert.deepEqual(recoveryFindingsForGrant(recoveryReport, "grant-b"), [
    { grant_id: "grant-b", code: "grant_provenance_metadata_mismatch" },
  ]);
});

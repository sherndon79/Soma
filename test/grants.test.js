import assert from "node:assert/strict";
import test from "node:test";

import {
  GrantMutationError,
  createGrant,
  expireGrant,
  revokeGrant,
  supersedeGrant,
  validateGrantCreate,
} from "../src/grants.js";

const catalog = {
  schema_version: 1,
  capabilities: [
    {
      key: "desktop.inspect.focus",
      activation_policy: "explicit_grant",
      allowed_scopes: ["session"],
    },
    {
      key: "desktop.inspect.text",
      activation_policy: "explicit_grant",
      allowed_scopes: ["session"],
    },
  ],
};

const providerRegistry = {
  schema_version: 1,
  providers: [
    {
      id: "soma.provider.desktop-broker",
      capabilities: [
        { key: "desktop.inspect.focus" },
        { key: "desktop.inspect.text" },
      ],
    },
    {
      id: "soma.provider.local-model",
      capabilities: ["model.local.chat"],
    },
  ],
};

const context = {
  catalog,
  providerRegistry,
  now: () => "2026-05-10T12:00:00.000Z",
  createId: () => "grant-created",
};

const createInput = {
  capability: "desktop.inspect.focus",
  provider: "soma.provider.desktop-broker",
  scope: "session",
  constraints: { include_text: false },
  approved_by: "user",
  approval_provenance_id: "prov-approval",
  reason: "Inspect the focused desktop object for this session.",
};

const baseStore = {
  schema_version: 1,
  grants: [
    {
      id: "grant-active",
      status: "active",
      capability: "desktop.inspect.focus",
      provider: "soma.provider.desktop-broker",
      scope: "session",
      constraints: { include_text: false },
      approved_by: "user",
      approval_provenance_id: "prov-existing",
      reason: "Existing focused inspection grant.",
      created_at: "2026-05-10T11:00:00.000Z",
      activation_performed: false,
    },
    {
      id: "grant-revoked",
      status: "revoked",
      capability: "desktop.inspect.text",
      provider: "soma.provider.desktop-broker",
      scope: "session",
      constraints: {},
      approved_by: "user",
      reason: "Previously approved text grant.",
      created_at: "2026-05-10T10:00:00.000Z",
      revoked_at: "2026-05-10T10:30:00.000Z",
      revoked_by: "user",
      revocation_reason: "No longer needed.",
      activation_performed: false,
    },
    {
      id: "grant-replacement",
      status: "active",
      capability: "desktop.inspect.focus",
      provider: "soma.provider.desktop-broker",
      scope: "session",
      constraints: { include_text: false, max_depth: 0 },
      approved_by: "user",
      reason: "Narrower replacement.",
      created_at: "2026-05-10T11:30:00.000Z",
      activation_performed: false,
    },
  ],
};

test("validateGrantCreate accepts explicit user-approved catalog/provider grant input", () => {
  const grant = validateGrantCreate(createInput, context);

  assert.equal(grant.id, "grant-created");
  assert.equal(grant.status, "active");
  assert.equal(grant.capability, "desktop.inspect.focus");
  assert.equal(grant.provider, "soma.provider.desktop-broker");
  assert.equal(grant.approved_by, "user");
  assert.equal(grant.approval_provenance_id, "prov-approval");
  assert.equal(grant.activation_performed, false);
  assert.equal(grant.created_at, "2026-05-10T12:00:00.000Z");
});

test("validateGrantCreate rejects unknown capabilities", () => {
  assertGrantError(
    () => validateGrantCreate({ ...createInput, capability: "desktop.inspect.unknown" }, context),
    "unknown_capability",
  );
});

test("validateGrantCreate rejects unsupported providers", () => {
  assertGrantError(
    () => validateGrantCreate({ ...createInput, provider: "soma.provider.local-model" }, context),
    "unsupported_provider_capability",
  );
});

test("validateGrantCreate rejects missing user decision", () => {
  assertGrantError(
    () => validateGrantCreate({ ...createInput, approval_provenance_id: "" }, context),
    "missing_user_decision",
  );
});

test("validateGrantCreate rejects non-user actors", () => {
  assertGrantError(
    () => validateGrantCreate({ ...createInput, approved_by: "model" }, context),
    "missing_user_actor",
  );
});

test("validateGrantCreate rejects malformed constraints", () => {
  assertGrantError(
    () => validateGrantCreate({ ...createInput, constraints: ["include_text"] }, context),
    "invalid_constraints",
  );
});

test("createGrant appends an inactive authority record without mutating input", () => {
  const result = createGrant(
    { schema_version: 1, grants: [] },
    createInput,
    context,
  );

  assert.equal(result.grants.length, 1);
  assert.equal(result.grants[0].id, "grant-created");
  assert.equal(result.grants[0].activation_performed, false);
  assert.equal(result.grants[0].approval_provenance_id, "prov-approval");
});

test("createGrant rejects duplicate grant ids", () => {
  assertGrantError(
    () => createGrant(baseStore, { ...createInput, id: "grant-active" }, context),
    "duplicate_grant_id",
  );
});

test("revokeGrant marks active grants revoked and preserves inspectable metadata", () => {
  const result = revokeGrant(baseStore, {
    id: "grant-active",
    actor: "user",
    reason: "Focused inspection no longer needed.",
  }, context);
  const grant = result.grants.find((candidate) => candidate.id === "grant-active");

  assert.equal(result.mutation.changed, true);
  assert.equal(grant.status, "revoked");
  assert.equal(grant.revoked_at, "2026-05-10T12:00:00.000Z");
  assert.equal(grant.revoked_by, "user");
  assert.equal(grant.revocation_reason, "Focused inspection no longer needed.");
  assert.equal(grant.activation_performed, false);
});

test("revokeGrant is idempotent for already revoked grants", () => {
  const result = revokeGrant(baseStore, {
    id: "grant-revoked",
    actor: "user",
    reason: "Second revoke should not rewrite history.",
  }, context);
  const grant = result.grants.find((candidate) => candidate.id === "grant-revoked");

  assert.equal(result.mutation.changed, false);
  assert.equal(grant.status, "revoked");
  assert.equal(grant.revoked_at, "2026-05-10T10:30:00.000Z");
  assert.equal(grant.revocation_reason, "No longer needed.");
});

test("supersedeGrant links an active grant to an existing replacement", () => {
  const result = supersedeGrant(baseStore, {
    id: "grant-active",
    replacement_grant_id: "grant-replacement",
    actor: "user",
    reason: "Replace with a narrower grant.",
  }, context);
  const grant = result.grants.find((candidate) => candidate.id === "grant-active");

  assert.equal(result.mutation.changed, true);
  assert.equal(grant.status, "superseded");
  assert.equal(grant.replacement_grant_id, "grant-replacement");
  assert.equal(grant.revocation_reason, "Replace with a narrower grant.");
});

test("supersedeGrant rejects unknown replacement grants", () => {
  assertGrantError(
    () => supersedeGrant(baseStore, {
      id: "grant-active",
      replacement_grant_id: "grant-missing",
      actor: "user",
      reason: "Replacement must exist.",
    }, context),
    "unknown_replacement_grant",
  );
});

test("expireGrant marks active grants expired without user activation", () => {
  const result = expireGrant(baseStore, { id: "grant-active" }, context);
  const grant = result.grants.find((candidate) => candidate.id === "grant-active");

  assert.equal(result.mutation.changed, true);
  assert.equal(grant.status, "expired");
  assert.equal(grant.revoked_by, "system");
  assert.equal(grant.activation_performed, false);
});

function assertGrantError(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error instanceof GrantMutationError, true);
    assert.equal(error.code, code);
    return true;
  });
}

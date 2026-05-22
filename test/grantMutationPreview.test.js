import test from "node:test";
import assert from "node:assert/strict";

import { previewGrantMutation } from "../src/grantMutationPreview.js";

const catalog = {
  schema_version: 1,
  capabilities: [
    {
      key: "desktop.inspect.focus",
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
      capabilities: [{ key: "desktop.inspect.focus" }],
    },
  ],
};

const context = {
  catalog,
  providerRegistry,
  now: () => "2026-05-21T12:00:00.000Z",
  createId: () => "grant-preview-created",
};

const createInput = {
  capability: "desktop.inspect.focus",
  provider: "soma.provider.desktop-broker",
  scope: "session",
  constraints: { include_text: false },
  approved_by: "user",
  direct_user_action: true,
  reason: "Preview focused inspection authority.",
};

const activeGrant = {
  id: "grant-active",
  status: "active",
  capability: "desktop.inspect.focus",
  provider: "soma.provider.desktop-broker",
  scope: "session",
  constraints: { include_text: false },
  approved_by: "user",
  approval_provenance_id: "approval-active",
  reason: "Existing focused inspection grant.",
  created_at: "2026-05-21T11:00:00.000Z",
  review_required: false,
  revoked_at: null,
  revoked_by: "",
  revocation_reason: "",
  replacement_grant_id: "",
  activation_performed: false,
};

test("previewGrantMutation previews durable create without writing or activation", () => {
  const store = { schema_version: 1, grants: [], examples: [] };
  const result = previewGrantMutation({
    store,
    kind: "grant.created",
    input: createInput,
    context,
    mutationId: "mutation-preview-create",
  });

  assert.equal(result.ok, true);
  assert.equal(result.dry_run, true);
  assert.equal(result.grant.id, "grant-preview-created");
  assert.equal(result.event.event_type, "grant.created");
  assert.equal(result.event.activation_performed, false);
  assert.equal(result.receipt_preview.status, "preview");
  assert.equal(result.receipt_preview.grant_store_committed, false);
  assert.equal(result.receipt_preview.provenance_appended, false);
  assert.equal(result.next_store_summary.grant_count, 1);
  assert.equal(result.next_store_summary.changed, true);
  assert.equal(result.durable, false);
  assert.equal(result.grant_written, false);
  assert.equal(result.provenance_appended, false);
  assert.equal(result.activation_performed, false);
  assert.equal(store.grants.length, 0);
});

test("previewGrantMutation previews durable revoke without mutating the source store", () => {
  const store = { schema_version: 1, grants: [activeGrant], examples: [] };
  const result = previewGrantMutation({
    store,
    kind: "grant.revoked",
    input: {
      id: "grant-active",
      actor: "user",
      reason: "Preview revocation.",
    },
    context,
    mutationId: "mutation-preview-revoke",
  });

  assert.equal(result.ok, true);
  assert.equal(result.grant.id, "grant-active");
  assert.equal(result.grant.status, "revoked");
  assert.equal(result.event.event_type, "grant.revoked");
  assert.equal(result.event.reason, "Preview revocation.");
  assert.equal(result.next_store_summary.changed, true);
  assert.equal(result.receipt_preview.status, "preview");
  assert.equal(result.grant_written, false);
  assert.equal(store.grants[0].status, "active");
});

test("previewGrantMutation reports validation failures without write-shaped success", () => {
  const result = previewGrantMutation({
    store: { schema_version: 1, grants: [], examples: [] },
    kind: "grant.created",
    input: {
      ...createInput,
      provider: "missing-provider",
    },
    context,
    mutationId: "mutation-preview-invalid",
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "unknown_provider");
  assert.equal(result.receipt_preview.status, "failed");
  assert.equal(result.receipt_preview.grant_store_committed, false);
  assert.equal(result.receipt_preview.provenance_appended, false);
  assert.equal(result.grant_written, false);
  assert.equal(result.activation_performed, false);
});

test("previewGrantMutation rejects unsupported preview kinds", () => {
  const result = previewGrantMutation({
    store: { schema_version: 1, grants: [activeGrant], examples: [] },
    kind: "grant.superseded",
    input: {},
    context,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "grant_mutation_preview_unsupported_kind");
  assert.equal(result.receipt_preview.mutation_kind, "grant.superseded");
  assert.equal(result.grant_written, false);
});

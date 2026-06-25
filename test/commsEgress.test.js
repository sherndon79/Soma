import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";

import {
  COMMS_FIXTURE_PROVIDER_ID,
  COMMS_FIXTURE_SEND_CAPABILITY,
  applyCommsFixtureSend,
  buildCommsSendPlan,
  createCommsDraftArtifact,
  createCommsFixtureProvider,
  finalBodyForDraft,
  renderRecipientVisibleMark,
} from "../src/commsEgress.js";
import {
  createLocalConfirmationAuthority,
  createTrustedLocalConfirmationAdapter,
} from "../src/localConfirmationAuthority.js";

const NOW = 1_800_000_000_000;

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function activeGrantStore() {
  return {
    schema_version: 1,
    grants: [
      {
        id: "grant-comms-fixture",
        status: "active",
        capability: COMMS_FIXTURE_SEND_CAPABILITY,
        provider: COMMS_FIXTURE_PROVIDER_ID,
        scope: "session",
        constraints: {},
        approved_by: "user",
        reason: "Allow fixture-only egress testing.",
        created_at: "2026-06-23T19:00:00.000Z",
        activation_performed: false,
      },
    ],
  };
}

function catalogAndRegistry() {
  return {
    catalog: {
      schema_version: 1,
      capabilities: [{ key: COMMS_FIXTURE_SEND_CAPABILITY }],
    },
    providerRegistry: {
      schema_version: 1,
      providers: [
        {
          id: COMMS_FIXTURE_PROVIDER_ID,
          capabilities: [COMMS_FIXTURE_SEND_CAPABILITY],
        },
      ],
    },
  };
}

function confirmationForPlan(plan) {
  const adapter = createTrustedLocalConfirmationAdapter({
    now: () => NOW,
    secret: Buffer.alloc(32, 5),
  });
  const authority = createLocalConfirmationAuthority({
    now: () => NOW,
    random: () => "abc123abc123abc123abc123",
    verifyTrustedAttestation: adapter.verifier,
  });
  const attestation = adapter.attest({
    plan,
    local_signal: {
      channel: "trusted_local_ui",
      os_peer_authenticated: true,
      independent_user_presence: true,
      preview_acknowledged: true,
      same_user_endpoint: true,
      input_origin: "trusted_local_hardware",
    },
  });
  const receipt = authority.confirm({ plan, attestation });
  return { authority, receipt };
}

test("draft artifact previews gate-owned recipient mark without send authority", () => {
  const draft = createCommsDraftArtifact({
    channel: "email",
    recipients: ["person@example.test"],
    body: "Reviewed body.",
    now: () => new Date("2026-06-23T19:00:00.000Z"),
    idFactory: () => "draft-1",
  });

  assert.equal(draft.draft_id, "draft-1");
  assert.equal(draft.send_authority_granted, false);
  assert.equal(draft.recipient_mark_previewed, true);
  assert.match(draft.recipient_mark, /Agent-assisted message sent on Seth's behalf/);
  assert.equal(finalBodyForDraft(draft), `Reviewed body.\n\n${draft.recipient_mark}`);
  assert.equal(draft.final_body_digest, sha256(finalBodyForDraft(draft)));
});

test("send plan is locally derived C3 Tier-1 and ignores Tier-0 caller claims", () => {
  const draft = createCommsDraftArtifact({
    recipients: ["person@example.test"],
    body: "Reviewed body.",
    idFactory: () => "draft-1",
  });
  const plan = buildCommsSendPlan({
    draft,
    grantId: "grant-comms-fixture",
    now: () => new Date(NOW),
    idFactory: () => "plan-1",
    callerClaims: {
      consequence_class: "C0",
      tier: "tier_0_in_flow_confirm",
      known_recipient: true,
      established_thread: true,
    },
  });

  assert.equal(plan.consequence_class, "C3");
  assert.equal(plan.consequence_class_source, "local_gate_derived");
  assert.equal(plan.requires_lca, true);
  assert.equal(plan.tier, "tier_1_hardware_touch");
  assert.equal(plan.tier_reason, "egress_relationship_unverified");
  assert.equal(plan.relationship_evidence, "unverified");
  assert.equal(plan.caller_supplied_claims_ignored, true);
  assert.deepEqual(plan.ignored_caller_claims, [
    "consequence_class",
    "established_thread",
    "known_recipient",
    "tier",
  ]);
});

test("fixture provider refuses unmarked sends", () => {
  const provider = createCommsFixtureProvider({ idFactory: () => "1" });

  assert.throws(
    () => provider.send({
      channel: "email",
      recipients: ["person@example.test"],
      final_body: "Reviewed body without mark.",
      final_body_digest: "digest",
    }),
    { code: "comms_recipient_mark_required" },
  );
});

test("fixture send refuses suppressed recipient mark before provider dispatch", () => {
  const draft = createCommsDraftArtifact({
    recipients: ["person@example.test"],
    body: "Reviewed body.",
    idFactory: () => "draft-1",
  });
  const plan = buildCommsSendPlan({
    draft,
    grantId: "grant-comms-fixture",
    now: () => new Date(NOW),
    idFactory: () => "plan-1",
  });
  const { authority, receipt } = confirmationForPlan(plan);
  const provider = createCommsFixtureProvider({ idFactory: () => "1" });
  const { catalog, providerRegistry } = catalogAndRegistry();

  assert.throws(
    () => applyCommsFixtureSend({
      plan: { ...plan, recipient_mark_required: false },
      draft,
      grantStore: activeGrantStore(),
      provider,
      confirmationAuthority: authority,
      confirmationReceiptId: receipt.receipt_id,
      catalog,
      providerRegistry,
    }),
    { code: "comms_recipient_mark_required" },
  );
  assert.equal(provider.sent.length, 0);
});

test("fixture send fails closed on LCA mismatch draft drift and recipient drift", () => {
  const draft = createCommsDraftArtifact({
    recipients: ["person@example.test"],
    body: "Reviewed body.",
    idFactory: () => "draft-1",
  });
  const plan = buildCommsSendPlan({
    draft,
    grantId: "grant-comms-fixture",
    now: () => new Date(NOW),
    idFactory: () => "plan-1",
  });
  const otherDraft = createCommsDraftArtifact({
    recipients: ["person@example.test"],
    body: "Other reviewed body.",
    idFactory: () => "draft-2",
  });
  const otherPlan = buildCommsSendPlan({
    draft: otherDraft,
    grantId: "grant-comms-fixture",
    now: () => new Date(NOW),
    idFactory: () => "plan-2",
  });
  const { authority, receipt } = confirmationForPlan(otherPlan);
  const { catalog, providerRegistry } = catalogAndRegistry();

  assert.throws(
    () => applyCommsFixtureSend({
      plan,
      draft,
      grantStore: activeGrantStore(),
      confirmationAuthority: authority,
      confirmationReceiptId: receipt.receipt_id,
      catalog,
      providerRegistry,
    }),
    { code: "service_restart_confirmation_mismatch" },
  );

  const { authority: matchingAuthority, receipt: matchingReceipt } = confirmationForPlan(plan);
  assert.throws(
    () => applyCommsFixtureSend({
      plan,
      draft: { ...draft, final_body_digest: sha256("changed") },
      grantStore: activeGrantStore(),
      confirmationAuthority: matchingAuthority,
      confirmationReceiptId: matchingReceipt.receipt_id,
      catalog,
      providerRegistry,
    }),
    { code: "comms_draft_digest_mismatch" },
  );

  const { authority: targetAuthority, receipt: targetReceipt } = confirmationForPlan(plan);
  assert.throws(
    () => applyCommsFixtureSend({
      plan,
      draft: { ...draft, recipients: ["other@example.test"] },
      grantStore: activeGrantStore(),
      confirmationAuthority: targetAuthority,
      confirmationReceiptId: targetReceipt.receipt_id,
      catalog,
      providerRegistry,
    }),
    { code: "comms_target_binding_mismatch" },
  );
});

test("fixture send refuses expired plans before dispatch", () => {
  const draft = createCommsDraftArtifact({
    recipients: ["person@example.test"],
    body: "Reviewed body.",
    idFactory: () => "draft-1",
  });
  const plan = buildCommsSendPlan({
    draft,
    grantId: "grant-comms-fixture",
    now: () => new Date(NOW),
    idFactory: () => "plan-1",
  });
  const { authority, receipt } = confirmationForPlan(plan);
  const provider = createCommsFixtureProvider({ idFactory: () => "1" });
  const { catalog, providerRegistry } = catalogAndRegistry();

  assert.throws(
    () => applyCommsFixtureSend({
      plan,
      draft,
      grantStore: activeGrantStore(),
      provider,
      confirmationAuthority: authority,
      confirmationReceiptId: receipt.receipt_id,
      catalog,
      providerRegistry,
      now: () => plan.expires_at + 1,
    }),
    { code: "comms_send_plan_expired" },
  );
  assert.equal(provider.sent.length, 0);
  assert.equal(authority.snapshot(receipt.receipt_id).consumed, false);
});

test("fixture send consumes confirmation before provider dispatch", () => {
  const draft = createCommsDraftArtifact({
    recipients: ["person@example.test"],
    body: "Reviewed body.",
    idFactory: () => "draft-1",
  });
  const plan = buildCommsSendPlan({
    draft,
    grantId: "grant-comms-fixture",
    now: () => new Date(NOW),
    idFactory: () => "plan-1",
  });
  const { authority, receipt } = confirmationForPlan(plan);
  const { catalog, providerRegistry } = catalogAndRegistry();
  const providerFailure = new Error("provider failed after receipt spend");

  assert.throws(
    () => applyCommsFixtureSend({
      plan,
      draft,
      grantStore: activeGrantStore(),
      provider: {
        send() {
          throw providerFailure;
        },
      },
      confirmationAuthority: authority,
      confirmationReceiptId: receipt.receipt_id,
      catalog,
      providerRegistry,
      now: () => NOW,
    }),
    providerFailure,
  );
  assert.equal(authority.snapshot(receipt.receipt_id).consumed, true);
});

test("successful fixture send consumes LCA receipt and records content-free provenance", () => {
  const draft = createCommsDraftArtifact({
    channel: "email",
    recipients: ["person@example.test"],
    body: "Reviewed body.",
    now: () => new Date("2026-06-23T19:00:00.000Z"),
    idFactory: () => "draft-1",
  });
  const plan = buildCommsSendPlan({
    draft,
    grantId: "grant-comms-fixture",
    now: () => new Date(NOW),
    idFactory: () => "plan-1",
  });
  const { authority, receipt } = confirmationForPlan(plan);
  const provider = createCommsFixtureProvider({ idFactory: () => "1" });
  const { catalog, providerRegistry } = catalogAndRegistry();

  const result = applyCommsFixtureSend({
    plan,
    draft,
    grantStore: activeGrantStore(),
    provider,
    confirmationAuthority: authority,
    confirmationReceiptId: receipt.receipt_id,
    catalog,
    providerRegistry,
  });

  assert.equal(result.sent, true);
  assert.equal(result.fixture_only, true);
  assert.equal(result.recipient_mark_applied, true);
  assert.equal(result.final_body_digest, sha256(finalBodyForDraft(draft)));
  assert.equal(provider.sent.length, 1);
  assert.equal(provider.sent[0].final_body_digest, result.final_body_digest);
  assert.equal(authority.snapshot(receipt.receipt_id).consumed, true);
  assert.equal(result.provenance.content_recorded, false);
  assert.equal(result.provenance.body_included, false);
  assert.equal(Object.values(result.provenance).includes("Reviewed body."), false);
  assert.equal(result.provenance.draft_id, "draft-1");
  assert.equal(result.provenance.tier, "tier_1_hardware_touch");
});

test("mark digest is bound to the reviewed final body", () => {
  const draft = createCommsDraftArtifact({
    channel: "chat",
    recipients: ["person@example.test"],
    body: "Reviewed body.",
  });
  const mark = renderRecipientVisibleMark({ channel: "chat" });

  assert.equal(draft.recipient_mark, mark);
  assert.equal(draft.final_body_digest, sha256(`Reviewed body.\n\n${mark}`));
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildModelVisualAttachGrantCandidateFromProposal,
} from "../src/modelVisualAttachGrantCandidate.js";

const catalog = {
  schema_version: 1,
  capabilities: [
    {
      key: "model.context.visual.color.attach",
      activation_policy: "explicit_grant",
      allowed_scopes: ["once"],
    },
  ],
};

const providerRegistry = {
  schema_version: 1,
  providers: [
    {
      id: "soma.provider.local-model",
      capabilities: [
        { key: "model.context.visual.color.attach" },
      ],
    },
  ],
};

const approvedProposal = {
  id: "proposal-visual-color",
  status: "approved",
  type: "capability_proposal",
  requested_by: "assistant",
  capability: "model.context.visual.color.attach",
  requested_scope: "once",
  reason: "Need one reviewed color frame for this turn.",
  activation_performed: false,
  decision: {
    decision: "approved",
    approved_scope: "once",
    decided_by: "user",
    decided_at: "2026-05-19T12:00:00.000Z",
    provenance_id: "prov-approval",
    activation_performed: false,
  },
  review_context: {
    capability: "model.context.visual.color.attach",
    provider: "soma.provider.local-model",
    risk_class: "high",
    scope: "once",
    source: {
      subscription_id: "sub-color-1",
      subscription_ids: ["sub-color-1"],
      capability: "perception.sensorium.color.subscribe",
      capabilities: ["perception.sensorium.color.subscribe"],
      provider: "soma.provider.sensorium.jetsorano",
      topic: "sensor/jetsorano/realsense/color",
      grant_id: "grant-color-1",
    },
    model_target: "local.gemma4",
    payload_type: "color",
    frame_count: 1,
    max_frame_age_ms: 5_000,
    transformed_dimensions: [384, 384],
    format_required: "jpeg",
    preview: {
      required: true,
      available: true,
      acknowledgement_required: true,
      acknowledged: true,
    },
    retention: {
      mode: "none",
      payload_retained: false,
      memory_write_authorized: false,
    },
    memory_write_authorized: false,
    model_delivery_performed: false,
    payload_attached: false,
    payload_bytes_included: false,
    active_disclosure: "model visual context: color",
    provenance_posture: "metadata only; never record image bytes",
  },
  grant_intent: {
    capability: "model.context.visual.color.attach",
    provider: "soma.provider.local-model",
    scope: "once",
    source_subscription_ids: ["sub-color-1"],
    source_capabilities: ["perception.sensorium.color.subscribe"],
    model_target: "local.gemma4",
    payload_type: "color",
    constraints: {
      max_frame_count: 1,
      max_frame_age_ms: 5_000,
      transformed_dimensions: [384, 384],
      format_required: "jpeg",
    },
    preview_required: true,
    retention_mode: "none",
    reason: "Need one reviewed color frame for this turn.",
    activation_performed: false,
    model_delivery_performed: false,
  },
};

const context = {
  catalog,
  providerRegistry,
  now: () => "2026-05-19T12:10:00.000Z",
  createId: () => "grant-visual-color",
};

test("buildModelVisualAttachGrantCandidateFromProposal returns validated input without delivery", () => {
  const result = buildModelVisualAttachGrantCandidateFromProposal(approvedProposal, context);

  assert.equal(result.source_proposal_id, "proposal-visual-color");
  assert.equal(result.activation_performed, false);
  assert.equal(result.grant_written, false);
  assert.equal(result.subscription_activated, false);
  assert.equal(result.model_delivery_performed, false);
  assert.equal(result.payload_attached, false);
  assert.equal(result.payload_bytes_included, false);

  assert.equal(result.grant_create_input.id, "grant-visual-color");
  assert.equal(result.grant_create_input.status, "active");
  assert.equal(result.grant_create_input.capability, "model.context.visual.color.attach");
  assert.equal(result.grant_create_input.provider, "soma.provider.local-model");
  assert.equal(result.grant_create_input.scope, "once");
  assert.equal(result.grant_create_input.approved_by, "user");
  assert.equal(result.grant_create_input.approval_provenance_id, "prov-approval");
  assert.equal(result.grant_create_input.activation_performed, false);
  assert.deepEqual(result.grant_create_input.constraints, {
    max_frame_count: 1,
    max_frame_age_ms: 5_000,
    transformed_dimensions: [384, 384],
    format_required: "jpeg",
    source_subscription_ids: ["sub-color-1"],
    source_capabilities: ["perception.sensorium.color.subscribe"],
    source_provider: "soma.provider.sensorium.jetsorano",
    source_topic: "sensor/jetsorano/realsense/color",
    source_grant_id: "grant-color-1",
    model_target: "local.gemma4",
    payload_type: "color",
    preview_acknowledged: true,
    retention_mode: "none",
  });
});

test("model visual grant candidate emits byte-free provenance summary", () => {
  const result = buildModelVisualAttachGrantCandidateFromProposal(approvedProposal, context);

  assert.deepEqual(result.provenance_summary, {
    event_type: "model.context.visual.grant_candidate_built",
    proposal_id: "proposal-visual-color",
    capability: "model.context.visual.color.attach",
    provider: "soma.provider.local-model",
    scope: "once",
    source_subscription_ids: ["sub-color-1"],
    source_capabilities: ["perception.sensorium.color.subscribe"],
    source_provider: "soma.provider.sensorium.jetsorano",
    source_topic: "sensor/jetsorano/realsense/color",
    source_grant_id: "grant-color-1",
    model_target: "local.gemma4",
    payload_type: "color",
    frame_count: 1,
    max_frame_age_ms: 5_000,
    transformed_dimensions: [384, 384],
    format_required: "jpeg",
    preview_acknowledged: true,
    retention_mode: "none",
    payload_retained: false,
    memory_write_authorized: false,
    approval_provenance_id: "prov-approval",
    payload_bytes_included: false,
    model_delivery_performed: false,
    payload_attached: false,
  });
});

test("model visual grant candidate rejects preview refusal before delivery", () => {
  assertModelVisualCandidateError(
    () => buildModelVisualAttachGrantCandidateFromProposal({
      ...approvedProposal,
      review_context: {
        ...approvedProposal.review_context,
        preview: {
          ...approvedProposal.review_context.preview,
          acknowledged: false,
        },
      },
    }, context),
    "invalid_model_visual_attach_grant_candidate",
    "review_context.preview.acknowledged must be true before candidate creation",
  );
});

test("model visual grant candidate rejects retention mismatch before delivery", () => {
  assertModelVisualCandidateError(
    () => buildModelVisualAttachGrantCandidateFromProposal({
      ...approvedProposal,
      review_context: {
        ...approvedProposal.review_context,
        retention: {
          ...approvedProposal.review_context.retention,
          mode: "turn_only",
        },
      },
    }, context),
    "invalid_model_visual_attach_grant_candidate",
    "review_context and grant_intent retention_mode must be none",
  );
});

test("model visual grant candidate rejects source identity and model target drift", () => {
  assertModelVisualCandidateError(
    () => buildModelVisualAttachGrantCandidateFromProposal({
      ...approvedProposal,
      review_context: {
        ...approvedProposal.review_context,
        source: {
          ...approvedProposal.review_context.source,
          subscription_ids: ["sub-other"],
          subscription_id: "sub-other",
        },
      },
    }, context),
    "invalid_model_visual_attach_grant_candidate",
    "review_context.source.subscription_ids must match grant_intent.source_subscription_ids",
  );

  assertModelVisualCandidateError(
    () => buildModelVisualAttachGrantCandidateFromProposal({
      ...approvedProposal,
      grant_intent: {
        ...approvedProposal.grant_intent,
        model_target: "remote.frontier",
      },
    }, context),
    "invalid_model_visual_attach_grant_candidate",
    "review_context and grant_intent must match model_target",
  );
});

test("model visual grant candidate rejects payload bytes in review metadata", () => {
  assertModelVisualCandidateError(
    () => buildModelVisualAttachGrantCandidateFromProposal({
      ...approvedProposal,
      review_context: {
        ...approvedProposal.review_context,
        preview: {
          ...approvedProposal.review_context.preview,
          image_bytes: "base64-not-allowed",
        },
      },
    }, context),
    "invalid_model_visual_attach_grant_candidate",
    "review_context.preview.image_bytes is forbidden",
  );
});

function assertModelVisualCandidateError(fn, code, messagePart) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code);
    assert.equal(Array.isArray(error.validation_errors), true);
    assert.ok(error.validation_errors.some((entry) => entry.includes(messagePart)));
    return true;
  });
}

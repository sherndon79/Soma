import assert from "node:assert/strict";
import test from "node:test";

import { validateModelVisualAttachRequest } from "../src/modelVisualAttachRequest.js";

const visualGrant = {
  id: "grant-visual-color",
  status: "active",
  capability: "model.context.visual.color.attach",
  provider: "soma.provider.local-model",
  scope: "once",
  constraints: {
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
    preview_artifact_id: "preview-color-1",
    preview_acknowledgement_id: "ack-preview-color-1",
    preview_acknowledged_by: "user",
    preview_acknowledged_at: "2026-05-19T12:00:00.000Z",
    preview_acknowledged: true,
    preview_cleanup_required: true,
    retention_mode: "none",
  },
};

const sensoriumGrant = {
  id: "grant-color-1",
  status: "active",
  capability: "perception.sensorium.color.subscribe",
  provider: "soma.provider.sensorium.jetsorano",
  scope: "session",
  constraints: {
    topic: "sensor/jetsorano/realsense/color",
  },
};

const request = {
  capability: "model.context.visual.color.attach",
  grant_id: "grant-visual-color",
  source_subscription_ids: ["sub-color-1"],
  source_capabilities: ["perception.sensorium.color.subscribe"],
  source_provider: "soma.provider.sensorium.jetsorano",
  source_topic: "sensor/jetsorano/realsense/color",
  source_grant_id: "grant-color-1",
  model_target: "local.gemma4",
  payload_type: "color",
  max_frame_count: 1,
  max_frame_age_ms: 5_000,
  transformed_dimensions: [384, 384],
  format_required: "jpeg",
  preview_artifact_id: "preview-color-1",
  preview_acknowledgement_id: "ack-preview-color-1",
  preview_acknowledged_by: "user",
  preview_acknowledged_at: "2026-05-19T12:00:00.000Z",
  preview_acknowledged: true,
  preview_cleanup_required: true,
  retention_mode: "none",
};

const visualSequenceGrant = {
  id: "grant-visual-composite-sequence",
  status: "active",
  capability: "model.context.visual.composite.sequence.attach",
  provider: "soma.provider.local-model",
  scope: "window",
  constraints: {
    max_frame_count: 8,
    max_frame_age_ms: 5_000,
    transformed_dimensions: [640, 360],
    format_required: "composite_sequence",
    source_subscription_ids: ["sub-color-1", "sub-depth-1"],
    source_capabilities: [
      "perception.sensorium.color.subscribe",
      "perception.sensorium.depth.subscribe",
    ],
    source_topics: [
      "sensor/jetsorano/realsense/color",
      "sensor/jetsorano/realsense/depth",
    ],
    source_grant_ids: ["grant-color-1", "grant-depth-1"],
    source_provider: "soma.provider.sensorium.jetsorano",
    source_topic: "sensor/jetsorano/realsense/composite",
    source_grant_id: "grant-composite-sequence-1",
    model_target: "claude-fable-5",
    payload_type: "composite_sequence",
    composite_representation: "paired_image_blocks",
    max_pairing_skew_ms: 50,
    effective_sampling_fps: 5,
    burst_max_frames: 8,
    burst_span_ms: 3_200,
    burst_downsample: [640, 360],
    window_frame_budget: 32,
    budget_unit: "pairs",
    client_attachment_unit: "image_blocks",
    preview_artifact_id: "preview-composite-sequence-1",
    preview_acknowledgement_id: "ack-preview-composite-sequence-1",
    preview_acknowledged_by: "user",
    preview_acknowledged_at: "2026-05-19T12:00:00.000Z",
    preview_acknowledged: true,
    preview_cleanup_required: true,
    retention_mode: "none",
  },
};

const sequenceRequest = {
  capability: "model.context.visual.composite.sequence.attach",
  grant_id: "grant-visual-composite-sequence",
  source_subscription_ids: ["sub-color-1", "sub-depth-1"],
  source_capabilities: [
    "perception.sensorium.color.subscribe",
    "perception.sensorium.depth.subscribe",
  ],
  source_topics: [
    "sensor/jetsorano/realsense/color",
    "sensor/jetsorano/realsense/depth",
  ],
  source_grant_ids: ["grant-color-1", "grant-depth-1"],
  source_provider: "soma.provider.sensorium.jetsorano",
  source_topic: "sensor/jetsorano/realsense/composite",
  source_grant_id: "grant-composite-sequence-1",
  model_target: "claude-fable-5",
  payload_type: "composite_sequence",
  max_frame_count: 8,
  max_frame_age_ms: 5_000,
  transformed_dimensions: [640, 360],
  format_required: "composite_sequence",
  composite_representation: "paired_image_blocks",
  max_pairing_skew_ms: 50,
  effective_sampling_fps: 5,
  burst_max_frames: 8,
  burst_span_ms: 3_200,
  burst_downsample: [640, 360],
  window_frame_budget: 32,
  budget_unit: "pairs",
  client_attachment_unit: "image_blocks",
  preview_artifact_id: "preview-composite-sequence-1",
  preview_acknowledgement_id: "ack-preview-composite-sequence-1",
  preview_acknowledged_by: "user",
  preview_acknowledged_at: "2026-05-19T12:00:00.000Z",
  preview_acknowledged: true,
  preview_cleanup_required: true,
  retention_mode: "none",
};

test("validateModelVisualAttachRequest accepts metadata-only request with active visual grant", () => {
  const result = validateModelVisualAttachRequest(request, { grants: [visualGrant] });

  assert.deepEqual(result, {
    ...request,
    grant_id: "grant-visual-color",
    provider: "soma.provider.local-model",
    scope: "once",
    activation_performed: false,
    subscription_activated: false,
    model_delivery_performed: false,
    payload_attached: false,
    payload_bytes_included: false,
  });
});

test("validateModelVisualAttachRequest accepts grant-bound sequence bounds", () => {
  const result = validateModelVisualAttachRequest(sequenceRequest, { grants: [visualSequenceGrant] });

  assert.deepEqual(result, {
    ...sequenceRequest,
    grant_id: "grant-visual-composite-sequence",
    provider: "soma.provider.local-model",
    scope: "window",
    activation_performed: false,
    subscription_activated: false,
    model_delivery_performed: false,
    payload_attached: false,
    payload_bytes_included: false,
  });
});

test("validateModelVisualAttachRequest rejects sequence bound drift before frame read", () => {
  assertVisualRequestError(
    () => validateModelVisualAttachRequest({
      ...sequenceRequest,
      budget_unit: "frames",
    }, { grants: [visualSequenceGrant] }),
    "budget_unit must be pairs for sequence payloads",
  );

  assertVisualRequestError(
    () => validateModelVisualAttachRequest({
      ...sequenceRequest,
      burst_max_frames: 16,
    }, { grants: [visualSequenceGrant] }),
    "max_frame_count must match burst_max_frames for sequence payloads",
  );
});

test("validateModelVisualAttachRequest rejects missing visual grant", () => {
  assertVisualRequestError(
    () => validateModelVisualAttachRequest(request, { grants: [] }),
    "an active model visual attach grant is required",
  );
});

test("validateModelVisualAttachRequest rejects Sensorium subscription grant as authority", () => {
  assertVisualRequestError(
    () => validateModelVisualAttachRequest({
      ...request,
      grant_id: "grant-color-1",
    }, { grants: [sensoriumGrant] }),
    "grant_id must reference a model visual attach grant",
  );
});

test("validateModelVisualAttachRequest rejects subscription capability as request capability", () => {
  assertVisualRequestError(
    () => validateModelVisualAttachRequest({
      ...request,
      capability: "perception.sensorium.color.subscribe",
    }, { grants: [visualGrant] }),
    "capability must be a model-facing visual attach capability",
  );
});

test("validateModelVisualAttachRequest rejects preview refusal and retention drift", () => {
  assertVisualRequestError(
    () => validateModelVisualAttachRequest({
      ...request,
      preview_acknowledged: false,
    }, { grants: [visualGrant] }),
    "preview_acknowledged must be true",
  );

  assertVisualRequestError(
    () => validateModelVisualAttachRequest({
      ...request,
      retention_mode: "turn_only",
    }, { grants: [visualGrant] }),
    "retention_mode must be none",
  );
});

test("validateModelVisualAttachRequest rejects preview acknowledgement metadata drift", () => {
  assertVisualRequestError(
    () => validateModelVisualAttachRequest({
      ...request,
      preview_acknowledgement_id: "ack-other",
    }, { grants: [visualGrant] }),
    "preview_acknowledgement_id must match grant constraints",
  );
});

test("validateModelVisualAttachRequest rejects model target mismatch and broader frame age", () => {
  assertVisualRequestError(
    () => validateModelVisualAttachRequest({
      ...request,
      model_target: "remote.frontier",
    }, { grants: [visualGrant] }),
    "model_target must match grant constraints",
  );

  assertVisualRequestError(
    () => validateModelVisualAttachRequest({
      ...request,
      max_frame_age_ms: 10_000,
    }, { grants: [visualGrant] }),
    "max_frame_age_ms must not exceed grant constraints",
  );
});

test("validateModelVisualAttachRequest rejects payload-shaped fields before delivery", () => {
  assertVisualRequestError(
    () => validateModelVisualAttachRequest({
      ...request,
      image_bytes: "base64-not-allowed",
    }, { grants: [visualGrant] }),
    "request.image_bytes is forbidden",
  );
});

function assertVisualRequestError(fn, messagePart) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, "invalid_model_visual_attach_request");
    assert.equal(Array.isArray(error.validation_errors), true);
    assert.ok(error.validation_errors.some((entry) => entry.includes(messagePart)));
    return true;
  });
}

import assert from "node:assert/strict";
import test from "node:test";

import {
  validateModelVisualPreviewAcknowledgement,
  validateModelVisualPreviewArtifactMetadata,
} from "../src/modelVisualPreviewArtifact.js";

const artifact = {
  preview_artifact_id: "preview-color-1",
  capability: "model.context.visual.color.attach",
  source_subscription_ids: ["sub-color-1"],
  source_capabilities: ["perception.sensorium.color.subscribe"],
  source_provider: "soma.provider.sensorium.jetsorano",
  source_topic: "sensor/jetsorano/realsense/color",
  source_grant_id: "grant-color-1",
  model_target: "local.gemma4",
  payload_type: "color",
  frame_count: 1,
  frame_age_ms: 350,
  transformed_dimensions: [384, 384],
  format_required: "jpeg",
  depth_units_present: false,
  fused_color_depth: false,
  preview_rendered: true,
  retention_mode: "ephemeral_preview",
  cleanup_required: true,
  cleanup_deadline_ms: 30_000,
  payload_bytes_included: false,
  payload_retained_after_acknowledgement: false,
};

const acknowledgement = {
  acknowledgement_id: "ack-preview-color-1",
  preview_artifact_id: "preview-color-1",
  decision: "acknowledged",
  acknowledged_by: "user",
  acknowledged_at: "2026-05-19T12:00:00.000Z",
  retention_mode: "ephemeral_preview",
  payload_retained_after_acknowledgement: false,
  cleanup_required: true,
};

test("validateModelVisualPreviewArtifactMetadata accepts byte-free transformed preview metadata", () => {
  const result = validateModelVisualPreviewArtifactMetadata(artifact);

  assert.deepEqual(result, {
    ...artifact,
    model_delivery_performed: false,
    payload_attached: false,
  });
});

test("validateModelVisualPreviewAcknowledgement accepts user acknowledgement for matching artifact", () => {
  const result = validateModelVisualPreviewAcknowledgement(acknowledgement, { artifact });

  assert.deepEqual(result, {
    ...acknowledgement,
    preview_acknowledged: true,
    capability: "model.context.visual.color.attach",
    source_subscription_ids: ["sub-color-1"],
    model_target: "local.gemma4",
    payload_type: "color",
    transformed_dimensions: [384, 384],
    format_required: "jpeg",
    model_delivery_performed: false,
    payload_attached: false,
    payload_bytes_included: false,
  });
});

test("preview artifact metadata rejects missing lifecycle fields", () => {
  assertPreviewArtifactError(
    () => validateModelVisualPreviewArtifactMetadata({
      ...artifact,
      preview_artifact_id: "",
      preview_rendered: false,
      cleanup_required: false,
      retention_mode: "none",
    }),
    "invalid_model_visual_preview_artifact",
    "preview_artifact_id is required",
  );
});

test("preview artifact metadata rejects payload-bearing fields", () => {
  assertPreviewArtifactError(
    () => validateModelVisualPreviewArtifactMetadata({
      ...artifact,
      image_bytes: "base64-not-allowed",
    }),
    "invalid_model_visual_preview_artifact",
    "preview_artifact.image_bytes is forbidden",
  );
});

test("preview acknowledgement rejects mismatch non-user actor and retention drift", () => {
  assertPreviewArtifactError(
    () => validateModelVisualPreviewAcknowledgement({
      ...acknowledgement,
      preview_artifact_id: "other-preview",
      acknowledged_by: "assistant",
      retention_mode: "none",
    }, { artifact }),
    "invalid_model_visual_preview_acknowledgement",
    "preview_artifact_id must match the preview artifact",
  );
});

test("preview acknowledgement rejects payload-bearing fields", () => {
  assertPreviewArtifactError(
    () => validateModelVisualPreviewAcknowledgement({
      ...acknowledgement,
      screenshot: "not-allowed",
    }, { artifact }),
    "invalid_model_visual_preview_acknowledgement",
    "preview_acknowledgement.screenshot is forbidden",
  );
});

function assertPreviewArtifactError(fn, code, messagePart) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code);
    assert.equal(Array.isArray(error.validation_errors), true);
    assert.ok(error.validation_errors.some((entry) => entry.includes(messagePart)));
    return true;
  });
}

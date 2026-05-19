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
    preview_acknowledged: true,
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
  preview_acknowledged: true,
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

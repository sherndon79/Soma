import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createModelVisualAttachmentProvenanceSummary,
} from "../src/modelVisualAttachmentProvenance.js";

const FUTURE_ATTACHMENT_FIXTURE_URL = new URL(
  "../docs/fixtures/future-model-visual-attachment-provenance-summary.json",
  import.meta.url,
);

const validatedRequest = {
  capability: "model.context.visual.color.attach",
  grant_id: "grant-visual-color",
  provider: "soma.provider.local-model",
  scope: "once",
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
  activation_performed: false,
  subscription_activated: false,
  model_delivery_performed: false,
  payload_attached: false,
  payload_bytes_included: false,
};

test("model visual attachment provenance builder matches the future byte-free fixture", async () => {
  const fixture = JSON.parse(await readFile(FUTURE_ATTACHMENT_FIXTURE_URL, "utf8"));
  const summary = createModelVisualAttachmentProvenanceSummary({
    request: validatedRequest,
  });

  assert.deepEqual(summary, fixture.event_fields);
});

test("model visual attachment provenance builder rejects payload-shaped fields before summary creation", () => {
  assert.throws(
    () => createModelVisualAttachmentProvenanceSummary({
      request: {
        ...validatedRequest,
        image_bytes: "base64-not-allowed",
      },
    }),
    (error) => {
      assert.equal(error.code, "invalid_model_visual_attachment_provenance");
      assert.ok(error.validation_errors.some((entry) => entry.includes("request.image_bytes is forbidden")));
      return true;
    },
  );
});

test("model visual attachment provenance builder does not copy transient validation flags", () => {
  const summary = createModelVisualAttachmentProvenanceSummary({
    request: validatedRequest,
  });

  for (const field of [
    "activation_performed",
    "subscription_activated",
    "preview_acknowledged",
  ]) {
    assert.equal(Object.hasOwn(summary, field), false);
  }
  assert.equal(summary.model_delivery_performed, true);
  assert.equal(summary.payload_attached, true);
});

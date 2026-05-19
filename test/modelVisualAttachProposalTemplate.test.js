import assert from "node:assert/strict";
import test from "node:test";

import {
  loadCapabilityCatalog,
  loadProviderRegistry,
} from "../src/capabilityCatalog.js";
import { buildModelVisualAttachProposalTemplate } from "../src/modelVisualAttachProposalTemplate.js";

const LOCAL_MODEL_PROVIDER = "soma.provider.local-model";

function baseColorRequest({ catalog, providerRegistry } = {}) {
  return {
    catalog,
    providerRegistry,
    requested_by: "assistant",
    capability: "model.context.visual.color.attach",
    provider: LOCAL_MODEL_PROVIDER,
    source_subscription_id: "sub-color-1",
    source_capability: "perception.sensorium.color.subscribe",
    source_provider: "soma.provider.sensorium.jetsorano",
    source_topic: "sensor/jetsorano/realsense/color",
    source_grant_id: "grant-color-1",
    source_summary: {
      schema_version: 1,
      stream_type: "color",
      width: 384,
      height: 384,
      format: "jpeg",
      payload_size: 42_000,
    },
    model_target: "local.gemma4",
    preview: {
      required: true,
      available: true,
      acknowledgement_required: true,
    },
    retention: {
      mode: "none",
      payload_retained: false,
    },
    constraints: {
      max_frame_count: 1,
      max_frame_age_ms: 5_000,
      transformed_dimensions: [384, 384],
      format_required: "jpeg",
    },
    reason: "Need one reviewed color frame for this turn.",
  };
}

test("buildModelVisualAttachProposalTemplate produces a review-only color attachment proposal", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();

  const template = buildModelVisualAttachProposalTemplate(baseColorRequest({ catalog, providerRegistry }));

  assert.equal(template.type, "model_visual_attach_proposal_template");
  assert.equal(template.activation_performed, false);
  assert.equal(template.model_delivery_performed, false);
  assert.equal(template.subscription_activated, false);
  assert.equal(template.payload_attached, false);
  assert.equal(template.payload_bytes_included, false);
  assert.equal(template.durable, false);
  assert.equal(template.writable, false);

  assert.equal(template.proposal.capability, "model.context.visual.color.attach");
  assert.equal(template.proposal.requested_scope, "once");
  assert.match(template.proposal.risk, /One-shot color visual attachment/);
  assert.ok(template.proposal.data_exposed.includes("one transformed color frame from an approved Sensorium subscription"));
  assert.ok(template.proposal.excluded_data.includes("durable visual memory"));

  assert.equal(template.review.provider, LOCAL_MODEL_PROVIDER);
  assert.equal(template.review.source.subscription_id, "sub-color-1");
  assert.deepEqual(template.review.source.subscription_ids, ["sub-color-1"]);
  assert.equal(template.review.source.capability, "perception.sensorium.color.subscribe");
  assert.equal(template.review.source.provider, "soma.provider.sensorium.jetsorano");
  assert.equal(template.review.source.topic, "sensor/jetsorano/realsense/color");
  assert.equal(template.review.model_target, "local.gemma4");
  assert.equal(template.review.payload_type, "color");
  assert.equal(template.review.frame_count, 1);
  assert.equal(template.review.max_frame_age_ms, 5_000);
  assert.deepEqual(template.review.transformed_dimensions, [384, 384]);
  assert.equal(template.review.format_required, "jpeg");
  assert.deepEqual(template.review.preview, {
    required: true,
    available: true,
    acknowledgement_required: true,
    acknowledged: false,
  });
  assert.deepEqual(template.review.retention, {
    mode: "none",
    payload_retained: false,
    memory_write_authorized: false,
  });
  assert.equal(template.review.memory_write_authorized, false);
  assert.match(template.review.provenance_posture, /never record image or depth bytes/);

  assert.deepEqual(template.grant_intent, {
    capability: "model.context.visual.color.attach",
    provider: LOCAL_MODEL_PROVIDER,
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
  });
});

test("model visual template supports depth proposal metadata without payload bytes", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();

  const template = buildModelVisualAttachProposalTemplate({
    ...baseColorRequest({ catalog, providerRegistry }),
    capability: "model.context.visual.depth.attach",
    source_subscription_id: "sub-depth-1",
    source_capability: "perception.sensorium.depth.subscribe",
    source_topic: "sensor/jetsorano/realsense/depth",
    source_grant_id: "grant-depth-1",
    source_summary: {
      schema_version: 1,
      stream_type: "depth",
      width: 320,
      height: 181,
      format: "png",
      depth_units: 0.001,
      payload_size: 62_143,
    },
    constraints: {
      max_frame_count: 1,
      max_frame_age_ms: 5_000,
      transformed_dimensions: [320, 181],
      format_required: "png",
    },
    reason: "Need one reviewed depth map for this turn.",
  });

  assert.equal(template.proposal.capability, "model.context.visual.depth.attach");
  assert.equal(template.review.payload_type, "depth");
  assert.equal(template.review.source.capability, "perception.sensorium.depth.subscribe");
  assert.equal(template.review.format_required, "png");
  assert.equal(template.review.payload_bytes_included, false);
});

test("Sensorium subscription capability cannot authorize model visual attachment by itself", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();

  assert.throws(
    () => buildModelVisualAttachProposalTemplate({
      ...baseColorRequest({ catalog, providerRegistry }),
      capability: "perception.sensorium.color.subscribe",
      provider: "soma.provider.sensorium.jetsorano",
    }),
    (error) => {
      assert.equal(error.code, "invalid_model_visual_attach_proposal_template");
      assert.ok(error.validation_errors.some((entry) =>
        entry.includes("not a recognized model-facing visual attach capability")));
      return true;
    },
  );
});

test("model visual template rejects missing preview retention source and model target fields", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();
  const request = baseColorRequest({ catalog, providerRegistry });

  assert.throws(
    () => buildModelVisualAttachProposalTemplate({
      ...request,
      source_subscription_id: "",
      source_provider: "",
      source_topic: "",
      source_grant_id: "",
      model_target: "",
      preview: {},
      retention: {},
    }),
    (error) => {
      assert.equal(error.code, "invalid_model_visual_attach_proposal_template");
      assert.ok(error.validation_errors.includes("source_subscription_id is required"));
      assert.ok(error.validation_errors.includes("source_provider is required"));
      assert.ok(error.validation_errors.includes("source_topic is required"));
      assert.ok(error.validation_errors.includes("source_grant_id is required"));
      assert.ok(error.validation_errors.includes("model_target is required"));
      assert.ok(error.validation_errors.includes("preview.required must be true"));
      assert.ok(error.validation_errors.includes("preview.available must be true"));
      assert.ok(error.validation_errors.includes("preview.acknowledgement_required must be true"));
      assert.ok(error.validation_errors.includes("retention.mode must be none"));
      assert.ok(error.validation_errors.includes("retention.payload_retained must be false"));
      return true;
    },
  );
});

test("model visual template rejects payload bytes in proposal metadata", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();

  assert.throws(
    () => buildModelVisualAttachProposalTemplate({
      ...baseColorRequest({ catalog, providerRegistry }),
      source_summary: {
        width: 384,
        height: 384,
        image_bytes: "base64-not-allowed",
      },
    }),
    (error) => {
      assert.equal(error.code, "invalid_model_visual_attach_proposal_template");
      assert.ok(error.validation_errors.some((entry) =>
        entry.includes("source_summary.image_bytes is forbidden")));
      return true;
    },
  );
});

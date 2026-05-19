import assert from "node:assert/strict";
import test from "node:test";

import {
  modelVisualAttachGrantCandidateReviewText,
  modelVisualAttachProposalReviewText,
} from "../src/modelVisualAttachReviewSurface.js";

const proposalTemplate = {
  type: "model_visual_attach_proposal_template",
  activation_performed: false,
  subscription_activated: false,
  model_delivery_performed: false,
  payload_attached: false,
  payload_bytes_included: false,
  proposal: {
    capability: "model.context.visual.color.attach",
    reason: "Need one reviewed color frame for this turn.",
    requested_scope: "once",
  },
  review: {
    capability: "model.context.visual.color.attach",
    provider: "soma.provider.local-model",
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
      acknowledged: false,
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
    model_boundary_warning: "Visual payloads can be withheld before delivery, but cannot be removed from a model turn after attachment.",
  },
};

const candidate = {
  source_proposal_id: "proposal-visual-color",
  grant_written: false,
  subscription_activated: false,
  model_delivery_performed: false,
  payload_attached: false,
  payload_bytes_included: false,
  grant_create_input: {
    id: "grant-visual-color",
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
  },
  provenance_summary: {
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
    payload_bytes_included: false,
    model_delivery_performed: false,
    payload_attached: false,
  },
};

test("model visual proposal review text summarizes source target preview and retention", () => {
  const text = modelVisualAttachProposalReviewText(proposalTemplate);

  assert.match(text, /Model visual attach proposal/);
  assert.match(text, /capability: model\.context\.visual\.color\.attach/);
  assert.match(text, /source: soma\.provider\.sensorium\.jetsorano sensor\/jetsorano\/realsense\/color/);
  assert.match(text, /source subscription: sub-color-1/);
  assert.match(text, /source grant: grant-color-1/);
  assert.match(text, /model target: local\.gemma4/);
  assert.match(text, /payload: color dimensions=384x384 jpeg/);
  assert.match(text, /preview: required=yes available=yes acknowledgement_required=yes acknowledged=no/);
  assert.match(text, /retention: mode=none payload_retained=no memory_write=no/);
  assert.match(text, /approval boundary: proposal approval is not preview acknowledgement or model delivery/);
  assert.match(text, /model delivery performed: no/);
  assert.match(text, /payload bytes included: no/);
});

test("model visual candidate review text summarizes acknowledged non-delivery state", () => {
  const text = modelVisualAttachGrantCandidateReviewText(candidate);

  assert.match(text, /Model visual attach grant candidate/);
  assert.match(text, /source proposal: proposal-visual-color/);
  assert.match(text, /source subscriptions: sub-color-1/);
  assert.match(text, /source capabilities: perception\.sensorium\.color\.subscribe/);
  assert.match(text, /model target: local\.gemma4/);
  assert.match(text, /preview acknowledged: yes/);
  assert.match(text, /retention: mode=none payload_retained=no memory_write=no/);
  assert.match(text, /grant written: no/);
  assert.match(text, /subscription activated: no/);
  assert.match(text, /model delivery performed: no/);
  assert.match(text, /payload attached: no/);
});

test("model visual review surface rejects payload-bearing fields", () => {
  assert.throws(
    () => modelVisualAttachProposalReviewText({
      ...proposalTemplate,
      review: {
        ...proposalTemplate.review,
        preview: {
          ...proposalTemplate.review.preview,
          image_bytes: "base64-not-allowed",
        },
      },
    }),
    (error) => {
      assert.equal(error.code, "model_visual_attach_review_payload_field");
      assert.ok(error.validation_errors.some((entry) => entry.includes("response.review.preview.image_bytes")));
      return true;
    },
  );
});

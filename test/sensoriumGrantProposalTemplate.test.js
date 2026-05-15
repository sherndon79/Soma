import assert from "node:assert/strict";
import test from "node:test";

import {
  loadCapabilityCatalog,
  loadProviderRegistry,
} from "../src/capabilityCatalog.js";
import { buildSensoriumGrantProposalTemplate } from "../src/sensoriumGrantProposalTemplate.js";

const SENSORIUM_PROVIDER = "soma.provider.sensorium.jetsorano";

test("buildSensoriumGrantProposalTemplate produces a review-ready color proposal without writing grants", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();

  const template = buildSensoriumGrantProposalTemplate({
    catalog,
    providerRegistry,
    requested_by: "assistant",
    capability: "perception.sensorium.color.subscribe",
    provider: SENSORIUM_PROVIDER,
    topic: "sensor/jetsorano/realsense/color",
    constraints: {
      max_seconds: 600,
      max_fps: 5,
      format_required: "jpeg",
      downsample_to: [384, 384],
    },
    reason: "Need a bounded color view of the Sensorium scene for this task.",
  });

  assert.equal(template.type, "sensorium_grant_proposal_template");
  assert.equal(template.activation_performed, false);
  assert.equal(template.durable, false);
  assert.equal(template.writable, false);
  assert.deepEqual(Object.keys(template.proposal).sort(), [
    "capability",
    "data_exposed",
    "excluded_data",
    "fallback",
    "reason",
    "requested_by",
    "requested_scope",
    "risk",
  ].sort());
  assert.equal(template.proposal.capability, "perception.sensorium.color.subscribe");
  assert.equal(template.proposal.requested_scope, "session");
  assert.match(template.proposal.risk, /risk_class=high/);
  assert.ok(template.proposal.data_exposed.includes("JPEG-encoded color frames from a remote Sensorium publisher"));
  assert.ok(template.proposal.excluded_data.includes("hidden recording"));

  assert.equal(template.review.provider, SENSORIUM_PROVIDER);
  assert.equal(template.review.host_segment, "jetsorano");
  assert.equal(template.review.topic, "sensor/jetsorano/realsense/color");
  assert.equal(template.review.stream_type, "color");
  assert.equal(template.review.risk_class, "high");
  assert.equal(template.review.max_seconds, 600);
  assert.equal(template.review.max_fps, 5);
  assert.equal(template.review.format_required, "jpeg");
  assert.deepEqual(template.review.downsample_to, [384, 384]);
  assert.match(template.review.active_disclosure, /color from jetsorano/);
  assert.match(template.review.model_boundary_warning, /Camera-class payloads/);
  assert.equal(template.review.revocation.immediate_stop, true);
  assert.match(template.review.recording_posture, /not recorded by default/);
  assert.match(template.review.provenance_posture, /metadata/);

  assert.deepEqual(template.grant_intent, {
    capability: "perception.sensorium.color.subscribe",
    provider: SENSORIUM_PROVIDER,
    scope: "session",
    constraints: {
      max_seconds: 600,
      max_fps: 5,
      format_required: "jpeg",
      downsample_to: [384, 384],
    },
    reason: "Need a bounded color view of the Sensorium scene for this task.",
    activation_performed: false,
  });
});

test("buildSensoriumGrantProposalTemplate supports status review without video constraints", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();

  const template = buildSensoriumGrantProposalTemplate({
    catalog,
    providerRegistry,
    capability: "perception.sensorium.status.subscribe",
    provider: SENSORIUM_PROVIDER,
    topic: "sensor/jetsorano/status",
    constraints: {
      max_seconds: 30,
    },
    reason: "Need to confirm the Sensorium node is advertising streams.",
  });

  assert.equal(template.proposal.capability, "perception.sensorium.status.subscribe");
  assert.equal(template.review.stream_type, "status");
  assert.equal(template.review.risk_class, "low");
  assert.equal(template.review.max_seconds, 30);
  assert.equal(template.review.max_fps, null);
  assert.equal(template.review.format_required, "");
  assert.deepEqual(template.review.downsample_to, []);
  assert.match(template.review.model_boundary_warning, /Payloads can be stopped/);
  assert.deepEqual(template.grant_intent.constraints, { max_seconds: 30 });
});

test("buildSensoriumGrantProposalTemplate rejects invalid topic for capability", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();

  assert.throws(
    () => buildSensoriumGrantProposalTemplate({
      catalog,
      providerRegistry,
      capability: "perception.sensorium.color.subscribe",
      provider: SENSORIUM_PROVIDER,
      topic: "sensor/jetsorano/realsense/depth",
      constraints: {
        max_seconds: 600,
        max_fps: 5,
        format_required: "jpeg",
        downsample_to: [384, 384],
      },
      reason: "Need color.",
    }),
    (error) => {
      assert.equal(error.code, "invalid_sensorium_grant_proposal_template");
      assert.ok(
        error.validation_errors.some((entry) => entry.includes("sensor/<host>/realsense/color")),
      );
      return true;
    },
  );
});

test("buildSensoriumGrantProposalTemplate rejects unsupported capability and missing required constraints", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();

  assert.throws(
    () => buildSensoriumGrantProposalTemplate({
      catalog,
      providerRegistry,
      capability: "desktop.inspect.focus",
      provider: SENSORIUM_PROVIDER,
      topic: "sensor/jetsorano/realsense/color",
      constraints: {},
      reason: "Need color.",
    }),
    (error) => {
      assert.equal(error.code, "invalid_sensorium_grant_proposal_template");
      assert.ok(
        error.validation_errors.some((entry) => entry.includes("not a recognized Sensorium capability")),
      );
      assert.ok(
        error.validation_errors.some((entry) => entry.includes("does not support desktop.inspect.focus")),
      );
      return true;
    },
  );

  assert.throws(
    () => buildSensoriumGrantProposalTemplate({
      catalog,
      providerRegistry,
      capability: "perception.sensorium.color.subscribe",
      provider: SENSORIUM_PROVIDER,
      topic: "sensor/jetsorano/realsense/color",
      constraints: {
        max_seconds: 600,
        max_fps: 5,
        format_required: "jpeg",
      },
      reason: "Need color.",
    }),
    (error) => {
      assert.equal(error.code, "invalid_sensorium_grant_proposal_template");
      assert.ok(
        error.validation_errors.some((entry) => entry.includes("constraints.downsample_to is required")),
      );
      return true;
    },
  );
});

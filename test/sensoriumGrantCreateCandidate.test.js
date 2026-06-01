import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSensoriumGrantCreateCandidateFromProposal,
} from "../src/sensoriumGrantCreateCandidate.js";

const catalog = {
  schema_version: 1,
  capabilities: [
    {
      key: "perception.sensorium.color.subscribe",
      activation_policy: "explicit_grant",
      allowed_scopes: ["session"],
    },
  ],
};

const providerRegistry = {
  schema_version: 1,
  providers: [
    {
      id: "soma.provider.sensorium.jetsorano",
      host_segment: "jetsorano",
      capabilities: [
        { key: "perception.sensorium.color.subscribe" },
      ],
    },
  ],
};

const approvedProposal = {
  id: "proposal-sensorium-color",
  status: "approved",
  type: "capability_proposal",
  requested_by: "assistant",
  capability: "perception.sensorium.color.subscribe",
  requested_scope: "session",
  reason: "Need a bounded color view of the Sensorium scene for this task.",
  decision: {
    decision: "approved",
    approved_scope: "session",
    decided_by: "user",
    decided_at: "2026-05-17T12:00:00.000Z",
    provenance_id: "prov-approval",
    activation_performed: false,
  },
  review_context: {
    capability: "perception.sensorium.color.subscribe",
    provider: "soma.provider.sensorium.jetsorano",
    host_segment: "jetsorano",
    topic: "sensor/jetsorano/realsense/color",
    stream_type: "color",
    risk_class: "high",
    scope: "session",
    constraints: {
      max_seconds: 600,
      max_fps: 5,
      format_required: "jpeg",
      downsample_to: [384, 384],
    },
    active_disclosure: "perception via Sensorium: color from jetsorano",
    revocation: {
      summary: "Revoking this grant stops active color subscriptions for jetsorano immediately.",
      immediate_stop: true,
    },
    recording_posture: "Frame payloads are not recorded by default.",
    model_boundary_warning: "Camera-class payloads can be stopped later.",
    provenance_posture: "Record lifecycle metadata only.",
  },
  grant_intent: {
    capability: "perception.sensorium.color.subscribe",
    provider: "soma.provider.sensorium.jetsorano",
    scope: "session",
    constraints: {
      max_seconds: 600,
      max_fps: 5,
      format_required: "jpeg",
      downsample_to: [384, 384],
    },
    reason: "Need a bounded color view of the Sensorium scene for this task.",
    activation_performed: false,
  },
};

const context = {
  catalog,
  providerRegistry,
  now: () => "2026-05-17T12:10:00.000Z",
  createId: () => "grant-sensorium-color",
};

test("buildSensoriumGrantCreateCandidateFromProposal returns validated grant input without writing", () => {
  const result = buildSensoriumGrantCreateCandidateFromProposal(approvedProposal, context);

  assert.equal(result.source_proposal_id, "proposal-sensorium-color");
  assert.equal(result.activation_performed, false);
  assert.equal(result.grant_written, false);
  assert.equal(result.subscription_activated, false);

  assert.equal(result.grant_create_input.id, "grant-sensorium-color");
  assert.equal(result.grant_create_input.status, "active");
  assert.equal(result.grant_create_input.capability, "perception.sensorium.color.subscribe");
  assert.equal(result.grant_create_input.provider, "soma.provider.sensorium.jetsorano");
  assert.equal(result.grant_create_input.scope, "session");
  assert.equal(result.grant_create_input.approved_by, "user");
  assert.equal(result.grant_create_input.approval_provenance_id, "prov-approval");
  assert.equal(result.grant_create_input.activation_performed, false);
  assert.deepEqual(result.grant_create_input.constraints, {
    max_seconds: 600,
    max_fps: 5,
    format_required: "jpeg",
    downsample_to: [384, 384],
    topic: "sensor/jetsorano/realsense/color",
  });
});

test("buildSensoriumGrantCreateCandidateFromProposal rejects pending proposals", () => {
  assertSensoriumCandidateError(
    () => buildSensoriumGrantCreateCandidateFromProposal({
      ...approvedProposal,
      status: "pending",
      decision: undefined,
    }, context),
    "invalid_sensorium_grant_candidate",
  );
});

test("buildSensoriumGrantCreateCandidateFromProposal rejects capability design proposals", () => {
  assertSensoriumCandidateError(
    () => buildSensoriumGrantCreateCandidateFromProposal({
      ...approvedProposal,
      type: "capability_design",
    }, context),
    "sensorium_grant_candidate_rejects_capability_design",
  );
});

test("buildSensoriumGrantCreateCandidateFromProposal requires approval provenance", () => {
  assertSensoriumCandidateError(
    () => buildSensoriumGrantCreateCandidateFromProposal({
      ...approvedProposal,
      decision: {
        ...approvedProposal.decision,
        provenance_id: "",
      },
    }, context),
    "invalid_sensorium_grant_candidate",
  );
});

test("buildSensoriumGrantCreateCandidateFromProposal rejects metadata drift", () => {
  assertSensoriumCandidateError(
    () => buildSensoriumGrantCreateCandidateFromProposal({
      ...approvedProposal,
      review_context: {
        ...approvedProposal.review_context,
        topic: "sensor/jetsorano/realsense/depth",
      },
    }, context),
    "invalid_sensorium_grant_candidate",
  );

  assertSensoriumCandidateError(
    () => buildSensoriumGrantCreateCandidateFromProposal({
      ...approvedProposal,
      grant_intent: {
        ...approvedProposal.grant_intent,
        provider: "soma.provider.other",
      },
    }, context),
    "invalid_sensorium_grant_candidate",
  );
});

function assertSensoriumCandidateError(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code);
    assert.equal(Array.isArray(error.validation_errors), true);
    return true;
  });
}

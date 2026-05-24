import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRemoteGraphicalSessionOpenBrokerFailure,
  buildRemoteGraphicalSessionOpenFixtureSuccess,
  buildRemoteGraphicalSessionOpenRefusal,
  buildRemoteGraphicalSessionOpenReview,
  remoteGraphicalBrokerRefusalFromStatus,
} from "../src/remoteGraphicalSessionOpenReview.js";

test("buildRemoteGraphicalSessionOpenReview returns non-activating session-open review", () => {
  const review = buildRemoteGraphicalSessionOpenReview({
    grant: makeGrant(),
    reason: "Need to prepare a reviewed broker session before observation.",
  });

  assert.equal(review.type, "remote_graphical_session_open_review");
  assert.equal(review.source_grant_id, "grant-remote-video");
  assert.equal(review.broker_action, "open_session");
  assert.equal(review.review.session_open_authority, "review_required");
  assert.equal(review.review.video_observation_authority, "separate_action_required");
  assert.equal(review.review.input_authority, "separate_action_required");
  assert.equal(review.review.recording_authority, "not_requested");
  assert.equal(review.activation_performed, false);
  assert.equal(review.review_only, true);
  assert.equal(review.grant_written, false);
  assert.equal(review.broker_called, false);
  assert.equal(review.session_opened, false);
  assert.equal(review.video_attached, false);
  assert.equal(review.input_dispatched, false);
  assert.equal(review.recording_started, false);
  assert.equal(review.model_delivery, false);
  assert.equal(review.live_transport_used, false);
});

test("buildRemoteGraphicalSessionOpenReview rejects inactive malformed or non-remote grants", () => {
  assertSessionOpenError(() => buildRemoteGraphicalSessionOpenReview({
    grant: { ...makeGrant(), status: "revoked" },
    reason: "Need session.",
  }), /active grant/);

  assertSessionOpenError(() => buildRemoteGraphicalSessionOpenReview({
    grant: { ...makeGrant(), capability: "desktop.inspect.focus" },
    reason: "Need session.",
  }), /remote graphical grant/);

  assertSessionOpenError(() => buildRemoteGraphicalSessionOpenReview({
    grant: {
      ...makeGrant(),
      constraints: {
        ...makeGrant().constraints,
        target_host: "",
      },
    },
    reason: "Need session.",
  }), /target_host/);

  assertSessionOpenError(() => buildRemoteGraphicalSessionOpenReview({
    grant: makeGrant(),
  }), /reason/);
});

test("buildRemoteGraphicalSessionOpenRefusal fails closed without runtime opt-in", () => {
  const refusal = buildRemoteGraphicalSessionOpenRefusal({
    grant: makeGrant(),
    actor: "user",
    reason: "Need to open a reviewed broker session.",
  });

  assert.equal(refusal.type, "remote_graphical_session_open_refusal");
  assert.equal(refusal.refused, true);
  assert.equal(refusal.status, "broker_not_enabled");
  assert.equal(refusal.state, "disabled");
  assert.equal(refusal.error, "remote_graphical_broker_not_enabled");
  assert.equal(refusal.source_grant_id, "grant-remote-video");
  assert.equal(refusal.review_only, false);
  assert.equal(refusal.broker_called, false);
  assert.equal(refusal.session_opened, false);
  assert.equal(refusal.pairing_performed, false);
  assert.equal(refusal.video_attached, false);
  assert.equal(refusal.input_dispatched, false);
  assert.equal(refusal.recording_started, false);
  assert.equal(refusal.model_delivery, false);
  assert.equal(refusal.live_transport_used, false);
});

test("buildRemoteGraphicalSessionOpenRefusal distinguishes missing and fake configured brokers", () => {
  const notConfigured = buildRemoteGraphicalSessionOpenRefusal({
    grant: makeGrant(),
    actor: "user",
    reason: "Need to open a reviewed broker session.",
    brokerStatus: {
      requested: true,
      enabled: true,
      configured: false,
      state: "unconfigured",
    },
  });
  assert.equal(notConfigured.status, "provider_not_configured");
  assert.equal(notConfigured.error, "remote_graphical_broker_not_configured");
  assert.equal(notConfigured.broker_called, false);

  const fakeConfigured = buildRemoteGraphicalSessionOpenRefusal({
    grant: makeGrant(),
    actor: "user",
    reason: "Need to open a reviewed broker session.",
    brokerStatus: {
      requested: true,
      enabled: true,
      configured: true,
      status: "available",
      state: "paired_inactive",
    },
  });
  assert.equal(fakeConfigured.status, "available");
  assert.equal(fakeConfigured.state, "paired_inactive");
  assert.equal(fakeConfigured.error, "remote_graphical_broker_provider_unavailable");
  assert.equal(fakeConfigured.broker_called, false);
  assert.equal(fakeConfigured.session_opened, false);
});

test("remoteGraphicalBrokerRefusalFromStatus maps broker posture to bounded refusal codes", () => {
  assert.deepEqual(remoteGraphicalBrokerRefusalFromStatus({}), {
    code: "remote_graphical_broker_not_enabled",
    status: "broker_not_enabled",
    state: "disabled",
    message: "Remote graphical session-open requires explicit runtime opt-in before broker use.",
  });
  assert.equal(remoteGraphicalBrokerRefusalFromStatus({
    requested: true,
    enabled: true,
    configured: false,
  }).code, "remote_graphical_broker_not_configured");
  assert.equal(remoteGraphicalBrokerRefusalFromStatus({
    requested: true,
    enabled: true,
    configured: true,
  }).code, "remote_graphical_broker_provider_unavailable");
});

test("buildRemoteGraphicalSessionOpenFixtureSuccess returns bounded fixture-only activation", () => {
  const review = buildRemoteGraphicalSessionOpenReview({
    grant: makeGrant(),
    reason: "Need to open a reviewed broker session.",
  });
  const result = buildRemoteGraphicalSessionOpenFixtureSuccess({
    review,
    brokerResult: {
      session_id: "fixture-session-1",
      status: "opened",
      state: "open",
      payload_bytes: "forbidden but not copied",
    },
  });

  assert.equal(result.type, "remote_graphical_session_open_result");
  assert.equal(result.refused, false);
  assert.equal(result.session_id, "fixture-session-1");
  assert.equal(result.activation_performed, true);
  assert.equal(result.broker_called, true);
  assert.equal(result.session_opened, true);
  assert.equal(result.fixture_only, true);
  assert.equal(result.live_transport_used, false);
  assert.equal(result.video_attached, false);
  assert.equal(result.input_dispatched, false);
  assert.equal(result.recording_started, false);
  assert.equal(result.model_delivery, false);
  assert.equal(Object.hasOwn(result, "payload_bytes"), false);
});

test("buildRemoteGraphicalSessionOpenFixtureSuccess requires a bounded session id", () => {
  const review = buildRemoteGraphicalSessionOpenReview({
    grant: makeGrant(),
    reason: "Need to open a reviewed broker session.",
  });

  assert.throws(() => buildRemoteGraphicalSessionOpenFixtureSuccess({
    review,
    brokerResult: {},
  }), {
    code: "remote_graphical_broker_session_open_failed",
  });
});

test("buildRemoteGraphicalSessionOpenBrokerFailure returns bounded failure after broker call", () => {
  const review = buildRemoteGraphicalSessionOpenReview({
    grant: makeGrant(),
    reason: "Need to open a reviewed broker session.",
  });
  const cause = new Error("fixture failed with internal details");
  cause.code = "fixture_failed";
  const result = buildRemoteGraphicalSessionOpenBrokerFailure({ review, cause });

  assert.equal(result.type, "remote_graphical_session_open_refusal");
  assert.equal(result.refused, true);
  assert.equal(result.error, "remote_graphical_broker_session_open_failed");
  assert.equal(result.cause_code, "fixture_failed");
  assert.equal(result.broker_called, true);
  assert.equal(result.session_opened, false);
  assert.equal(result.live_transport_used, false);
  assert.equal(result.message.includes("internal details"), false);
});

test("buildRemoteGraphicalSessionOpenRefusal requires user actor", () => {
  assert.throws(() => buildRemoteGraphicalSessionOpenRefusal({
    grant: makeGrant(),
    actor: "assistant",
    reason: "Need session.",
  }), {
    code: "remote_graphical_session_open_requires_user_actor",
  });
});

function assertSessionOpenError(fn, pattern) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, "invalid_remote_graphical_session_open_review");
    assert.match(error.message, pattern);
    return true;
  });
}

function makeGrant() {
  return {
    id: "grant-remote-video",
    status: "active",
    capability: "perception.remote_desktop.video.subscribe",
    provider: "soma.provider.remote_desktop.sunshine",
    scope: "session",
    constraints: {
      target_host: "soma-agent-desktop.local.sthnet.org",
      mode: "view_only",
      locality: "lan",
      attended: true,
      requested_channels: ["video"],
      max_seconds: 120,
      max_fps: 30,
      max_width: 1280,
      max_height: 720,
    },
  };
}

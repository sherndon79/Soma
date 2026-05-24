import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRemoteGraphicalSessionOpenRefusal,
  buildRemoteGraphicalSessionOpenReview,
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

test("buildRemoteGraphicalSessionOpenRefusal fails closed without broker activation", () => {
  const refusal = buildRemoteGraphicalSessionOpenRefusal({
    grant: makeGrant(),
    actor: "user",
    reason: "Need to open a reviewed broker session.",
  });

  assert.equal(refusal.type, "remote_graphical_session_open_refusal");
  assert.equal(refusal.refused, true);
  assert.equal(refusal.status, "provider_not_configured");
  assert.equal(refusal.state, "unconfigured");
  assert.equal(refusal.error, "provider_not_configured");
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

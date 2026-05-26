import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRemoteGraphicalLiveSessionOpenFailure,
  buildRemoteGraphicalLiveSessionOpenSuccess,
} from "../src/remoteGraphicalLiveSessionOpenResult.js";

test("buildRemoteGraphicalLiveSessionOpenSuccess composes result disclosure and provenance preview", () => {
  const result = buildRemoteGraphicalLiveSessionOpenSuccess({
    review: makeReview(),
    brokerResult: {
      session_id: "live-session-1",
      provider: "soma.provider.remote_desktop.sunshine",
      target_host: "soma-agent-desktop.local.sthnet.org",
      locality: "lan",
      attended: true,
    },
    openedAt: "2026-05-26T12:00:00.000Z",
  });

  assert.equal(result.type, "remote_graphical_session_open_result");
  assert.equal(result.refused, false);
  assert.equal(result.status, "opened");
  assert.equal(result.state, "open_observe_inactive");
  assert.equal(result.session_id, "live-session-1");
  assert.equal(result.fixture_only, false);
  assert.equal(result.review_only, false);
  assert.equal(result.activation_performed, true);
  assert.equal(result.broker_called, true);
  assert.equal(result.session_opened, true);
  assert.equal(result.durable, false);
  assert.equal(result.grant_written, false);
  assert.equal(result.pairing_performed, false);
  assert.equal(result.video_attached, false);
  assert.equal(result.input_dispatched, false);
  assert.equal(result.recording_started, false);
  assert.equal(result.provider_session_stopped, false);
  assert.equal(result.model_delivery, false);
  assert.equal(result.live_transport_used, true);
  assert.equal(result.provenance_appended, false);

  assert.equal(result.active_disclosure.type, "remote_graphical_live_session_disclosure");
  assert.equal(result.active_disclosure.state, "open_observe_inactive");
  assert.deepEqual(result.active_disclosure.active_authorities, []);
  assert.deepEqual(result.active_disclosure.input_channels, []);
  assert.equal(result.active_disclosure.video.observing, false);
  assert.equal(result.active_disclosure.expires_at, "2026-05-26T12:02:00.000Z");

  assert.equal(result.provenance_preview.event_type, "remote_graphical.session_open.live");
  assert.equal(result.provenance_preview.outcome, "success");
  assert.equal(result.provenance_preview.session_id, "live-session-1");
  assert.equal(result.provenance_preview.fixture_only, false);
  assert.equal(result.provenance_preview.frames_included, false);
  assert.equal(result.provenance_preview.input_events_included, false);
  assert.equal(result.provenance_preview.transport_diagnostics_included, false);
});

test("buildRemoteGraphicalLiveSessionOpenSuccess rejects missing session id", () => {
  assert.throws(() => buildRemoteGraphicalLiveSessionOpenSuccess({
    review: makeReview(),
    brokerResult: {},
  }), {
    code: "invalid_remote_graphical_live_session_open_result",
  });
});

test("buildRemoteGraphicalLiveSessionOpenSuccess rejects content-bearing broker result fields", () => {
  assert.throws(() => buildRemoteGraphicalLiveSessionOpenSuccess({
    review: makeReview(),
    brokerResult: {
      session_id: "live-session-1",
      frame: "bytes",
    },
  }), (error) => {
    assert.equal(error.code, "invalid_remote_graphical_live_session_open_result");
    assert.match(error.message, /input\.brokerResult\.frame is forbidden/);
    return true;
  });
});

test("buildRemoteGraphicalLiveSessionOpenFailure returns bounded refusal with live provenance preview", () => {
  const cause = new Error("provider failed with internal details");
  cause.code = "sunshine_open_failed";
  const result = buildRemoteGraphicalLiveSessionOpenFailure({
    review: makeReview(),
    cause,
  });

  assert.equal(result.type, "remote_graphical_session_open_refusal");
  assert.equal(result.refused, true);
  assert.equal(result.status, "session_open_failed");
  assert.equal(result.state, "failed");
  assert.equal(result.error, "remote_graphical_live_broker_session_open_failed");
  assert.equal(result.cause_code, "sunshine_open_failed");
  assert.equal(result.message.includes("internal details"), false);
  assert.equal(result.fixture_only, false);
  assert.equal(result.review_only, false);
  assert.equal(result.activation_performed, false);
  assert.equal(result.broker_called, true);
  assert.equal(result.session_opened, false);
  assert.equal(result.video_attached, false);
  assert.equal(result.input_dispatched, false);
  assert.equal(result.model_delivery, false);
  assert.equal(result.live_transport_used, true);
  assert.equal(result.session_id, "");
  assert.equal(result.provenance_appended, false);
  assert.equal(result.provenance_preview.event_type, "remote_graphical.session_open.live");
  assert.equal(result.provenance_preview.outcome, "failure");
  assert.equal(result.provenance_preview.error, "remote_graphical_live_broker_session_open_failed");
  assert.equal(result.provenance_preview.cause_code, "sunshine_open_failed");
});

test("buildRemoteGraphicalLiveSessionOpenFailure requires stable cause code", () => {
  assert.throws(() => buildRemoteGraphicalLiveSessionOpenFailure({
    review: makeReview(),
    cause: new Error("missing code"),
  }), {
    code: "invalid_remote_graphical_live_session_open_result",
  });
});

test("buildRemoteGraphicalLiveSessionOpenFailure rejects content-bearing cause fields", () => {
  const cause = new Error("failure");
  cause.code = "sunshine_open_failed";
  cause.diagnostics = "forbidden";

  assert.throws(() => buildRemoteGraphicalLiveSessionOpenFailure({
    review: makeReview(),
    cause,
  }), (error) => {
    assert.equal(error.code, "invalid_remote_graphical_live_session_open_result");
    assert.match(error.message, /input\.cause\.diagnostics is forbidden/);
    return true;
  });
});

function makeReview() {
  return {
    type: "remote_graphical_session_open_review",
    requested_by: "assistant",
    source_grant_id: "grant-remote-video",
    capability: "perception.remote_desktop.video.subscribe",
    provider: "soma.provider.remote_desktop.sunshine",
    target_host: "soma-agent-desktop.local.sthnet.org",
    scope: "session",
    reason: "Need to open a reviewed broker session.",
    broker_action: "open_session",
    grant_constraints: {
      max_seconds: 120,
    },
    review: {
      locality: "lan",
      attended: true,
    },
  };
}

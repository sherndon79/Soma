import test from "node:test";
import assert from "node:assert/strict";

import {
  assertRemoteGraphicalLiveSessionDisclosure,
  createRemoteGraphicalLiveSessionDisclosure,
} from "../src/remoteGraphicalLiveSessionDisclosure.js";

test("createRemoteGraphicalLiveSessionDisclosure describes opened substrate without observation", () => {
  const disclosure = createRemoteGraphicalLiveSessionDisclosure({
    review: makeReview(),
    brokerResult: {
      session_id: "live-session-1",
      state: "ignored",
    },
    openedAt: new Date("2026-05-26T12:00:00.000Z"),
  });

  assert.equal(disclosure.type, "remote_graphical_live_session_disclosure");
  assert.equal(disclosure.session_id, "live-session-1");
  assert.equal(disclosure.source_grant_id, "grant-remote-video");
  assert.equal(disclosure.provider, "soma.provider.remote_desktop.sunshine");
  assert.equal(disclosure.target_host, "soma-agent-desktop.local.sthnet.org");
  assert.equal(disclosure.state, "open_observe_inactive");
  assert.equal(disclosure.locality, "lan");
  assert.equal(disclosure.attended, true);
  assert.equal(disclosure.opened_at, "2026-05-26T12:00:00.000Z");
  assert.equal(disclosure.expires_at, "2026-05-26T12:02:00.000Z");
  assert.deepEqual(disclosure.active_authorities, []);
  assert.deepEqual(disclosure.input_channels, []);
  assert.deepEqual(disclosure.video, {
    observing: false,
    frames_attached: false,
    screenshots_captured: false,
    recognized_text_included: false,
  });
  assert.equal(disclosure.recording, false);
  assert.equal(disclosure.model_delivery, false);
  assert.match(disclosure.disclosure, /video observation and input remain inactive/);
  assert.equal(disclosure.revocation.cleanup_action, "cleanup_for_grant");
  assert.equal(disclosure.activation_performed, true);
  assert.equal(disclosure.broker_called, true);
  assert.equal(disclosure.session_opened, true);
  assert.equal(disclosure.pairing_performed, false);
  assert.equal(disclosure.video_attached, false);
  assert.equal(disclosure.input_dispatched, false);
  assert.equal(disclosure.recording_started, false);
  assert.equal(disclosure.provider_session_stopped, false);
  assert.equal(disclosure.live_transport_used, true);
  assert.equal(disclosure.model_delivery_used, false);
});

test("createRemoteGraphicalLiveSessionDisclosure lets broker metadata narrow provider target and locality", () => {
  const disclosure = createRemoteGraphicalLiveSessionDisclosure({
    review: makeReview(),
    brokerResult: {
      session_id: "live-session-2",
      provider: "soma.provider.remote_desktop.sunshine",
      target_host: "soma-agent-desktop.local.sthnet.org",
      locality: "lan",
      attended: false,
    },
    openedAt: "2026-05-26T12:00:00.000Z",
  });

  assert.equal(disclosure.attended, false);
  assert.equal(disclosure.locality, "lan");
});

test("createRemoteGraphicalLiveSessionDisclosure rejects missing bounded identity", () => {
  assert.throws(() => createRemoteGraphicalLiveSessionDisclosure({
    review: {
      source_grant_id: "",
      provider: "",
      target_host: "",
    },
    brokerResult: {},
    openedAt: "not-a-date",
  }), (error) => {
    assert.equal(error.code, "invalid_remote_graphical_live_session_disclosure");
    assert.deepEqual(error.validation_errors, [
      "live session disclosure requires session_id",
      "live session disclosure requires source_grant_id",
      "live session disclosure requires provider",
      "live session disclosure requires target_host",
      "live session disclosure requires valid opened_at",
    ]);
    return true;
  });
});

test("createRemoteGraphicalLiveSessionDisclosure rejects content-bearing input fields", () => {
  assert.throws(() => createRemoteGraphicalLiveSessionDisclosure({
    review: makeReview(),
    brokerResult: {
      session_id: "live-session-1",
      screenshot: "base64",
    },
  }), (error) => {
    assert.equal(error.code, "invalid_remote_graphical_live_session_disclosure");
    assert.match(error.message, /input\.brokerResult\.screenshot is forbidden/);
    return true;
  });
});

test("assertRemoteGraphicalLiveSessionDisclosure accepts only opened-but-not-observing disclosure", () => {
  const disclosure = createRemoteGraphicalLiveSessionDisclosure({
    review: makeReview(),
    brokerResult: { session_id: "live-session-1" },
    openedAt: "2026-05-26T12:00:00.000Z",
  });
  const validated = assertRemoteGraphicalLiveSessionDisclosure(disclosure);

  assert.deepEqual(validated, disclosure);
});

test("assertRemoteGraphicalLiveSessionDisclosure rejects authority drift", () => {
  const disclosure = createRemoteGraphicalLiveSessionDisclosure({
    review: makeReview(),
    brokerResult: { session_id: "live-session-1" },
    openedAt: "2026-05-26T12:00:00.000Z",
  });
  disclosure.active_authorities = ["video"];
  disclosure.video.observing = true;

  assert.throws(() => assertRemoteGraphicalLiveSessionDisclosure(disclosure), (error) => {
    assert.equal(error.code, "invalid_remote_graphical_live_session_disclosure");
    assert.match(error.message, /active_authorities must be empty/);
    assert.match(error.message, /video\.observing must be false/);
    return true;
  });
});

test("assertRemoteGraphicalLiveSessionDisclosure rejects content-bearing disclosure fields", () => {
  const disclosure = createRemoteGraphicalLiveSessionDisclosure({
    review: makeReview(),
    brokerResult: { session_id: "live-session-1" },
    openedAt: "2026-05-26T12:00:00.000Z",
  });
  disclosure.video_frame = "bytes";

  assert.throws(() => assertRemoteGraphicalLiveSessionDisclosure(disclosure), {
    code: "invalid_remote_graphical_live_session_disclosure",
  });
});

function makeReview() {
  return {
    source_grant_id: "grant-remote-video",
    provider: "soma.provider.remote_desktop.sunshine",
    target_host: "soma-agent-desktop.local.sthnet.org",
    grant_constraints: {
      max_seconds: 120,
    },
    review: {
      locality: "lan",
      attended: true,
    },
  };
}

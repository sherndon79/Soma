import assert from "node:assert/strict";
import test from "node:test";

import {
  createRemoteGraphicalLiveBrokerActiveSessions,
  REMOTE_GRAPHICAL_LIVE_BROKER_ACTIVE_SESSIONS_SCHEMA_VERSION,
} from "../src/remoteGraphicalLiveBrokerActiveSessions.js";

test("createRemoteGraphicalLiveBrokerActiveSessions accepts empty active set", () => {
  const result = createRemoteGraphicalLiveBrokerActiveSessions({
    schema_version: 1,
    provider: "soma.provider.remote_desktop.sunshine",
    target_host: "soma-agent-desktop.local.sthnet.org",
    sessions: [],
  });

  assert.deepEqual(result, {
    schema_version: 1,
    schema_matches_expected: true,
    expected_schema_version: REMOTE_GRAPHICAL_LIVE_BROKER_ACTIVE_SESSIONS_SCHEMA_VERSION,
    family: "desktop.remote_graphical",
    provider: "soma.provider.remote_desktop.sunshine",
    target_host: "soma-agent-desktop.local.sthnet.org",
    active_count: 0,
    sessions: [],
    activation_performed: false,
    broker_called: false,
    session_opened: false,
    pairing_performed: false,
    video_attached: false,
    input_dispatched: false,
    recording_started: false,
    provider_session_stopped: false,
    model_delivery: false,
    live_transport_used: false,
  });
});

test("createRemoteGraphicalLiveBrokerActiveSessions accepts one bounded opened substrate session", () => {
  const result = createRemoteGraphicalLiveBrokerActiveSessions({
    schema_version: 1,
    provider: "soma.provider.remote_desktop.sunshine",
    target_host: "soma-agent-desktop.local.sthnet.org",
    sessions: [{
      session_id: "live-session-1",
      source_grant_id: "grant-remote-video",
      locality: "lan",
      attended: true,
      opened_at: "2026-05-27T12:00:00.000Z",
      expires_at: "2026-05-27T12:02:00.000Z",
      active_authorities: ["ignored"],
      input_channels: ["ignored"],
      recording: true,
      model_delivery: true,
    }],
  });

  assert.equal(result.active_count, 1);
  assert.deepEqual(result.sessions, [{
    session_id: "live-session-1",
    source_grant_id: "grant-remote-video",
    provider: "soma.provider.remote_desktop.sunshine",
    target_host: "soma-agent-desktop.local.sthnet.org",
    state: "open_observe_inactive",
    locality: "lan",
    attended: true,
    opened_at: "2026-05-27T12:00:00.000Z",
    expires_at: "2026-05-27T12:02:00.000Z",
    active_authorities: [],
    input_channels: [],
    video: {
      observing: false,
      frames_attached: false,
      screenshots_captured: false,
      recognized_text_included: false,
    },
    recording: false,
    model_delivery: false,
    session_opened: true,
    pairing_performed: false,
    video_attached: false,
    input_dispatched: false,
    recording_started: false,
    provider_session_stopped: false,
    live_transport_used: true,
    model_delivery_used: false,
  }]);
});

test("createRemoteGraphicalLiveBrokerActiveSessions reports schema mismatch without hiding observed version", () => {
  const result = createRemoteGraphicalLiveBrokerActiveSessions({
    schema_version: 2,
    sessions: [],
  });

  assert.equal(result.schema_version, 2);
  assert.equal(result.schema_matches_expected, false);
  assert.equal(result.expected_schema_version, 1);
});

test("createRemoteGraphicalLiveBrokerActiveSessions rejects malformed active session shapes", () => {
  assert.throws(
    () => createRemoteGraphicalLiveBrokerActiveSessions(null),
    { code: "remote_graphical_live_active_sessions_not_object" },
  );
  assert.throws(
    () => createRemoteGraphicalLiveBrokerActiveSessions({ sessions: {} }),
    { code: "remote_graphical_live_active_sessions_invalid" },
  );
  assert.throws(
    () => createRemoteGraphicalLiveBrokerActiveSessions({
      sessions: [{}],
    }),
    { code: "remote_graphical_live_active_session_invalid" },
  );
  assert.throws(
    () => createRemoteGraphicalLiveBrokerActiveSessions({
      provider: "soma.provider.remote_desktop.sunshine",
      target_host: "soma-agent-desktop.local.sthnet.org",
      sessions: [{
        session_id: "live-session-1",
        source_grant_id: "grant-remote-video",
        opened_at: "not-a-date",
      }],
    }),
    { code: "remote_graphical_live_active_session_invalid" },
  );
});

test("createRemoteGraphicalLiveBrokerActiveSessions rejects content and provider secret fields", () => {
  assert.throws(
    () => createRemoteGraphicalLiveBrokerActiveSessions({
      provider: "soma.provider.remote_desktop.sunshine",
      target_host: "soma-agent-desktop.local.sthnet.org",
      sessions: [{
        session_id: "live-session-1",
        source_grant_id: "grant-remote-video",
        screenshot: "not allowed",
      }],
    }),
    { code: "remote_graphical_live_active_sessions_forbidden_field" },
  );
  assert.throws(
    () => createRemoteGraphicalLiveBrokerActiveSessions({
      provider: "soma.provider.remote_desktop.sunshine",
      target_host: "soma-agent-desktop.local.sthnet.org",
      credentials: {
        token: "not allowed",
      },
      sessions: [],
    }),
    { code: "remote_graphical_live_active_sessions_forbidden_field" },
  );
});

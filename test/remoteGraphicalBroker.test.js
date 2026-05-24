import test from "node:test";
import assert from "node:assert/strict";

import {
  createRemoteGraphicalBrokerStatus,
  RemoteGraphicalBroker,
} from "../src/remoteGraphicalBroker.js";

test("RemoteGraphicalBroker defaults to provider_not_configured without activation", () => {
  const broker = new RemoteGraphicalBroker();
  const status = broker.describeActive();

  assert.equal(status.family, "desktop.remote_graphical");
  assert.equal(status.requested, false);
  assert.equal(status.enabled, false);
  assert.equal(status.configured, false);
  assert.equal(status.status, "provider_not_configured");
  assert.equal(status.state, "unconfigured");
  assert.equal(status.active_count, 0);
  assert.deepEqual(status.sessions, []);
  assert.equal(status.activation_performed, false);
  assert.equal(status.grant_written, false);
  assert.equal(status.session_opened, false);
  assert.equal(status.pairing_performed, false);
  assert.equal(status.video_attached, false);
  assert.equal(status.input_dispatched, false);
  assert.equal(status.recording_started, false);
  assert.equal(status.provider_session_stopped, false);
  assert.equal(status.model_delivery, false);
  assert.equal(status.live_transport_used, false);
});

test("RemoteGraphicalBroker reports requested opt-in while remaining unconfigured", () => {
  const broker = new RemoteGraphicalBroker({
    runtimePosture: {
      requested: true,
      enabled: false,
      configured: false,
    },
  });
  const status = broker.describeActive();

  assert.equal(status.requested, true);
  assert.equal(status.enabled, false);
  assert.equal(status.configured, false);
  assert.equal(status.status, "provider_not_configured");
  assert.equal(status.state, "unconfigured");
  assert.equal(status.live_transport_used, false);
  assert.match(status.summary, /opt-in requested/);
});

test("createRemoteGraphicalBrokerStatus normalizes injected session disclosure", () => {
  const status = createRemoteGraphicalBrokerStatus({
    configured: true,
    status: "available",
    state: "paired_inactive",
    provider: "soma.provider.remote_desktop.sunshine",
    target_host: "soma-agent-desktop.local.sthnet.org",
    sessions: [{
      id: "session-1",
      targetHost: "soma-agent-desktop.local.sthnet.org",
      provider: "soma.provider.remote_desktop.sunshine",
      state: "paired_inactive",
      active_authorities: ["video", ""],
      input_channels: ["pointer"],
      video: {
        max_fps: 30,
        max_width: 1280,
        max_height: 720,
      },
      recording: false,
      model_delivery: false,
    }],
  });

  assert.equal(status.configured, true);
  assert.equal(status.requested, false);
  assert.equal(status.enabled, true);
  assert.equal(status.active_count, 1);
  assert.equal(status.sessions[0].session_id, "session-1");
  assert.deepEqual(status.sessions[0].active_authorities, ["video"]);
  assert.deepEqual(status.sessions[0].input_channels, ["pointer"]);
  assert.deepEqual(status.sessions[0].video, {
    max_fps: 30,
    max_width: 1280,
    max_height: 720,
  });
  assert.equal(status.sessions[0].recording, false);
  assert.equal(status.sessions[0].model_delivery, false);
  assert.equal(status.activation_performed, false);
  assert.equal(status.live_transport_used, false);
});

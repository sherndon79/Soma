import assert from "node:assert/strict";
import test from "node:test";

import {
  createRemoteGraphicalLiveBrokerStatus,
  REMOTE_GRAPHICAL_LIVE_BROKER_STATUS_SCHEMA_VERSION,
} from "../src/remoteGraphicalLiveBrokerStatus.js";

test("createRemoteGraphicalLiveBrokerStatus accepts bounded configured status metadata", () => {
  const status = createRemoteGraphicalLiveBrokerStatus({
    schema_version: 1,
    provider: "soma.provider.remote_desktop.sunshine",
    target_host: "soma-agent-desktop.local.sthnet.org",
    status: "provider_configured",
    state: "configured_inactive",
    configured: true,
    reachable: true,
    active_count: 0,
    capabilities: ["status", "open_session", ""],
    summary: "Sunshine provider configured; no session is open.",
  });

  assert.deepEqual(status, {
    schema_version: 1,
    schema_matches_expected: true,
    expected_schema_version: REMOTE_GRAPHICAL_LIVE_BROKER_STATUS_SCHEMA_VERSION,
    family: "desktop.remote_graphical",
    provider: "soma.provider.remote_desktop.sunshine",
    target_host: "soma-agent-desktop.local.sthnet.org",
    status: "provider_configured",
    state: "configured_inactive",
    configured: true,
    reachable: true,
    degraded: false,
    retryable: null,
    active_count: 0,
    capabilities: ["status", "open_session"],
    summary: "Sunshine provider configured; no session is open.",
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

test("createRemoteGraphicalLiveBrokerStatus accepts unconfigured status without provider identity", () => {
  const status = createRemoteGraphicalLiveBrokerStatus({
    configured: false,
    status: "provider_not_configured",
    state: "unconfigured",
  });

  assert.equal(status.configured, false);
  assert.equal(status.provider, "");
  assert.equal(status.target_host, "");
  assert.equal(status.status, "provider_not_configured");
  assert.equal(status.state, "unconfigured");
  assert.equal(status.schema_version, 1);
  assert.equal(status.live_transport_used, false);
});

test("createRemoteGraphicalLiveBrokerStatus accepts degraded provider status without activation", () => {
  const status = createRemoteGraphicalLiveBrokerStatus({
    provider: "soma.provider.remote_desktop.sunshine",
    target_host: "soma-agent-desktop.local.sthnet.org",
    configured: true,
    degraded: true,
    reachable: false,
    retryable: true,
    summary: "Provider configured but unreachable.",
  });

  assert.equal(status.status, "provider_degraded");
  assert.equal(status.state, "degraded");
  assert.equal(status.degraded, true);
  assert.equal(status.reachable, false);
  assert.equal(status.retryable, true);
  assert.equal(status.broker_called, false);
  assert.equal(status.session_opened, false);
});

test("createRemoteGraphicalLiveBrokerStatus reports schema mismatch without hiding observed version", () => {
  const status = createRemoteGraphicalLiveBrokerStatus({
    schema_version: 2,
    provider: "soma.provider.remote_desktop.sunshine",
    target_host: "soma-agent-desktop.local.sthnet.org",
    configured: true,
  });

  assert.equal(status.schema_version, 2);
  assert.equal(status.schema_matches_expected, false);
  assert.equal(status.expected_schema_version, 1);
});

test("createRemoteGraphicalLiveBrokerStatus rejects malformed and over-disclosing status", () => {
  assert.throws(
    () => createRemoteGraphicalLiveBrokerStatus(null),
    { code: "remote_graphical_live_status_not_object" },
  );
  assert.throws(
    () => createRemoteGraphicalLiveBrokerStatus({
      configured: true,
      provider: "soma.provider.remote_desktop.sunshine",
    }),
    { code: "remote_graphical_live_status_invalid" },
  );
  assert.throws(
    () => createRemoteGraphicalLiveBrokerStatus({
      configured: true,
      provider: "soma.provider.remote_desktop.sunshine",
      target_host: "soma-agent-desktop.local.sthnet.org",
      screenshot_bytes: "not allowed",
    }),
    { code: "remote_graphical_live_status_forbidden_field" },
  );
  assert.throws(
    () => createRemoteGraphicalLiveBrokerStatus({
      configured: true,
      provider: "soma.provider.remote_desktop.sunshine",
      target_host: "soma-agent-desktop.local.sthnet.org",
      nested: {
        credentials: {
          token: "not allowed",
        },
      },
    }),
    { code: "remote_graphical_live_status_forbidden_field" },
  );
});

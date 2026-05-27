import assert from "node:assert/strict";
import test from "node:test";

import {
  createRemoteGraphicalLiveBrokerCleanupResult,
  REMOTE_GRAPHICAL_LIVE_BROKER_CLEANUP_SCHEMA_VERSION,
} from "../src/remoteGraphicalLiveBrokerCleanupResult.js";

test("createRemoteGraphicalLiveBrokerCleanupResult accepts no-op cleanup metadata", () => {
  const result = createRemoteGraphicalLiveBrokerCleanupResult({
    schema_version: 1,
    source_grant_id: "grant-remote-video",
    provider: "soma.provider.remote_desktop.sunshine",
    target_host: "soma-agent-desktop.local.sthnet.org",
    reason: "revoked",
  });

  assert.deepEqual(result, {
    schema_version: 1,
    schema_matches_expected: true,
    expected_schema_version: REMOTE_GRAPHICAL_LIVE_BROKER_CLEANUP_SCHEMA_VERSION,
    family: "desktop.remote_graphical",
    action: "cleanup_for_grant",
    source_grant_id: "grant-remote-video",
    provider: "soma.provider.remote_desktop.sunshine",
    target_host: "soma-agent-desktop.local.sthnet.org",
    status: "cleanup_noop",
    reason: "revoked",
    stopped_count: 0,
    stopped_session_ids: [],
    cleanup_needed: false,
    retryable: null,
    cause_code: "",
    summary: "Remote graphical cleanup found no Soma-opened provider sessions to stop.",
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

test("createRemoteGraphicalLiveBrokerCleanupResult accepts stopped-session cleanup metadata", () => {
  const result = createRemoteGraphicalLiveBrokerCleanupResult({
    source_grant_id: "grant-remote-video",
    provider: "soma.provider.remote_desktop.sunshine",
    target_host: "soma-agent-desktop.local.sthnet.org",
    reason: "shutdown",
    stopped_session_ids: ["live-session-1", "", "live-session-2"],
    summary: "Stopped Soma-opened provider sessions.",
  });

  assert.equal(result.status, "cleanup_completed");
  assert.equal(result.stopped_count, 2);
  assert.deepEqual(result.stopped_session_ids, ["live-session-1", "live-session-2"]);
  assert.equal(result.cleanup_needed, false);
  assert.equal(result.provider_session_stopped, true);
  assert.equal(result.live_transport_used, true);
  assert.equal(result.video_attached, false);
  assert.equal(result.input_dispatched, false);
  assert.equal(result.summary, "Stopped Soma-opened provider sessions.");
});

test("createRemoteGraphicalLiveBrokerCleanupResult accepts bounded failed cleanup metadata", () => {
  const result = createRemoteGraphicalLiveBrokerCleanupResult({
    source_grant_id: "grant-remote-video",
    provider: "soma.provider.remote_desktop.sunshine",
    target_host: "soma-agent-desktop.local.sthnet.org",
    status: "cleanup_failed",
    reason: "error_recovery",
    cause_code: "helper_timeout",
    retryable: true,
  });

  assert.equal(result.status, "cleanup_failed");
  assert.equal(result.cleanup_needed, true);
  assert.equal(result.cause_code, "helper_timeout");
  assert.equal(result.retryable, true);
  assert.equal(result.provider_session_stopped, false);
  assert.equal(result.live_transport_used, true);
  assert.match(result.summary, /cleanup failed/i);
});

test("createRemoteGraphicalLiveBrokerCleanupResult reports schema mismatch without hiding observed version", () => {
  const result = createRemoteGraphicalLiveBrokerCleanupResult({
    schema_version: 2,
    source_grant_id: "grant-remote-video",
  });

  assert.equal(result.schema_version, 2);
  assert.equal(result.schema_matches_expected, false);
  assert.equal(result.expected_schema_version, 1);
});

test("createRemoteGraphicalLiveBrokerCleanupResult rejects malformed cleanup metadata", () => {
  assert.throws(
    () => createRemoteGraphicalLiveBrokerCleanupResult(null),
    { code: "remote_graphical_live_cleanup_result_not_object" },
  );
  assert.throws(
    () => createRemoteGraphicalLiveBrokerCleanupResult({}),
    { code: "remote_graphical_live_cleanup_result_invalid" },
  );
  assert.throws(
    () => createRemoteGraphicalLiveBrokerCleanupResult({
      source_grant_id: "grant-remote-video",
      reason: "provider_policy_delete_credentials",
    }),
    { code: "remote_graphical_live_cleanup_result_invalid" },
  );
  assert.throws(
    () => createRemoteGraphicalLiveBrokerCleanupResult({
      source_grant_id: "grant-remote-video",
      status: "cleanup_failed",
    }),
    { code: "remote_graphical_live_cleanup_result_invalid" },
  );
  assert.throws(
    () => createRemoteGraphicalLiveBrokerCleanupResult({
      source_grant_id: "grant-remote-video",
      stopped_session_ids: "live-session-1",
    }),
    { code: "remote_graphical_live_cleanup_result_invalid" },
  );
});

test("createRemoteGraphicalLiveBrokerCleanupResult rejects content and provider secret fields", () => {
  assert.throws(
    () => createRemoteGraphicalLiveBrokerCleanupResult({
      source_grant_id: "grant-remote-video",
      screenshot: "not allowed",
    }),
    { code: "remote_graphical_live_cleanup_result_forbidden_field" },
  );
  assert.throws(
    () => createRemoteGraphicalLiveBrokerCleanupResult({
      source_grant_id: "grant-remote-video",
      nested: {
        credentials: {
          token: "not allowed",
        },
      },
    }),
    { code: "remote_graphical_live_cleanup_result_forbidden_field" },
  );
});

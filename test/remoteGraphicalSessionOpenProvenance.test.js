import assert from "node:assert/strict";
import test from "node:test";

import {
  createRemoteGraphicalSessionOpenFixtureProvenanceSummary,
  createRemoteGraphicalSessionOpenLiveProvenanceSummary,
} from "../src/remoteGraphicalSessionOpenProvenance.js";

test("createRemoteGraphicalSessionOpenFixtureProvenanceSummary returns bounded success metadata", () => {
  const summary = createRemoteGraphicalSessionOpenFixtureProvenanceSummary({
    result: {
      type: "remote_graphical_session_open_result",
      source_grant_id: "grant-remote-video",
      capability: "perception.remote_desktop.video.subscribe",
      provider: "soma.provider.remote_desktop.sunshine",
      target_host: "soma-agent-desktop.local.sthnet.org",
      scope: "session",
      requested_by: "assistant",
      broker_action: "open_session",
      status: "opened",
      state: "open",
      session_id: "fixture-session-1",
      fixture_only: true,
      activation_performed: true,
      broker_called: true,
      session_opened: true,
      durable: false,
      grant_written: false,
      pairing_performed: false,
      video_attached: false,
      input_dispatched: false,
      recording_started: false,
      provider_session_stopped: false,
      model_delivery: false,
      live_transport_used: false,
    },
  });

  assert.deepEqual(summary, {
    event_type: "remote_graphical.session_open.fixture",
    outcome: "success",
    source_grant_id: "grant-remote-video",
    capability: "perception.remote_desktop.video.subscribe",
    provider: "soma.provider.remote_desktop.sunshine",
    target_host: "soma-agent-desktop.local.sthnet.org",
    scope: "session",
    requested_by: "assistant",
    broker_action: "open_session",
    status: "opened",
    state: "open",
    session_id: "fixture-session-1",
    error: "",
    cause_code: "",
    fixture_only: true,
    activation_performed: true,
    broker_called: true,
    session_opened: true,
    durable: false,
    grant_written: false,
    pairing_performed: false,
    video_attached: false,
    input_dispatched: false,
    recording_started: false,
    provider_session_stopped: false,
    model_delivery: false,
    live_transport_used: false,
    payload_bytes_included: false,
    frames_included: false,
    screenshots_included: false,
    recognized_text_included: false,
    clipboard_included: false,
    input_events_included: false,
    window_metadata_included: false,
    file_metadata_included: false,
    audio_payload_included: false,
    transport_diagnostics_included: false,
  });
});

test("createRemoteGraphicalSessionOpenFixtureProvenanceSummary returns bounded failure metadata", () => {
  const summary = createRemoteGraphicalSessionOpenFixtureProvenanceSummary({
    result: {
      type: "remote_graphical_session_open_refusal",
      source_grant_id: "grant-remote-video",
      capability: "perception.remote_desktop.video.subscribe",
      provider: "soma.provider.remote_desktop.sunshine",
      target_host: "soma-agent-desktop.local.sthnet.org",
      scope: "session",
      requested_by: "assistant",
      broker_action: "open_session",
      status: "session_open_failed",
      state: "failed",
      error: "remote_graphical_broker_session_open_failed",
      cause_code: "fixture_failed",
      broker_called: true,
      session_opened: false,
      live_transport_used: false,
    },
  });

  assert.equal(summary.outcome, "failure");
  assert.equal(summary.error, "remote_graphical_broker_session_open_failed");
  assert.equal(summary.cause_code, "fixture_failed");
  assert.equal(summary.session_id, "");
  assert.equal(summary.broker_called, true);
  assert.equal(summary.session_opened, false);
  assert.equal(summary.live_transport_used, false);
  assert.equal(summary.transport_diagnostics_included, false);
});

test("createRemoteGraphicalSessionOpenFixtureProvenanceSummary rejects content and diagnostics", () => {
  assert.throws(
    () => createRemoteGraphicalSessionOpenFixtureProvenanceSummary({
      result: {
        source_grant_id: "grant-remote-video",
        session_opened: true,
        session_id: "fixture-session-1",
        screenshot: "base64-not-allowed",
        nested: {
          input_events: [{ x: 1, y: 2 }],
          transport_log: "not allowed",
        },
      },
    }),
    (error) => {
      assert.equal(error.code, "invalid_remote_graphical_session_open_provenance");
      assert.ok(error.validation_errors.some((entry) => entry.includes("result.screenshot is forbidden")));
      assert.ok(error.validation_errors.some((entry) => entry.includes("result.nested.input_events is forbidden")));
      assert.ok(error.validation_errors.some((entry) => entry.includes("result.nested.transport_log is forbidden")));
      return true;
    },
  );
});

test("createRemoteGraphicalSessionOpenFixtureProvenanceSummary validates success and failure shape", () => {
  assert.throws(
    () => createRemoteGraphicalSessionOpenFixtureProvenanceSummary({
      result: {
        session_opened: true,
      },
    }),
    {
      code: "invalid_remote_graphical_session_open_provenance",
    },
  );

  assert.throws(
    () => createRemoteGraphicalSessionOpenFixtureProvenanceSummary({
      result: {
        session_opened: false,
      },
    }),
    {
      code: "invalid_remote_graphical_session_open_provenance",
    },
  );
});

test("createRemoteGraphicalSessionOpenLiveProvenanceSummary returns bounded success metadata", () => {
  const summary = createRemoteGraphicalSessionOpenLiveProvenanceSummary({
    result: {
      type: "remote_graphical_session_open_result",
      source_grant_id: "grant-remote-video",
      capability: "perception.remote_desktop.video.subscribe",
      provider: "soma.provider.remote_desktop.sunshine",
      target_host: "soma-agent-desktop.local.sthnet.org",
      scope: "session",
      requested_by: "user",
      broker_action: "open_session",
      status: "opened",
      state: "open_observe_inactive",
      session_id: "runtime-session-1",
      activation_performed: true,
      broker_called: true,
      session_opened: true,
      live_transport_used: true,
    },
  });

  assert.deepEqual(summary, {
    event_type: "remote_graphical.session_open.live",
    outcome: "success",
    source_grant_id: "grant-remote-video",
    capability: "perception.remote_desktop.video.subscribe",
    provider: "soma.provider.remote_desktop.sunshine",
    target_host: "soma-agent-desktop.local.sthnet.org",
    scope: "session",
    requested_by: "user",
    broker_action: "open_session",
    status: "opened",
    state: "open_observe_inactive",
    session_id: "runtime-session-1",
    error: "",
    cause_code: "",
    fixture_only: false,
    activation_performed: true,
    broker_called: true,
    session_opened: true,
    durable: false,
    grant_written: false,
    pairing_performed: false,
    video_attached: false,
    input_dispatched: false,
    recording_started: false,
    provider_session_stopped: false,
    model_delivery: false,
    live_transport_used: true,
    payload_bytes_included: false,
    frames_included: false,
    screenshots_included: false,
    recognized_text_included: false,
    clipboard_included: false,
    input_events_included: false,
    window_metadata_included: false,
    file_metadata_included: false,
    audio_payload_included: false,
    transport_diagnostics_included: false,
  });
});

test("session-open fixture and live provenance summaries keep event types distinct", () => {
  const fixture = createRemoteGraphicalSessionOpenFixtureProvenanceSummary({
    result: {
      source_grant_id: "grant-remote-video",
      session_opened: true,
      session_id: "fixture-session-1",
      activation_performed: true,
      broker_called: true,
    },
  });
  const live = createRemoteGraphicalSessionOpenLiveProvenanceSummary({
    result: {
      source_grant_id: "grant-remote-video",
      session_opened: true,
      session_id: "runtime-session-1",
      activation_performed: true,
      broker_called: true,
    },
  });

  assert.equal(fixture.event_type, "remote_graphical.session_open.fixture");
  assert.equal(fixture.fixture_only, true);
  assert.equal(fixture.live_transport_used, false);
  assert.equal(live.event_type, "remote_graphical.session_open.live");
  assert.equal(live.fixture_only, false);
  assert.equal(live.live_transport_used, true);
});

test("createRemoteGraphicalSessionOpenLiveProvenanceSummary returns bounded failure metadata", () => {
  const summary = createRemoteGraphicalSessionOpenLiveProvenanceSummary({
    result: {
      type: "remote_graphical_session_open_refusal",
      source_grant_id: "grant-remote-video",
      capability: "perception.remote_desktop.video.subscribe",
      provider: "soma.provider.remote_desktop.sunshine",
      target_host: "soma-agent-desktop.local.sthnet.org",
      scope: "session",
      requested_by: "user",
      broker_action: "open_session",
      status: "session_open_failed",
      state: "error",
      error: "remote_graphical_broker_session_open_failed",
      cause_code: "provider_unavailable",
      broker_called: true,
      session_opened: false,
    },
  });

  assert.equal(summary.event_type, "remote_graphical.session_open.live");
  assert.equal(summary.outcome, "failure");
  assert.equal(summary.session_id, "");
  assert.equal(summary.error, "remote_graphical_broker_session_open_failed");
  assert.equal(summary.cause_code, "provider_unavailable");
  assert.equal(summary.fixture_only, false);
  assert.equal(summary.broker_called, true);
  assert.equal(summary.session_opened, false);
  assert.equal(summary.live_transport_used, true);
  assert.equal(summary.transport_diagnostics_included, false);
});

test("createRemoteGraphicalSessionOpenLiveProvenanceSummary rejects content and diagnostics", () => {
  assert.throws(
    () => createRemoteGraphicalSessionOpenLiveProvenanceSummary({
      result: {
        source_grant_id: "grant-remote-video",
        session_opened: true,
        session_id: "runtime-session-1",
        frame_bytes: "not allowed",
        nested: {
          window_title: "not allowed",
          diagnostics: { stdout: "not allowed" },
        },
      },
    }),
    (error) => {
      assert.equal(error.code, "invalid_remote_graphical_session_open_provenance");
      assert.ok(error.validation_errors.some((entry) => entry.includes("result.frame_bytes is forbidden")));
      assert.ok(error.validation_errors.some((entry) => entry.includes("result.nested.window_title is forbidden")));
      assert.ok(error.validation_errors.some((entry) => entry.includes("result.nested.diagnostics is forbidden")));
      return true;
    },
  );
});

test("createRemoteGraphicalSessionOpenLiveProvenanceSummary validates success and failure shape", () => {
  assert.throws(
    () => createRemoteGraphicalSessionOpenLiveProvenanceSummary({
      result: {
        session_opened: true,
      },
    }),
    {
      code: "invalid_remote_graphical_session_open_provenance",
    },
  );

  assert.throws(
    () => createRemoteGraphicalSessionOpenLiveProvenanceSummary({
      result: {
        session_opened: false,
        cause_code: "provider_unavailable",
      },
    }),
    {
      code: "invalid_remote_graphical_session_open_provenance",
    },
  );

  assert.throws(
    () => createRemoteGraphicalSessionOpenLiveProvenanceSummary({
      result: {
        session_opened: false,
        error: "remote_graphical_broker_session_open_failed",
      },
    }),
    {
      code: "invalid_remote_graphical_session_open_provenance",
    },
  );
});

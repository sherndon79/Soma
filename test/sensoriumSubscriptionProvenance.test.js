import assert from "node:assert/strict";
import test from "node:test";

import {
  SENSORIUM_TERMINATION_REASONS,
  createSensoriumSubscriptionStartSummary,
  createSensoriumSubscriptionEndSummary,
} from "../src/sensoriumSubscriptionProvenance.js";

const VALID_START_INPUT = {
  capability: "perception.sensorium.color.subscribe",
  provider: "soma.provider.sensorium.jetsorano",
  grantId: "grant-test-1",
  scope: "session",
  topic: "sensor/jetsorano/realsense/color",
  constraints: {
    max_seconds: 600,
    max_fps: 5,
    downsample_to: [384, 384],
    format_required: "jpeg",
  },
  startedAt: "2026-05-15T07:00:00.000Z",
};

// ── subscription_started ────────────────────────────────────────────────────

test("subscription start summary captures declarative state, no counters", () => {
  const summary = createSensoriumSubscriptionStartSummary(VALID_START_INPUT);

  assert.equal(summary.event_type, "perception.sensorium.subscription_started");
  assert.equal(summary.timestamp, "2026-05-15T07:00:00.000Z");
  assert.equal(summary.capability, "perception.sensorium.color.subscribe");
  assert.equal(summary.provider, "soma.provider.sensorium.jetsorano");
  assert.equal(summary.grant_id, "grant-test-1");
  assert.equal(summary.scope, "session");
  assert.equal(summary.topic, "sensor/jetsorano/realsense/color");
  assert.deepEqual(summary.constraints_declared, {
    max_seconds: 600,
    max_fps: 5,
    downsample_to: [384, 384],
    format_required: "jpeg",
  });
  assert.equal(summary.text_content_included, false);
  assert.equal(summary.frames_recorded, false);

  // No counters at start time — those belong on the end event.
  assert.equal("frames_consumed" in summary, false);
  assert.equal("duration_seconds" in summary, false);
});

test("subscription start summary fills in current timestamp when startedAt is omitted", () => {
  const before = Date.now();
  const summary = createSensoriumSubscriptionStartSummary({
    ...VALID_START_INPUT,
    startedAt: undefined,
  });
  const ts = Date.parse(summary.timestamp);
  assert.ok(Number.isFinite(ts), "expected ISO timestamp");
  assert.ok(ts >= before - 1000 && ts <= Date.now() + 1000, "expected current time");
});

test("subscription start summary copies only declared constraints", () => {
  const summary = createSensoriumSubscriptionStartSummary({
    ...VALID_START_INPUT,
    constraints: {
      max_seconds: 60,
      max_fps: undefined,    // not declared — should be absent
      downsample_to: null,    // not declared — should be absent
    },
  });
  assert.deepEqual(summary.constraints_declared, { max_seconds: 60 });
});

test("subscription start summary rejects unknown capability", () => {
  assert.throws(
    () =>
      createSensoriumSubscriptionStartSummary({
        ...VALID_START_INPUT,
        capability: "perception.sensorium.future.subscribe",
      }),
    { code: "sensorium_provenance_invalid_capability" },
  );
});

test("subscription start summary rejects missing provider, grant, or topic", () => {
  assert.throws(
    () =>
      createSensoriumSubscriptionStartSummary({
        ...VALID_START_INPUT,
        provider: "",
      }),
    { code: "sensorium_provenance_invalid_provider" },
  );
  assert.throws(
    () =>
      createSensoriumSubscriptionStartSummary({
        ...VALID_START_INPUT,
        grantId: "",
      }),
    { code: "sensorium_provenance_invalid_grant" },
  );
  assert.throws(
    () =>
      createSensoriumSubscriptionStartSummary({
        ...VALID_START_INPUT,
        topic: "",
      }),
    { code: "sensorium_provenance_invalid_topic" },
  );
});

// ── subscription_ended ──────────────────────────────────────────────────────

test("subscription end summary captures aggregate counters and duration", () => {
  const startSummary = createSensoriumSubscriptionStartSummary(VALID_START_INPUT);
  const endSummary = createSensoriumSubscriptionEndSummary({
    startSummary,
    startedAt: "2026-05-15T07:00:00.000Z",
    endedAt: "2026-05-15T07:10:00.000Z",
    terminationReason: "clean_stop",
    framesConsumed: 8543,
    schemaVersionObserved: 1,
    schemaMismatches: 0,
    firstFrameNumber: 1,
    lastFrameNumber: 8543,
    statusSummaryObserved: {
      schema_version: 1,
      hostname: "jetsorano",
      uptime_seconds: 42.5,
      node_version: "0.1.0",
      enabled_streams: ["realsense/color"],
    },
  });

  assert.equal(endSummary.event_type, "perception.sensorium.subscription_ended");
  assert.equal(endSummary.capability, "perception.sensorium.color.subscribe");
  assert.equal(endSummary.provider, "soma.provider.sensorium.jetsorano");
  assert.equal(endSummary.grant_id, "grant-test-1");
  assert.equal(endSummary.scope, "session");
  assert.equal(endSummary.topic, "sensor/jetsorano/realsense/color");
  assert.equal(endSummary.started_at, "2026-05-15T07:00:00.000Z");
  assert.equal(endSummary.ended_at, "2026-05-15T07:10:00.000Z");
  assert.equal(endSummary.duration_seconds, 600); // 10 minutes
  assert.equal(endSummary.termination_reason, "clean_stop");
  assert.equal(endSummary.frames_consumed, 8543);
  assert.equal(endSummary.schema_version_observed, 1);
  assert.equal(endSummary.schema_mismatches, 0);
  assert.equal(endSummary.first_frame_number, 1);
  assert.equal(endSummary.last_frame_number, 8543);
  assert.equal(endSummary.error_class, "");
  assert.deepEqual(endSummary.status_summary_observed, {
    schema_version: 1,
    hostname: "jetsorano",
    uptime_seconds: 42.5,
    node_version: "0.1.0",
    enabled_streams: ["realsense/color"],
  });
  assert.equal(endSummary.text_content_included, false);
  assert.equal(endSummary.frames_recorded, false);
});

test("subscription end summary defaults counters to zero/null", () => {
  const startSummary = createSensoriumSubscriptionStartSummary(VALID_START_INPUT);
  const endSummary = createSensoriumSubscriptionEndSummary({
    startSummary,
    startedAt: "2026-05-15T07:00:00.000Z",
    endedAt: "2026-05-15T07:00:30.000Z",
    terminationReason: "error",
    errorClass: "helper_unreachable",
  });

  assert.equal(endSummary.frames_consumed, 0);
  assert.equal(endSummary.schema_version_observed, null);
  assert.equal(endSummary.schema_mismatches, 0);
  assert.equal(endSummary.first_frame_number, null);
  assert.equal(endSummary.last_frame_number, null);
  assert.equal(endSummary.error_class, "helper_unreachable");
});

test("subscription end summary rejects unknown termination reasons", () => {
  const startSummary = createSensoriumSubscriptionStartSummary(VALID_START_INPUT);
  for (const bad of ["aborted", "killed", "expired", "unknown"]) {
    assert.throws(
      () =>
        createSensoriumSubscriptionEndSummary({
          startSummary,
          startedAt: "2026-05-15T07:00:00.000Z",
          endedAt: "2026-05-15T07:00:01.000Z",
          terminationReason: bad,
        }),
      { code: "sensorium_provenance_invalid_termination_reason" },
      `expected rejection of terminationReason=${JSON.stringify(bad)}`,
    );
  }
});

test("subscription end summary rejects missing or malformed start summary", () => {
  for (const bad of [undefined, null, "not-an-object", { event_type: "wrong.kind" }]) {
    assert.throws(
      () =>
        createSensoriumSubscriptionEndSummary({
          startSummary: bad,
          startedAt: "2026-05-15T07:00:00.000Z",
          endedAt: "2026-05-15T07:00:01.000Z",
          terminationReason: "clean_stop",
        }),
      { code: "sensorium_provenance_invalid_start_summary" },
      `expected rejection of startSummary=${JSON.stringify(bad)}`,
    );
  }
});

test("subscription end summary rejects negative or non-integer counters", () => {
  const startSummary = createSensoriumSubscriptionStartSummary(VALID_START_INPUT);
  for (const bad of [-1, 1.5, "100", null]) {
    assert.throws(
      () =>
        createSensoriumSubscriptionEndSummary({
          startSummary,
          startedAt: "2026-05-15T07:00:00.000Z",
          endedAt: "2026-05-15T07:00:01.000Z",
          terminationReason: "clean_stop",
          framesConsumed: bad,
        }),
      { code: "sensorium_provenance_invalid_counter" },
      `expected rejection of framesConsumed=${JSON.stringify(bad)}`,
    );
  }
});

test("subscription end summary computes duration_seconds from ISO timestamps", () => {
  const startSummary = createSensoriumSubscriptionStartSummary(VALID_START_INPUT);
  const cases = [
    ["2026-05-15T07:00:00.000Z", "2026-05-15T07:00:00.000Z", 0],
    ["2026-05-15T07:00:00.000Z", "2026-05-15T07:00:30.000Z", 30],
    ["2026-05-15T07:00:00.000Z", "2026-05-15T08:00:00.000Z", 3600],
  ];
  for (const [started, ended, expected] of cases) {
    const endSummary = createSensoriumSubscriptionEndSummary({
      startSummary,
      startedAt: started,
      endedAt: ended,
      terminationReason: "clean_stop",
    });
    assert.equal(endSummary.duration_seconds, expected);
  }
});

test("subscription end summary returns null duration for malformed or reversed timestamps", () => {
  const startSummary = createSensoriumSubscriptionStartSummary(VALID_START_INPUT);
  const cases = [
    ["not-a-date", "2026-05-15T07:00:00.000Z"],
    ["2026-05-15T07:00:00.000Z", "also-not-a-date"],
    ["2026-05-15T08:00:00.000Z", "2026-05-15T07:00:00.000Z"], // reversed
  ];
  for (const [started, ended] of cases) {
    const endSummary = createSensoriumSubscriptionEndSummary({
      startSummary,
      startedAt: started,
      endedAt: ended,
      terminationReason: "clean_stop",
    });
    assert.equal(endSummary.duration_seconds, null);
  }
});

// ── content discipline ─────────────────────────────────────────────────────

test("subscription provenance summaries never include frame contents", () => {
  // Property test: both summaries should have text_content_included =
  // false and frames_recorded = false. This is the discipline that
  // separates provenance ("what happened") from logging ("what flowed").
  // A future change that flipped these to true would surface here.

  const startSummary = createSensoriumSubscriptionStartSummary(VALID_START_INPUT);
  assert.equal(startSummary.text_content_included, false);
  assert.equal(startSummary.frames_recorded, false);

  const endSummary = createSensoriumSubscriptionEndSummary({
    startSummary,
    startedAt: "2026-05-15T07:00:00.000Z",
    endedAt: "2026-05-15T07:00:30.000Z",
    terminationReason: "clean_stop",
    framesConsumed: 100,
  });
  assert.equal(endSummary.text_content_included, false);
  assert.equal(endSummary.frames_recorded, false);
});

test("subscription provenance publishes its allowed termination reason set", () => {
  assert.deepEqual([...SENSORIUM_TERMINATION_REASONS].sort(), [
    "channel_closed",
    "clean_stop",
    "error",
    "revoked",
    "schema_mismatch",
    "timeout",
  ]);
});

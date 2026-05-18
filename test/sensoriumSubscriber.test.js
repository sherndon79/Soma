import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";

import { SensoriumSubscriber } from "../src/sensoriumSubscriber.js";
import { encodeColorPayload, encodeStatusPayload } from "./support/msgpackStatus.js";

// ── fake manager ───────────────────────────────────────────────────────────
// A small EventEmitter that records sent requests and lets tests
// control the responses + emit notifications. No helper process, no
// Zenoh — exercises the composition logic in isolation.

class FakeManager extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
    this.nextStartId = 1;
    this.startResponses = []; // queue
    this.failNext = null;
  }

  enqueueStartSuccess({ subscriptionId, topic, startedAt }) {
    this.startResponses.push({
      subscription_id: subscriptionId,
      topic,
      started_at: startedAt,
    });
  }

  failNextSend(err) {
    this.failNext = err;
  }

  async send(method, params = {}) {
    this.calls.push({ method, params });

    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }

    if (method === "sensorium.subscribe.start") {
      if (this.startResponses.length > 0) {
        return this.startResponses.shift();
      }
      const id = `sub-${this.nextStartId++}`;
      return {
        subscription_id: id,
        topic: params.topic,
        started_at: 1_700_000_000.0,
      };
    }
    if (method === "sensorium.subscribe.stop") {
      return {
        subscription_id: params.subscription_id,
        topic: "unknown",
        stopped: true,
      };
    }
    if (method === "sensorium.subscribe.status") {
      return { subscriptions: [], count: 0 };
    }
    throw new Error(`fake manager has no handler for method ${method}`);
  }

  emitSample(subscriptionId, topic, payloadSizeOrOptions = 256) {
    const options = Array.isArray(payloadSizeOrOptions)
      ? { payloadBytes: payloadSizeOrOptions, payloadSize: payloadSizeOrOptions.length }
      : typeof payloadSizeOrOptions === "object"
        ? payloadSizeOrOptions
        : { payloadSize: payloadSizeOrOptions };
    const payloadBytes = options.payloadBytes ?? [];
    const payloadSize = options.payloadSize ?? payloadBytes.length;
    this.emit("notification", {
      jsonrpc: "2.0",
      method: "sensorium.subscription.sample",
      params: {
        subscription_id: subscriptionId,
        topic,
        payload_bytes: payloadBytes,
        payload_size: payloadSize,
      },
    });
  }

  emitStreamError(subscriptionId, errorClass) {
    this.emit("notification", {
      jsonrpc: "2.0",
      method: "sensorium.subscription.error",
      params: {
        subscription_id: subscriptionId,
        topic: "sensor/jetsorano/realsense/color",
        error_class: errorClass,
      },
    });
  }
}

const COMMON_START = {
  capability: "perception.sensorium.color.subscribe",
  provider: "soma.provider.sensorium.jetsorano",
  grantId: "grant-test-1",
  scope: "session",
  body: {
    topic: "sensor/jetsorano/realsense/color",
    constraints: {
      max_seconds: 60,
      max_fps: 5,
      format_required: "jpeg",
      downsample_to: [320, 240],
    },
  },
};

// ── start ──────────────────────────────────────────────────────────────────

test("subscriber.start composes validator, manager, and provenance correctly", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-fixed",
    topic: "sensor/jetsorano/realsense/color",
    startedAt: 1_700_000_000.0,
  });

  const subscriber = new SensoriumSubscriber({ manager });
  const result = await subscriber.start(COMMON_START);

  assert.equal(result.subscription_id, "sub-fixed");
  assert.equal(result.topic, "sensor/jetsorano/realsense/color");
  assert.equal(result.started_at, 1_700_000_000.0);

  assert.equal(manager.calls.length, 1);
  assert.equal(manager.calls[0].method, "sensorium.subscribe.start");
  assert.equal(manager.calls[0].params.topic, "sensor/jetsorano/realsense/color");

  const ss = result.startSummary;
  assert.equal(ss.event_type, "perception.sensorium.subscription_started");
  assert.equal(ss.capability, "perception.sensorium.color.subscribe");
  assert.equal(ss.provider, "soma.provider.sensorium.jetsorano");
  assert.equal(ss.grant_id, "grant-test-1");
  assert.equal(ss.topic, "sensor/jetsorano/realsense/color");
  assert.deepEqual(ss.constraints_declared, {
    max_seconds: 60,
    max_fps: 5,
    format_required: "jpeg",
    downsample_to: [320, 240],
  });
  assert.equal(ss.text_content_included, false);
  assert.equal(ss.frames_recorded, false);

  assert.equal(subscriber.activeCount, 1);
});

test("subscriber.start rejects malformed request bodies via the validator", async () => {
  const manager = new FakeManager();
  const subscriber = new SensoriumSubscriber({ manager });

  await assert.rejects(
    () =>
      subscriber.start({
        ...COMMON_START,
        body: { topic: "wrong-prefix/jetsorano/realsense/color" },
      }),
    { code: "sensorium_subscription_request_invalid" },
  );
  // Validator failure must NOT touch the manager.
  assert.equal(manager.calls.length, 0);
  assert.equal(subscriber.activeCount, 0);
});

test("subscriber.start propagates helper failure without storing state", async () => {
  const manager = new FakeManager();
  const helperErr = new Error("zenoh_open_failed");
  helperErr.code = -32603;
  helperErr.code_name = "zenoh_open_failed";
  manager.failNextSend(helperErr);

  const subscriber = new SensoriumSubscriber({ manager });
  await assert.rejects(() => subscriber.start(COMMON_START), { message: /zenoh_open_failed/ });
  assert.equal(subscriber.activeCount, 0);
});

test("subscriber.start passes optional Zenoh config path to the helper", async () => {
  const manager = new FakeManager();
  const subscriber = new SensoriumSubscriber({
    manager,
    zenohConfigPath: "/tmp/soma-sensorium-zenoh.json5",
  });

  await subscriber.start(COMMON_START);

  assert.equal(manager.calls.length, 1);
  assert.deepEqual(manager.calls[0].params, {
    topic: "sensor/jetsorano/realsense/color",
    max_fps: 5,
    downsample_to: [320, 240],
    format_required: "jpeg",
    zenoh_config_path: "/tmp/soma-sensorium-zenoh.json5",
  });
});

// ── stop ───────────────────────────────────────────────────────────────────

test("subscriber.stop returns an end provenance summary with the right counters", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-stop",
    topic: "sensor/jetsorano/realsense/color",
    startedAt: 1_700_000_000.0,
  });

  // Use a fixed clock so duration_seconds is deterministic.
  let nowMs = 1_700_000_000_000;
  const now = () => new Date(nowMs);

  const subscriber = new SensoriumSubscriber({ manager, now });
  const { subscription_id } = await subscriber.start(COMMON_START);

  // Advance the clock 30s and emit 8 sample notifications.
  for (let i = 0; i < 8; i++) {
    manager.emitSample(subscription_id, "sensor/jetsorano/realsense/color");
  }
  nowMs += 30_000;

  const { endSummary } = await subscriber.stop(subscription_id);

  assert.equal(endSummary.event_type, "perception.sensorium.subscription_ended");
  assert.equal(endSummary.termination_reason, "clean_stop");
  assert.equal(endSummary.frames_consumed, 8);
  assert.equal(endSummary.duration_seconds, 30);
  assert.equal(endSummary.text_content_included, false);
  assert.equal(endSummary.frames_recorded, false);

  assert.equal(subscriber.activeCount, 0);
  assert.equal(manager.calls.at(-1).method, "sensorium.subscribe.stop");
});

test("subscriber.stop with unknown id throws subscription_not_found", async () => {
  const manager = new FakeManager();
  const subscriber = new SensoriumSubscriber({ manager });
  await assert.rejects(() => subscriber.stop("no-such"), (err) => {
    assert.equal(err.code, "subscription_not_found");
    return true;
  });
});

test("subscriber.stopByGrantId stops every active subscription for a grant", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-a",
    topic: "sensor/jetsorano/realsense/color",
    startedAt: 1_700_000_000.0,
  });
  manager.enqueueStartSuccess({
    subscriptionId: "sub-b",
    topic: "sensor/jetsorano/realsense/color",
    startedAt: 1_700_000_001.0,
  });
  const subscriber = new SensoriumSubscriber({ manager });

  await subscriber.start(COMMON_START);
  await subscriber.start({
    ...COMMON_START,
    grantId: "grant-other",
  });

  const result = await subscriber.stopByGrantId("grant-test-1", {
    terminationReason: "revoked",
    errorClass: "grant_revoked",
  });

  assert.equal(result.stopped_count, 1);
  assert.equal(result.stopped[0].subscription_id, "sub-a");
  assert.equal(result.stopped[0].endSummary.termination_reason, "revoked");
  assert.equal(result.stopped[0].endSummary.error_class, "grant_revoked");
  assert.equal(subscriber.activeCount, 1);
});

test("subscriber.stop honors a custom termination reason and error class", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-err",
    topic: "sensor/jetsorano/status",
    startedAt: 1_700_000_000.0,
  });
  let nowMs = 1_700_000_000_000;
  const now = () => new Date(nowMs);
  const subscriber = new SensoriumSubscriber({ manager, now });
  const { subscription_id } = await subscriber.start({
    ...COMMON_START,
    capability: "perception.sensorium.status.subscribe",
    body: { topic: "sensor/jetsorano/status" },
  });

  nowMs += 5_000;
  const { endSummary } = await subscriber.stop(subscription_id, {
    terminationReason: "error",
    errorClass: "channel_closed_unexpectedly",
  });
  assert.equal(endSummary.termination_reason, "error");
  assert.equal(endSummary.error_class, "channel_closed_unexpectedly");
});

test("subscriber records helper stream errors as bounded metadata", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-helper-error",
    topic: "sensor/jetsorano/realsense/color",
    startedAt: 1_700_000_000.0,
  });
  const subscriber = new SensoriumSubscriber({ manager });
  const { subscription_id } = await subscriber.start(COMMON_START);

  manager.emitStreamError(subscription_id, "color_jpeg_decode_failed");

  const disclosure = subscriber.describeActive();
  assert.equal(disclosure.streams[0].helper_error_class, "color_jpeg_decode_failed");

  const { endSummary } = await subscriber.stop(subscription_id);
  assert.equal(endSummary.termination_reason, "error");
  assert.equal(endSummary.error_class, "color_jpeg_decode_failed");
  assert.equal(endSummary.frames_consumed, 0);
  assert.equal(JSON.stringify(endSummary).includes("payload_bytes"), false);
  assert.equal(JSON.stringify(endSummary).includes("sensor/jetsorano/realsense/color"), true);
});

test("subscriber sanitizes malformed helper stream error classes", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-helper-error-bad",
    topic: "sensor/jetsorano/realsense/color",
    startedAt: 1_700_000_000.0,
  });
  const subscriber = new SensoriumSubscriber({ manager });
  const { subscription_id } = await subscriber.start(COMMON_START);

  manager.emitStreamError(subscription_id, "bad error with payload_bytes=[1,2,3]");

  const disclosure = subscriber.describeActive();
  assert.equal(disclosure.streams[0].helper_error_class, "helper_stream_error");

  const { endSummary } = await subscriber.stop(subscription_id);
  assert.equal(endSummary.termination_reason, "error");
  assert.equal(endSummary.error_class, "helper_stream_error");
  assert.equal(JSON.stringify(endSummary).includes("payload_bytes"), false);
});

test("status samples decode to bounded metadata summaries without retaining payload bytes", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-status",
    topic: "sensor/jetsorano/status",
    startedAt: 1_700_000_000.0,
  });

  let nowMs = 1_700_000_000_000;
  const now = () => new Date(nowMs);
  const subscriber = new SensoriumSubscriber({ manager, now });
  const { subscription_id } = await subscriber.start({
    ...COMMON_START,
    capability: "perception.sensorium.status.subscribe",
    body: { topic: "sensor/jetsorano/status" },
  });

  manager.emitSample(subscription_id, "sensor/jetsorano/status", {
    payloadBytes: encodeStatusPayload({
      schema_version: 1,
      hostname: "jetsorano",
      uptime_seconds: 42.5,
      node_version: "0.1.0",
      enabled_streams: ["realsense/color", "realsense/depth"],
    }),
  });

  const disclosure = subscriber.describeActive();
  assert.deepEqual(disclosure.streams[0].status_summary_observed, {
    schema_version: 1,
    hostname: "jetsorano",
    uptime_seconds: 42.5,
    node_version: "0.1.0",
    enabled_streams: ["realsense/color", "realsense/depth"],
    stream_profiles: [],
  });

  nowMs += 5_000;
  const { endSummary } = await subscriber.stop(subscription_id);
  assert.equal(endSummary.frames_consumed, 1);
  assert.equal(endSummary.schema_version_observed, 1);
  assert.equal(endSummary.schema_mismatches, 0);
  assert.deepEqual(endSummary.status_summary_observed, {
    schema_version: 1,
    hostname: "jetsorano",
    uptime_seconds: 42.5,
    node_version: "0.1.0",
    enabled_streams: ["realsense/color", "realsense/depth"],
    stream_profiles: [],
  });
  assert.equal(JSON.stringify(endSummary).includes("payload_bytes"), false);
});

test("status samples with malformed payloads count schema mismatches only", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-status-bad",
    topic: "sensor/jetsorano/status",
    startedAt: 1_700_000_000.0,
  });
  const subscriber = new SensoriumSubscriber({ manager });
  const { subscription_id } = await subscriber.start({
    ...COMMON_START,
    capability: "perception.sensorium.status.subscribe",
    body: { topic: "sensor/jetsorano/status" },
  });

  manager.emitSample(subscription_id, "sensor/jetsorano/status", {
    payloadBytes: [0xc1],
  });

  const { endSummary } = await subscriber.stop(subscription_id);
  assert.equal(endSummary.frames_consumed, 1);
  assert.equal(endSummary.schema_version_observed, null);
  assert.equal(endSummary.schema_mismatches, 1);
  assert.equal("status_summary_observed" in endSummary, false);
});

test("status samples with unexpected schema record mismatch without summary", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-status-schema",
    topic: "sensor/jetsorano/status",
    startedAt: 1_700_000_000.0,
  });
  const subscriber = new SensoriumSubscriber({ manager });
  const { subscription_id } = await subscriber.start({
    ...COMMON_START,
    capability: "perception.sensorium.status.subscribe",
    body: { topic: "sensor/jetsorano/status" },
  });

  manager.emitSample(subscription_id, "sensor/jetsorano/status", {
    payloadBytes: encodeStatusPayload({ schema_version: 2 }),
  });

  const { endSummary } = await subscriber.stop(subscription_id);
  assert.equal(endSummary.schema_version_observed, 2);
  assert.equal(endSummary.schema_mismatches, 1);
  assert.equal("status_summary_observed" in endSummary, false);
});

test("color samples decode to bounded stream metadata without retaining frame bytes", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-color",
    topic: "sensor/jetsorano/realsense/color",
    startedAt: 1_700_000_000.0,
  });

  let nowMs = 1_700_000_000_000;
  const now = () => new Date(nowMs);
  const subscriber = new SensoriumSubscriber({ manager, now });
  const { subscription_id } = await subscriber.start(COMMON_START);

  manager.emitSample(subscription_id, "sensor/jetsorano/realsense/color", {
    payloadBytes: encodeColorPayload({
      schema_version: 1,
      timestamp: 1_779_000_001.25,
      frame_number: 42,
      width: 1280,
      height: 720,
      format: "jpeg",
      data: [0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9],
    }),
  });

  const expected = {
    schema_version: 1,
    frame_number: 42,
    width: 1280,
    height: 720,
    format: "jpeg",
    payload_size: 6,
  };
  const disclosure = subscriber.describeActive();
  assert.deepEqual(disclosure.streams[0].stream_summary_observed, expected);

  nowMs += 5_000;
  const { endSummary } = await subscriber.stop(subscription_id);
  assert.equal(endSummary.frames_consumed, 1);
  assert.equal(endSummary.schema_version_observed, 1);
  assert.equal(endSummary.schema_mismatches, 0);
  assert.equal(endSummary.first_frame_number, 42);
  assert.equal(endSummary.last_frame_number, 42);
  assert.deepEqual(endSummary.stream_summary_observed, expected);

  const serialized = JSON.stringify(endSummary);
  assert.equal(serialized.includes("data"), false);
  assert.equal(serialized.includes("payload_bytes"), false);
  assert.equal(serialized.includes("screenshot"), false);
  assert.equal("timestamp" in endSummary.stream_summary_observed, false);
});

test("color samples with malformed payloads count schema mismatches only", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-color-bad",
    topic: "sensor/jetsorano/realsense/color",
    startedAt: 1_700_000_000.0,
  });
  const subscriber = new SensoriumSubscriber({ manager });
  const { subscription_id } = await subscriber.start(COMMON_START);

  manager.emitSample(subscription_id, "sensor/jetsorano/realsense/color", {
    payloadBytes: [0xc1],
  });

  const { endSummary } = await subscriber.stop(subscription_id);
  assert.equal(endSummary.frames_consumed, 1);
  assert.equal(endSummary.schema_version_observed, null);
  assert.equal(endSummary.schema_mismatches, 1);
  assert.equal("stream_summary_observed" in endSummary, false);
});

test("color samples with unexpected schema record mismatch without stream summary", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-color-schema",
    topic: "sensor/jetsorano/realsense/color",
    startedAt: 1_700_000_000.0,
  });
  const subscriber = new SensoriumSubscriber({ manager });
  const { subscription_id } = await subscriber.start(COMMON_START);

  manager.emitSample(subscription_id, "sensor/jetsorano/realsense/color", {
    payloadBytes: encodeColorPayload({ schema_version: 2 }),
  });

  const { endSummary } = await subscriber.stop(subscription_id);
  assert.equal(endSummary.schema_version_observed, 2);
  assert.equal(endSummary.schema_mismatches, 1);
  assert.equal(endSummary.first_frame_number, null);
  assert.equal(endSummary.last_frame_number, null);
  assert.equal("stream_summary_observed" in endSummary, false);
});

// ── describeActive ─────────────────────────────────────────────────────────

test("subscriber.describeActive produces the disclosure shape for active subscriptions", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-a",
    topic: "sensor/jetsorano/realsense/color",
    startedAt: 1_700_000_000.0,
  });
  manager.enqueueStartSuccess({
    subscriptionId: "sub-b",
    topic: "sensor/jetsorano/status",
    startedAt: 1_700_000_000.0,
  });

  let nowMs = 1_700_000_010_000;
  const now = () => new Date(nowMs);
  const subscriber = new SensoriumSubscriber({ manager, now });

  await subscriber.start(COMMON_START);
  await subscriber.start({
    ...COMMON_START,
    capability: "perception.sensorium.status.subscribe",
    body: { topic: "sensor/jetsorano/status" },
  });

  // Push some frames so recent_frame_rate is meaningful for the color sub.
  for (let i = 0; i < 50; i++) {
    manager.emitSample("sub-a", "sensor/jetsorano/realsense/color");
  }
  nowMs += 5_000;

  const disclosure = subscriber.describeActive();
  assert.equal(disclosure.family, "perception.sensorium");
  assert.equal(disclosure.active_count, 2);
  assert.equal(disclosure.streams.length, 2);

  const colorStream = disclosure.streams.find(
    (s) => s.capability === "perception.sensorium.color.subscribe",
  );
  assert.ok(colorStream);
  assert.equal(colorStream.host, "jetsorano");
  assert.equal(colorStream.frames_consumed_so_far, 50);
  assert.ok(
    colorStream.recent_frame_rate > 0,
    `expected positive recent_frame_rate, got ${colorStream.recent_frame_rate}`,
  );
});

// ── notification routing ──────────────────────────────────────────────────

test("subscriber ignores notifications for unknown subscription_ids", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-known",
    topic: "sensor/jetsorano/status",
    startedAt: 1_700_000_000.0,
  });
  const subscriber = new SensoriumSubscriber({ manager });
  await subscriber.start({
    ...COMMON_START,
    capability: "perception.sensorium.status.subscribe",
    body: { topic: "sensor/jetsorano/status" },
  });

  // Emit a sample for an id we don't track — must not increment our
  // counter or throw.
  manager.emitSample("sub-unknown", "sensor/whatever/x");

  // Now emit one for the real id; counter should be 1.
  manager.emitSample("sub-known", "sensor/jetsorano/status");
  const list = subscriber.describeActive();
  assert.equal(list.streams[0].frames_consumed_so_far, 1);
});

test("subscriber ignores notifications with the wrong method name", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-noise",
    topic: "sensor/jetsorano/status",
    startedAt: 1_700_000_000.0,
  });
  const subscriber = new SensoriumSubscriber({ manager });
  await subscriber.start({
    ...COMMON_START,
    capability: "perception.sensorium.status.subscribe",
    body: { topic: "sensor/jetsorano/status" },
  });

  manager.emit("notification", {
    jsonrpc: "2.0",
    method: "something.else.entirely",
    params: { subscription_id: "sub-noise" },
  });
  const list = subscriber.describeActive();
  assert.equal(list.streams[0].frames_consumed_so_far, 0);
});

// ── constructor guard ─────────────────────────────────────────────────────

test("SensoriumSubscriber rejects construction without a manager", () => {
  assert.throws(() => new SensoriumSubscriber({}), TypeError);
});

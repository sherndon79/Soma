import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";

import { createSensoriumPresenceState } from "../src/sensoriumPresenceState.js";
import { SensoriumSubscriber } from "../src/sensoriumSubscriber.js";
import {
  encodeColorPayload,
  encodeDepthPayload,
  encodePresencePayload,
  encodePosePayload,
  encodeStatusPayload,
} from "./support/msgpackStatus.js";

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
    this.statusResponse = { subscriptions: [], count: 0 };
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

  setStatusResponse(response) {
    this.statusResponse = response;
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
      return this.statusResponse;
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
        capture_timestamp: options.capture_timestamp,
      },
    });
  }

  emitPresence(subscriptionId, event = {}) {
    this.emit("notification", {
      jsonrpc: "2.0",
      method: "sensorium.presence.depth.event",
      params: {
        subscription_id: subscriptionId,
        ...presenceBrokerEvent(event),
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

function makeFakeTimers() {
  const scheduled = [];
  const cleared = [];
  return {
    scheduled,
    cleared,
    setTimeoutFn(callback, delayMs) {
      const handle = { callback, delayMs, cleared: false };
      scheduled.push(handle);
      return handle;
    },
    clearTimeoutFn(handle) {
      if (handle) {
        handle.cleared = true;
        cleared.push(handle);
      }
    },
  };
}

function flushAsync() {
  return new Promise((resolve) => setImmediate(resolve));
}

function presenceBrokerEvent(overrides = {}) {
  return {
    schema_version: 1,
    event_type: "presence.depth",
    person_count: 1,
    count_bucket: "1",
    additional_person_present: "unknown",
    confidence_bucket: "medium",
    identity: "not_performed",
    copresence_source: "depth",
    raw_payload_allowed_to_node: false,
    raw_payload_included: false,
    ...overrides,
  };
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

const PRESENCE_START = {
  capability: "perception.sensorium.presence.subscribe",
  provider: "soma.provider.sensorium.jetsorano",
  grantId: "grant-presence",
  scope: "session",
  body: {
    topic: "perception/jetsorano/presence",
    constraints: {
      max_seconds: 60,
      max_fps: 5,
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

test("subscriber.start passes depth transform constraints to the helper", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-depth",
    topic: "sensor/jetsorano/realsense/depth",
    startedAt: 1_700_000_000.0,
  });

  const subscriber = new SensoriumSubscriber({ manager });
  await subscriber.start({
    capability: "perception.sensorium.depth.subscribe",
    provider: "soma.provider.sensorium.jetsorano",
    grantId: "grant-depth",
    scope: "session",
    body: {
      topic: "sensor/jetsorano/realsense/depth",
      constraints: {
        max_seconds: 30,
        max_fps: 1,
        format_required: "png",
        downsample_to: [320, 240],
      },
    },
  });

  assert.equal(manager.calls[0].method, "sensorium.subscribe.start");
  assert.deepEqual(manager.calls[0].params.downsample_to, [320, 240]);
  assert.equal(manager.calls[0].params.format_required, "png");
});

test("subscriber.start subscribes to derived presence without broker transform", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-presence",
    topic: "perception/jetsorano/presence",
    startedAt: 1_700_000_000.0,
  });

  const subscriber = new SensoriumSubscriber({ manager });
  await subscriber.start(PRESENCE_START);

  assert.equal(manager.calls[0].method, "sensorium.subscribe.start");
  assert.deepEqual(manager.calls[0].params, {
    topic: "perception/jetsorano/presence",
    max_fps: 5,
  });
});

test("helperStatusAnchor uses helper-owned status rather than the Node mirror", async () => {
  const manager = new FakeManager();
  const subscriber = new SensoriumSubscriber({ manager });
  await subscriber.start(COMMON_START);
  manager.setStatusResponse({
    count: 1,
    subscriptions: [
      {
        subscription_id: "helper-depth",
        topic: "sensor/jetsorano/realsense/depth",
        started_at: 1_700_000_100,
        active: true,
      },
    ],
  });

  const anchor = await subscriber.helperStatusAnchor();

  assert.equal(anchor.source, "helper_status");
  assert.equal(anchor.depth_active, true);
  assert.equal(anchor.color_active, false);
  assert.deepEqual(anchor.active_streams.map((stream) => stream.subscription_id), [
    "helper-depth",
  ]);
  assert.equal(anchor.node_reconciliation.matched, false);
  assert.deepEqual(anchor.node_reconciliation.missing_in_node, ["helper-depth"]);
  assert.deepEqual(anchor.node_reconciliation.missing_in_helper, ["sub-1"]);
  assert.equal(manager.calls.at(-1).method, "sensorium.subscribe.status");
});

test("describeActive marks streams stalled when notifications stop", async () => {
  const manager = new FakeManager();
  const subscriber = new SensoriumSubscriber({
    manager,
    now: () => new Date(nowMs),
  });
  let nowMs = 1_700_000_000_000;
  await subscriber.start(COMMON_START);

  nowMs += 9_000;
  let disclosure = subscriber.describeActive({ now: new Date(nowMs) });
  assert.equal(disclosure.streams[0].helper_error_class, "");

  nowMs += 2_000;
  disclosure = subscriber.describeActive({ now: new Date(nowMs) });
  assert.equal(disclosure.streams[0].helper_error_class, "notification_stalled");
});

test("sample notifications clear a prior stalled marker", async () => {
  const manager = new FakeManager();
  let nowMs = 1_700_000_000_000;
  const subscriber = new SensoriumSubscriber({
    manager,
    now: () => new Date(nowMs),
  });
  await subscriber.start(COMMON_START);
  nowMs += 11_000;
  assert.equal(
    subscriber.describeActive({ now: new Date(nowMs) }).streams[0].helper_error_class,
    "notification_stalled",
  );

  manager.emitSample("sub-1", "sensor/jetsorano/realsense/color", {
    payloadBytes: encodeColorPayload({
      schema_version: 1,
      frame_number: 12,
      width: 16,
      height: 16,
      format: "jpeg",
      data: [0xff, 0xd8, 0xff, 0xd9],
    }),
    payloadSize: 4,
    captureTimestamp: new Date(nowMs).toISOString(),
  });

  assert.equal(
    subscriber.describeActive({ now: new Date(nowMs) }).streams[0].helper_error_class,
    "",
  );
});

test("stopAll stops every tracked subscription for runtime shutdown", async () => {
  const manager = new FakeManager();
  const subscriber = new SensoriumSubscriber({ manager });
  await subscriber.start(COMMON_START);
  await subscriber.start({
    ...COMMON_START,
    capability: "perception.sensorium.status.subscribe",
    body: {
      topic: "sensor/jetsorano/status",
      constraints: { max_seconds: 30 },
    },
  });

  const result = await subscriber.stopAll({ terminationReason: "runtime_shutdown" });

  assert.equal(result.stopped_count, 2);
  assert.equal(result.failed_count, 0);
  assert.equal(subscriber.activeCount, 0);
  assert.deepEqual(
    manager.calls
      .filter((call) => call.method === "sensorium.subscribe.stop")
      .map((call) => call.params.subscription_id),
    ["sub-1", "sub-2"],
  );
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

test("subscriber schedules max_seconds timeout and stops with timeout summary", async () => {
  const manager = new FakeManager();
  const timers = makeFakeTimers();
  const ended = [];
  manager.enqueueStartSuccess({
    subscriptionId: "sub-timeout",
    topic: "sensor/jetsorano/realsense/color",
    startedAt: 1_700_000_000.0,
  });
  const subscriber = new SensoriumSubscriber({
    manager,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    onSubscriptionEnded: (summary) => ended.push(summary),
  });

  await subscriber.start(COMMON_START);

  assert.equal(timers.scheduled.length, 1);
  assert.equal(timers.scheduled[0].delayMs, 60_000);

  timers.scheduled[0].callback();
  await flushAsync();

  assert.equal(subscriber.activeCount, 0);
  assert.equal(timers.cleared.length, 1);
  assert.equal(manager.calls.at(-1).method, "sensorium.subscribe.stop");
  assert.deepEqual(manager.calls.at(-1).params, { subscription_id: "sub-timeout" });
  assert.equal(ended.length, 1);
  assert.equal(ended[0].subscription_id, "sub-timeout");
  assert.equal(ended[0].endSummary.termination_reason, "timeout");
  assert.equal(ended[0].endSummary.error_class, "");
  assert.equal(ended[0].endSummary.frames_recorded, false);
  assert.equal(ended[0].endSummary.text_content_included, false);
});

test("subscriber does not notify automatic-end handler for manual stop", async () => {
  const manager = new FakeManager();
  const ended = [];
  manager.enqueueStartSuccess({
    subscriptionId: "sub-manual-no-callback",
    topic: "sensor/jetsorano/realsense/color",
    startedAt: 1_700_000_000.0,
  });
  const subscriber = new SensoriumSubscriber({
    manager,
    onSubscriptionEnded: (summary) => ended.push(summary),
  });

  const { subscription_id } = await subscriber.start(COMMON_START);
  await subscriber.stop(subscription_id);

  assert.deepEqual(ended, []);
});

test("subscriber manual stop clears pending max_seconds timeout", async () => {
  const manager = new FakeManager();
  const timers = makeFakeTimers();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-manual-timeout-clear",
    topic: "sensor/jetsorano/realsense/color",
    startedAt: 1_700_000_000.0,
  });
  const subscriber = new SensoriumSubscriber({
    manager,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  const { subscription_id } = await subscriber.start(COMMON_START);
  await subscriber.stop(subscription_id);

  assert.equal(timers.scheduled.length, 1);
  assert.equal(timers.cleared.length, 1);
  assert.equal(timers.scheduled[0].cleared, true);
});

test("subscriber revocation stop clears pending max_seconds timeout", async () => {
  const manager = new FakeManager();
  const timers = makeFakeTimers();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-revoke-timeout-clear",
    topic: "sensor/jetsorano/realsense/color",
    startedAt: 1_700_000_000.0,
  });
  const subscriber = new SensoriumSubscriber({
    manager,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  await subscriber.start(COMMON_START);
  const result = await subscriber.stopByGrantId("grant-test-1", {
    terminationReason: "revoked",
    errorClass: "grant_revoked",
  });

  assert.equal(result.stopped_count, 1);
  assert.equal(timers.scheduled.length, 1);
  assert.equal(timers.cleared.length, 1);
  assert.equal(timers.scheduled[0].cleared, true);
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
    payloadBytes: encodeStatusPayload({ schema_version: 3 }),
  });

  const { endSummary } = await subscriber.stop(subscription_id);
  assert.equal(endSummary.schema_version_observed, 3);
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

test("raw latest-frame cache is disabled unless source grant explicitly allows it", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-color-no-raw",
    topic: "sensor/jetsorano/realsense/color",
    startedAt: 1_700_000_000.0,
  });
  const subscriber = new SensoriumSubscriber({ manager });
  const { subscription_id } = await subscriber.start(COMMON_START);

  manager.emitSample(subscription_id, "sensor/jetsorano/realsense/color", {
    payloadBytes: encodeColorPayload({
      schema_version: 1,
      frame_number: 1,
      width: 16,
      height: 16,
      format: "jpeg",
      data: [0xff, 0xd8, 0x01, 0xff, 0xd9],
    }),
  });

  assert.equal(subscriber.readLatestRawFrame({ subscriptionId: subscription_id, modality: "color" }), null);
});

test("raw sequence ring is disabled unless source grant explicitly allows it", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-color-no-sequence",
    topic: "sensor/jetsorano/realsense/color",
    startedAt: 1_700_000_000.0,
  });
  const subscriber = new SensoriumSubscriber({ manager });
  const { subscription_id } = await subscriber.start(COMMON_START);

  manager.emitSample(subscription_id, "sensor/jetsorano/realsense/color", {
    payloadBytes: encodeColorPayload({
      schema_version: 1,
      frame_number: 1,
      frameset_sequence: 1,
      width: 16,
      height: 16,
      format: "jpeg",
      data: [0xff, 0xd8, 0x01, 0xff, 0xd9],
    }),
    payloadSize: 128,
    capture_timestamp: "2026-07-09T18:00:00.000Z",
  });

  assert.deepEqual(subscriber.readRawFrameSequence({ subscriptionId: subscription_id, modality: "color" }), []);
  assert.equal(subscriber.describeActive().streams[0].sequence_ring, null);
});

test("raw latest-frame cache retains only the latest bounded frame and keeps disclosures byte-free", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-color-raw",
    topic: "sensor/jetsorano/realsense/color",
    startedAt: 1_700_000_000.0,
  });
  let nowMs = 1_700_000_000_000;
  const now = () => new Date(nowMs);
  const subscriber = new SensoriumSubscriber({ manager, now });
  const { subscription_id } = await subscriber.start({
    ...COMMON_START,
    rawFrameRetention: {
      enabled: true,
      grant_allows_raw_visual_retention: true,
      retention_mode: "latest_frame_cache",
      modality: "color",
      source_grant_id: "grant-test-1",
      source_host: "jetsorano",
      max_bytes: 1024,
      ttl_ms: 2_000,
    },
  });

  manager.emitSample(subscription_id, "sensor/jetsorano/realsense/color", {
    payloadBytes: encodeColorPayload({
      schema_version: 1,
      frame_number: 10,
      width: 16,
      height: 16,
      format: "jpeg",
      data: [1, 2, 3],
    }),
    payloadSize: 128,
    capture_timestamp: "2026-07-09T18:00:00.000Z",
  });
  manager.emitSample(subscription_id, "sensor/jetsorano/realsense/color", {
    payloadBytes: encodeColorPayload({
      schema_version: 1,
      frame_number: 11,
      width: 16,
      height: 16,
      format: "jpeg",
      data: [4, 5, 6, 7],
    }),
    payloadSize: 128,
    capture_timestamp: "2026-07-09T18:00:01.000Z",
  });

  const frame = subscriber.readLatestRawFrame({ subscriptionId: subscription_id, modality: "color", now });
  assert.equal(frame.subscription_id, subscription_id);
  assert.equal(frame.source_grant_id, "grant-test-1");
  assert.equal(frame.modality, "color");
  assert.equal(frame.source_host, "jetsorano");
  assert.equal(frame.frame_id, "11");
  assert.equal(frame.capture_timestamp, "2026-07-09T18:00:01.000Z");
  assert.equal(frame.payload_bytes instanceof Uint8Array, true);
  assert.equal(frame.byte_length, frame.payload_bytes.byteLength);
  assert.equal(frame.declared_byte_length, 128);
  assert.equal(frame.payload_bytes_included, true);
  assert.equal(frame.disk_persisted, false);
  assert.equal(frame.provenance_appended, false);

  const disclosureJson = JSON.stringify(subscriber.describeActive());
  assert.equal(disclosureJson.includes("payload_bytes"), false);
  assert.equal(disclosureJson.includes("payload_bytes_included"), false);
  assert.equal(disclosureJson.includes("frame_bytes"), false);

  nowMs += 1_000;
  const { endSummary } = await subscriber.stop(subscription_id);
  const endSummaryJson = JSON.stringify(endSummary);
  assert.equal(endSummaryJson.includes("payload_bytes"), false);
  assert.equal(endSummaryJson.includes("payload_bytes_included"), false);
  assert.equal(endSummaryJson.includes("frame_bytes"), false);
  assert.equal(subscriber.readLatestRawFrame({ subscriptionId: subscription_id, modality: "color", now }), null);
});

test("raw sequence ring keeps bounded oldest-first frames and byte-free disclosure", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-color-sequence",
    topic: "sensor/jetsorano/realsense/color",
    startedAt: 1_700_000_000.0,
  });
  let nowMs = 1_700_000_000_000;
  const now = () => new Date(nowMs);
  const subscriber = new SensoriumSubscriber({ manager, now });
  const { subscription_id } = await subscriber.start({
    ...COMMON_START,
    rawFrameSequenceRetention: {
      enabled: true,
      grant_allows_raw_visual_sequence_retention: true,
      retention_mode: "sequence_ring",
      modality: "color",
      source_grant_id: "grant-test-1",
      source_host: "jetsorano",
      max_frames: 2,
      max_total_bytes: 4096,
      ttl_ms: 2_000,
    },
  });

  const payloads = [10, 11, 12].map((frameNumber) => ({
    frameNumber,
    bytes: encodeColorPayload({
      schema_version: 1,
      frame_number: frameNumber,
      frameset_sequence: frameNumber,
      width: 16,
      height: 16,
      format: "jpeg",
      data: [frameNumber],
    }),
  }));
  for (const { frameNumber, bytes } of payloads) {
    manager.emitSample(subscription_id, "sensor/jetsorano/realsense/color", {
      payloadBytes: bytes,
      capture_timestamp: `2026-07-09T18:00:0${frameNumber - 10}.000Z`,
    });
  }

  const frames = subscriber.readRawFrameSequence({ subscriptionId: subscription_id, modality: "color", now });
  assert.deepEqual(frames.map((frame) => frame.frame_id), ["11", "12"]);
  assert.deepEqual(frames.map((frame) => frame.frameset_sequence), [11, 12]);
  assert.equal(frames[0].payload_bytes instanceof Uint8Array, true);
  assert.equal(frames[0].retention_mode, "sequence_ring");
  assert.equal(frames[0].disk_persisted, false);
  assert.equal(frames[0].provenance_appended, false);

  const ring = subscriber.describeActive().streams[0].sequence_ring;
  assert.deepEqual(ring, {
    enabled: true,
    modality: "color",
    retention_mode: "sequence_ring",
    frame_count: 2,
    max_frames: 2,
    total_bytes: payloads[1].bytes.length + payloads[2].bytes.length,
    max_total_bytes: 4096,
    ttl_ms: 2_000,
    disk_persisted: false,
    payload_bytes_included: false,
    content_included: false,
  });
  const disclosureJson = JSON.stringify(subscriber.describeActive());
  assert.equal(disclosureJson.includes("\"payload_bytes\":"), false);
  assert.equal(disclosureJson.includes("screenshot"), false);

  nowMs += 2_001;
  assert.deepEqual(subscriber.readRawFrameSequence({ subscriptionId: subscription_id, modality: "color", now }), []);
});

test("raw sequence ring enforces total byte cap and drops on control cleanup", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-color-sequence-bytes",
    topic: "sensor/jetsorano/realsense/color",
    startedAt: 1_700_000_000.0,
  });
  const subscriber = new SensoriumSubscriber({ manager });
  const payloads = [20, 21, 22].map((frameNumber) => ({
    frameNumber,
    bytes: encodeColorPayload({
      schema_version: 1,
      frame_number: frameNumber,
      frameset_sequence: frameNumber,
      width: 16,
      height: 16,
      format: "jpeg",
      data: [frameNumber],
    }),
  }));
  const maxOneFrameBytes = Math.max(...payloads.map((payload) => payload.bytes.length)) + 1;
  const { subscription_id } = await subscriber.start({
    ...COMMON_START,
    rawFrameSequenceRetention: {
      enabled: true,
      grant_allows_raw_visual_sequence_retention: true,
      retention_mode: "sequence_ring",
      modality: "color",
      max_frames: 8,
      max_total_bytes: maxOneFrameBytes,
      ttl_ms: 2_000,
    },
  });

  for (const { frameNumber, bytes } of payloads) {
    manager.emitSample(subscription_id, "sensor/jetsorano/realsense/color", {
      payloadBytes: bytes,
    });
  }

  assert.deepEqual(
    subscriber.readRawFrameSequence({ subscriptionId: subscription_id, modality: "color" })
      .map((frame) => frame.frame_id),
    ["22"],
  );

  subscriber.dropRawFrames({ subscriptionId: subscription_id, modality: "color" });
  assert.deepEqual(subscriber.readRawFrameSequence({ subscriptionId: subscription_id, modality: "color" }), []);
});

test("raw latest-frame cache expires by ttl and enforces byte cap", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-color-ttl",
    topic: "sensor/jetsorano/realsense/color",
    startedAt: 1_700_000_000.0,
  });
  let nowMs = 1_700_000_000_000;
  const now = () => new Date(nowMs);
  const subscriber = new SensoriumSubscriber({ manager, now });
  const { subscription_id } = await subscriber.start({
    ...COMMON_START,
    rawFrameRetention: {
      enabled: true,
      grant_allows_raw_visual_retention: true,
      retention_mode: "latest_frame_cache",
      modality: "color",
      max_bytes: 1024,
      ttl_ms: 500,
    },
  });

  manager.emitSample(subscription_id, "sensor/jetsorano/realsense/color", {
    payloadBytes: encodeColorPayload({
      schema_version: 1,
      frame_number: 20,
      width: 16,
      height: 16,
      format: "jpeg",
      data: [1, 2],
    }),
  });
  assert.ok(subscriber.readLatestRawFrame({ subscriptionId: subscription_id, modality: "color", now }));

  nowMs += 501;
  assert.equal(subscriber.readLatestRawFrame({ subscriptionId: subscription_id, modality: "color", now }), null);

  manager.emitSample(subscription_id, "sensor/jetsorano/realsense/color", {
    payloadBytes: encodeColorPayload({
      schema_version: 1,
      frame_number: 21,
      width: 16,
      height: 16,
      format: "jpeg",
      data: new Array(128).fill(1),
    }),
    payloadSize: 2048,
  });
  assert.equal(subscriber.readLatestRawFrame({ subscriptionId: subscription_id, modality: "color", now }), null);
});

test("raw latest-frame cache drops on revoke stopAll and control close", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-color-drop-1",
    topic: "sensor/jetsorano/realsense/color",
    startedAt: 1_700_000_000.0,
  });
  manager.enqueueStartSuccess({
    subscriptionId: "sub-color-drop-2",
    topic: "sensor/jetsorano/realsense/color",
    startedAt: 1_700_000_000.0,
  });
  const subscriber = new SensoriumSubscriber({ manager });
  const startWithRaw = {
    ...COMMON_START,
    rawFrameRetention: {
      enabled: true,
      grant_allows_raw_visual_retention: true,
      retention_mode: "latest_frame_cache",
      modality: "color",
      max_bytes: 1024,
      ttl_ms: 2_000,
    },
  };
  const first = await subscriber.start(startWithRaw);
  const second = await subscriber.start({ ...startWithRaw, grantId: "grant-test-2" });
  for (const id of [first.subscription_id, second.subscription_id]) {
    manager.emitSample(id, "sensor/jetsorano/realsense/color", {
      payloadBytes: encodeColorPayload({
        schema_version: 1,
        frame_number: 30,
        width: 16,
        height: 16,
        format: "jpeg",
        data: [1, 2, 3],
      }),
    });
    assert.ok(subscriber.readLatestRawFrame({ subscriptionId: id, modality: "color" }));
  }

  await subscriber.stopByGrantId("grant-test-1");
  assert.equal(subscriber.readLatestRawFrame({ subscriptionId: first.subscription_id, modality: "color" }), null);
  assert.ok(subscriber.readLatestRawFrame({ subscriptionId: second.subscription_id, modality: "color" }));

  subscriber.dropRawFrames();
  assert.equal(subscriber.readLatestRawFrame({ subscriptionId: second.subscription_id, modality: "color" }), null);

  manager.emitSample(second.subscription_id, "sensor/jetsorano/realsense/color", {
    payloadBytes: encodeColorPayload({
      schema_version: 1,
      frame_number: 31,
      width: 16,
      height: 16,
      format: "jpeg",
      data: [1, 2, 3],
    }),
  });
  assert.ok(subscriber.readLatestRawFrame({ subscriptionId: second.subscription_id, modality: "color" }));
  await subscriber.stopAll({ terminationReason: "runtime_shutdown" });
  assert.equal(subscriber.readLatestRawFrame({ subscriptionId: second.subscription_id, modality: "color" }), null);
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

test("depth samples decode to bounded stream metadata without retaining depth bytes", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-depth",
    topic: "sensor/jetsorano/realsense/depth",
    startedAt: 1_700_000_000.0,
  });

  let nowMs = 1_700_000_000_000;
  const now = () => new Date(nowMs);
  const subscriber = new SensoriumSubscriber({ manager, now });
  const { subscription_id } = await subscriber.start({
    capability: "perception.sensorium.depth.subscribe",
    provider: "soma.provider.sensorium.jetsorano",
    grantId: "grant-depth",
    scope: "session",
    body: {
      topic: "sensor/jetsorano/realsense/depth",
      constraints: {
        max_seconds: 30,
        max_fps: 1,
        format_required: "png",
        downsample_to: [320, 240],
      },
    },
  });

  manager.emitSample(subscription_id, "sensor/jetsorano/realsense/depth", {
    payloadBytes: encodeDepthPayload({
      schema_version: 1,
      timestamp: 1_779_000_001.25,
      frame_number: 77,
      width: 320,
      height: 180,
      format: "png",
      depth_units: 0.001,
      data: [0x89, 0x50, 0x4e, 0x47, 0x01, 0x02],
    }),
  });

  const expected = {
    schema_version: 1,
    frame_number: 77,
    width: 320,
    height: 180,
    format: "png",
    depth_units: 0.001,
    payload_size: 6,
  };
  const disclosure = subscriber.describeActive();
  assert.deepEqual(disclosure.streams[0].stream_summary_observed, expected);

  nowMs += 5_000;
  const { endSummary } = await subscriber.stop(subscription_id);
  assert.equal(endSummary.frames_consumed, 1);
  assert.equal(endSummary.schema_version_observed, 1);
  assert.equal(endSummary.schema_mismatches, 0);
  assert.equal(endSummary.first_frame_number, 77);
  assert.equal(endSummary.last_frame_number, 77);
  assert.deepEqual(endSummary.stream_summary_observed, expected);

  const serialized = JSON.stringify(endSummary);
  assert.equal(serialized.includes("data"), false);
  assert.equal(serialized.includes("payload_bytes"), false);
  assert.equal(serialized.includes("depth_array"), false);
  assert.equal(serialized.includes("raw_depth"), false);
  assert.equal(serialized.includes("point_cloud"), false);
  assert.equal(serialized.includes("screenshot"), false);
  assert.equal("timestamp" in endSummary.stream_summary_observed, false);
});

test("depth samples with malformed payloads count schema mismatches only", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-depth-bad",
    topic: "sensor/jetsorano/realsense/depth",
    startedAt: 1_700_000_000.0,
  });
  const subscriber = new SensoriumSubscriber({ manager });
  const { subscription_id } = await subscriber.start({
    capability: "perception.sensorium.depth.subscribe",
    provider: "soma.provider.sensorium.jetsorano",
    grantId: "grant-depth",
    scope: "session",
    body: {
      topic: "sensor/jetsorano/realsense/depth",
      constraints: {
        max_seconds: 30,
        max_fps: 1,
        format_required: "png",
        downsample_to: [320, 240],
      },
    },
  });

  manager.emitSample(subscription_id, "sensor/jetsorano/realsense/depth", {
    payloadBytes: [0xc1],
  });

  const { endSummary } = await subscriber.stop(subscription_id);
  assert.equal(endSummary.frames_consumed, 1);
  assert.equal(endSummary.schema_version_observed, null);
  assert.equal(endSummary.schema_mismatches, 1);
  assert.equal("stream_summary_observed" in endSummary, false);
});

test("presence events update current presence state without occupant-count derivation", async () => {
  const manager = new FakeManager();
  const presenceState = createSensoriumPresenceState({
    now: () => new Date("2026-06-26T01:00:00.000Z"),
  });
  manager.enqueueStartSuccess({
    subscriptionId: "sub-presence-state",
    topic: "perception/jetsorano/presence",
    startedAt: 1_700_000_000.0,
  });

  const subscriber = new SensoriumSubscriber({
    manager,
    now: () => new Date("2026-06-26T01:00:00.000Z"),
    presenceState,
    getPresenceEpisodeContext: () => ({
      status: "active",
      occupant_id: "seth",
      posture: {
        mode: "analysis_testing",
        trust_basis: "human_set_episode",
      },
    }),
  });
  const { subscription_id } = await subscriber.start(PRESENCE_START);

  manager.emitSample(subscription_id, "perception/jetsorano/presence", {
    payloadBytes: encodePresencePayload({
      person_count: 1,
      count_bucket: "1",
      additional_person_present: "present",
    }),
  });

  assert.equal(
    presenceState.read({ now: () => new Date("2026-06-26T01:00:05.000Z") })
      .additional_person_present,
    "present",
  );
  assert.equal(
    presenceState.snapshot({ now: () => new Date("2026-06-26T01:00:05.000Z") })
      .source_host,
    "jetsorano",
  );
  const disclosure = subscriber.describeActive();
  assert.equal(disclosure.streams[0].host, "jetsorano");
  assert.equal(disclosure.streams[0].frames_consumed_so_far, 1);
  assert.equal(disclosure.streams[0].presence_summary_observed.person_count, 1);
  assert.equal(disclosure.streams[0].presence_summary_observed.count_bucket, "1");
  assert.equal(disclosure.streams[0].presence_summary_observed.additional_person_present, "present");
  assert.equal(
    disclosure.streams[0].presence_summary_observed.sensorium_schema,
    "perception.presence.v0.1",
  );
});

test("pose samples surface full bounded pose summary in active disclosure", async () => {
  const manager = new FakeManager();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-pose",
    topic: "perception/jetsorano/pose/features",
    startedAt: 1_700_000_000.0,
  });
  const subscriber = new SensoriumSubscriber({
    manager,
    now: () => new Date("2026-06-26T01:00:00.000Z"),
  });
  const { subscription_id } = await subscriber.start({
    capability: "perception.sensorium.pose.subscribe",
    provider: "soma.provider.sensorium.jetsorano",
    grantId: "grant-pose",
    scope: "session",
    body: {
      topic: "perception/jetsorano/pose/features",
      constraints: {
        max_seconds: 120,
        max_fps: 10,
      },
    },
  });

  manager.emitSample(subscription_id, "perception/jetsorano/pose/features", {
    payloadBytes: encodePosePayload({
      frameset_sequence: 85204,
    }),
  });

  const disclosure = subscriber.describeActive();
  const stream = disclosure.streams[0];
  assert.equal(stream.capability, "perception.sensorium.pose.subscribe");
  assert.equal(stream.host, "jetsorano");
  assert.match(stream.description, /Receiving pose features from jetsorano/);
  assert.equal(stream.frames_consumed_so_far, 1);
  assert.equal(stream.pose_summary_observed.schema, "perception.pose.contract.v0.2");
  assert.equal(stream.pose_summary_observed.frameset_sequence, 85204);
  assert.equal(stream.pose_summary_observed.persons[0].body_keypoints.length, 17);
  assert.equal(stream.pose_summary_observed.persons[0].face_keypoints.length, 68);
  assert.equal(stream.pose_summary_observed.persons[0].left_hand_keypoints.length, 21);
  assert.equal(stream.pose_summary_observed.persons[0].right_hand_keypoints.length, 21);

  const { endSummary } = await subscriber.stop(subscription_id);
  assert.equal(endSummary.frames_consumed, 1);
  assert.equal(endSummary.schema_version_observed, 1);
  assert.equal(endSummary.first_frame_number, 85204);
  assert.equal(endSummary.last_frame_number, 85204);
});

test("presence events without active episode remain descriptive", async () => {
  const manager = new FakeManager();
  const presenceState = createSensoriumPresenceState();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-presence-visitor",
    topic: "perception/jetsorano/presence",
    startedAt: 1_700_000_000.0,
  });

  const subscriber = new SensoriumSubscriber({
    manager,
    now: () => new Date("2026-06-26T01:00:00.000Z"),
    presenceState,
  });
  const { subscription_id } = await subscriber.start(PRESENCE_START);

  manager.emitSample(subscription_id, "perception/jetsorano/presence", {
    payloadBytes: encodePresencePayload({
      count_bucket: "1",
      additional_person_present: "not_detected",
    }),
  });

  assert.equal(
    presenceState.read({ now: () => new Date("2026-06-26T01:00:05.000Z") })
      .additional_person_present,
    "not_detected",
  );
});

test("presence unknown and expired readings return safe unknown audience", async () => {
  const manager = new FakeManager();
  const presenceState = createSensoriumPresenceState();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-presence-expire",
    topic: "perception/jetsorano/presence",
    startedAt: 1_700_000_000.0,
  });

  const subscriber = new SensoriumSubscriber({
    manager,
    now: () => new Date("2026-06-26T01:00:00.000Z"),
    presenceState,
    getPresenceEpisodeContext: () => ({ status: "active" }),
  });
  const { subscription_id } = await subscriber.start(PRESENCE_START);

  manager.emitSample(subscription_id, "perception/jetsorano/presence", {
    payloadBytes: encodePresencePayload({ schema: "perception.presence.v9" }),
  });
  assert.equal(presenceState.read().additional_person_present, "unknown");

  manager.emitSample(subscription_id, "perception/jetsorano/presence", {
    payloadBytes: encodePresencePayload({ count_bucket: "1" }),
  });
  assert.equal(
    presenceState.read({ now: () => new Date("2026-06-26T01:00:09.999Z") })
      .additional_person_present,
    "not_detected",
  );
  assert.equal(
    presenceState.read({ now: () => new Date("2026-06-26T01:00:10.000Z") })
      .additional_person_present,
    "unknown",
  );
});

test("presence subscription stop clears current presence state", async () => {
  const manager = new FakeManager();
  const presenceState = createSensoriumPresenceState();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-presence-clear",
    topic: "perception/jetsorano/presence",
    startedAt: 1_700_000_000.0,
  });

  const subscriber = new SensoriumSubscriber({
    manager,
    now: () => new Date("2026-06-26T01:00:00.000Z"),
    presenceState,
    getPresenceEpisodeContext: () => ({ status: "active" }),
  });
  const { subscription_id } = await subscriber.start(PRESENCE_START);
  manager.emitSample(subscription_id, "perception/jetsorano/presence", {
    payloadBytes: encodePresencePayload({ count_bucket: "1" }),
  });
  assert.equal(
    presenceState.read({ now: () => new Date("2026-06-26T01:00:05.000Z") })
      .additional_person_present,
    "not_detected",
  );

  await subscriber.stop(subscription_id);

  assert.equal(presenceState.read().additional_person_present, "unknown");
});

test("presence path rejects malformed derived presence payloads without updating presence state", async () => {
  const manager = new FakeManager();
  const presenceState = createSensoriumPresenceState();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-presence-raw",
    topic: "perception/jetsorano/presence",
    startedAt: 1_700_000_000.0,
  });

  const subscriber = new SensoriumSubscriber({
    manager,
    now: () => new Date("2026-06-26T01:00:00.000Z"),
    presenceState,
    getPresenceEpisodeContext: () => ({ status: "active" }),
  });
  const { subscription_id } = await subscriber.start(PRESENCE_START);

  manager.emitSample(subscription_id, "perception/jetsorano/presence", {
    payloadBytes: [1, 2, 3],
  });

  assert.equal(presenceState.read().additional_person_present, "unknown");
  const disclosure = subscriber.describeActive();
  assert.equal(disclosure.streams[0].frames_consumed_so_far, 1);
  assert.equal(disclosure.streams[0].helper_error_class, "presence_event_rejected");
  assert.equal(JSON.stringify(disclosure).includes("payload_bytes"), false);
});

test("presence derived payload with unsupported enum clears current presence state", async () => {
  const manager = new FakeManager();
  const presenceState = createSensoriumPresenceState();
  manager.enqueueStartSuccess({
    subscriptionId: "sub-presence-event-raw",
    topic: "perception/jetsorano/presence",
    startedAt: 1_700_000_000.0,
  });

  const subscriber = new SensoriumSubscriber({
    manager,
    now: () => new Date("2026-06-26T01:00:00.000Z"),
    presenceState,
    getPresenceEpisodeContext: () => ({ status: "active" }),
  });
  const { subscription_id } = await subscriber.start(PRESENCE_START);
  manager.emitSample(subscription_id, "perception/jetsorano/presence", {
    payloadBytes: encodePresencePayload({ count_bucket: "1" }),
  });
  assert.equal(
    presenceState.read({ now: () => new Date("2026-06-26T01:00:05.000Z") })
      .additional_person_present,
    "not_detected",
  );

  manager.emitSample(subscription_id, "perception/jetsorano/presence", {
    payloadBytes: encodePresencePayload({ count_bucket: "many" }),
  });

  assert.equal(presenceState.read().additional_person_present, "unknown");
  const disclosure = subscriber.describeActive();
  assert.equal(disclosure.streams[0].frames_consumed_so_far, 2);
  assert.equal(disclosure.streams[0].helper_error_class, "presence_event_rejected");
  assert.equal(disclosure.streams[0].stream_summary_observed, null);
  assert.equal(disclosure.streams[0].presence_summary_observed, null);
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

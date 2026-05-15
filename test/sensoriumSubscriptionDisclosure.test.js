import assert from "node:assert/strict";
import test from "node:test";

import {
  SENSORIUM_DISCLOSURE_FAMILY,
  describeActiveSensoriumSubscriptions,
} from "../src/sensoriumSubscriptionDisclosure.js";

const NOW = new Date("2026-05-15T07:00:00.000Z");

function activeSubscription(overrides = {}) {
  return {
    capability: "perception.sensorium.color.subscribe",
    provider: "soma.provider.sensorium.jetsorano",
    grant_id: "grant-test-1",
    scope: "session",
    topic: "sensor/jetsorano/realsense/color",
    started_at: "2026-05-15T06:52:00.000Z",
    expires_at: "2026-05-15T07:08:00.000Z", // 8 min from NOW
    constraints_declared: {
      max_seconds: 600,
      max_fps: 5,
      downsample_to: [384, 384],
      format_required: "jpeg",
    },
    recent_frame_rate: 4.8,
    frames_consumed_so_far: 12345,
    ...overrides,
  };
}

// ── shape ───────────────────────────────────────────────────────────────────

test("disclosure with no active subscriptions returns empty digest", () => {
  const disclosure = describeActiveSensoriumSubscriptions([], { now: NOW });
  assert.equal(disclosure.family, SENSORIUM_DISCLOSURE_FAMILY);
  assert.equal(disclosure.family, "perception.sensorium");
  assert.equal(disclosure.active_count, 0);
  assert.equal(disclosure.summary, "No Sensorium subscriptions active");
  assert.deepEqual(disclosure.streams, []);
  assert.equal(disclosure.frames_recorded, false);
});

test("disclosure with one active color subscription describes it", () => {
  const disclosure = describeActiveSensoriumSubscriptions(
    [activeSubscription()],
    { now: NOW },
  );

  assert.equal(disclosure.active_count, 1);
  assert.equal(disclosure.summary, "perception via Sensorium: 1 stream active");
  assert.equal(disclosure.streams.length, 1);

  const stream = disclosure.streams[0];
  assert.equal(stream.capability, "perception.sensorium.color.subscribe");
  assert.equal(stream.host, "jetsorano");
  assert.equal(stream.scope, "session");
  assert.equal(stream.expires_in_seconds, 480);
  assert.equal(stream.recent_frame_rate, 4.8);
  assert.equal(stream.frames_consumed_so_far, 12345);
  assert.equal(stream.description, "Receiving color frames from jetsorano at ~4.8 fps");
  assert.deepEqual(stream.constraints_declared, {
    max_seconds: 600,
    max_fps: 5,
    downsample_to: [384, 384],
    format_required: "jpeg",
  });
});

test("disclosure with multiple active subscriptions groups them", () => {
  const disclosure = describeActiveSensoriumSubscriptions(
    [
      activeSubscription(),
      activeSubscription({
        capability: "perception.sensorium.depth.subscribe",
        topic: "sensor/jetsorano/realsense/depth",
        recent_frame_rate: 4.7,
        frames_consumed_so_far: 11500,
      }),
      activeSubscription({
        capability: "perception.sensorium.status.subscribe",
        topic: "sensor/jetsorano/status",
        recent_frame_rate: 0.2,
        frames_consumed_so_far: 5,
        constraints_declared: { max_seconds: 600 },
      }),
    ],
    { now: NOW },
  );

  assert.equal(disclosure.active_count, 3);
  assert.equal(disclosure.summary, "perception via Sensorium: 3 streams active");
  assert.deepEqual(
    disclosure.streams.map((s) => s.capability),
    [
      "perception.sensorium.color.subscribe",
      "perception.sensorium.depth.subscribe",
      "perception.sensorium.status.subscribe",
    ],
  );
});

// ── per-capability descriptions ────────────────────────────────────────────

test("disclosure descriptions match the capability family vocabulary", () => {
  const cases = [
    {
      capability: "perception.sensorium.color.subscribe",
      topic: "sensor/jetsorano/realsense/color",
      recent_frame_rate: 5,
      want: "Receiving color frames from jetsorano at ~5 fps",
    },
    {
      capability: "perception.sensorium.depth.subscribe",
      topic: "sensor/jetsorano/realsense/depth",
      recent_frame_rate: 24,
      want: "Receiving depth maps from jetsorano at ~24 fps",
    },
    {
      capability: "perception.sensorium.imu.subscribe",
      topic: "sensor/jetsorano/realsense/imu/accel",
      recent_frame_rate: 24,
      want: "Receiving accel + gyro samples from jetsorano",
    },
    {
      capability: "perception.sensorium.location.subscribe",
      topic: "sensor/jetsorano/location",
      want: "Receiving static location from jetsorano",
    },
    {
      capability: "perception.sensorium.status.subscribe",
      topic: "sensor/jetsorano/status",
      want: "Receiving heartbeat from jetsorano",
    },
  ];

  for (const { capability, topic, recent_frame_rate, want } of cases) {
    const disclosure = describeActiveSensoriumSubscriptions(
      [
        activeSubscription({
          capability,
          topic,
          recent_frame_rate: recent_frame_rate ?? null,
        }),
      ],
      { now: NOW },
    );
    assert.equal(
      disclosure.streams[0].description,
      want,
      `expected description for ${capability}`,
    );
  }
});

test("disclosure omits fps phrase for non-streaming capabilities even when provided", () => {
  const disclosure = describeActiveSensoriumSubscriptions(
    [
      activeSubscription({
        capability: "perception.sensorium.imu.subscribe",
        topic: "sensor/jetsorano/realsense/imu/accel",
        recent_frame_rate: 24,
      }),
    ],
    { now: NOW },
  );
  assert.equal(disclosure.streams[0].description, "Receiving accel + gyro samples from jetsorano");
});

// ── expiry ─────────────────────────────────────────────────────────────────

test("disclosure computes expires_in_seconds against a provided 'now'", () => {
  const disclosure = describeActiveSensoriumSubscriptions(
    [
      activeSubscription({ expires_at: "2026-05-15T07:00:30.000Z" }),
      activeSubscription({ expires_at: "2026-05-15T07:30:00.000Z" }),
    ],
    { now: NOW },
  );
  assert.equal(disclosure.streams[0].expires_in_seconds, 30);
  assert.equal(disclosure.streams[1].expires_in_seconds, 1800);
});

test("disclosure clamps expires_in_seconds to 0 for already-expired subscriptions", () => {
  const disclosure = describeActiveSensoriumSubscriptions(
    [activeSubscription({ expires_at: "2026-05-15T06:00:00.000Z" })],
    { now: NOW },
  );
  assert.equal(disclosure.streams[0].expires_in_seconds, 0);
});

test("disclosure handles missing/malformed expires_at by returning null", () => {
  for (const expires_at of ["", "not-a-date", undefined, null]) {
    const disclosure = describeActiveSensoriumSubscriptions(
      [activeSubscription({ expires_at })],
      { now: NOW },
    );
    assert.equal(disclosure.streams[0].expires_in_seconds, null);
  }
});

// ── filtering and content discipline ───────────────────────────────────────

test("disclosure silently filters out non-Sensorium subscriptions", () => {
  const disclosure = describeActiveSensoriumSubscriptions(
    [
      activeSubscription(),
      {
        capability: "desktop.inspect.focus",
        topic: "irrelevant",
        scope: "session",
      },
    ],
    { now: NOW },
  );
  assert.equal(disclosure.active_count, 1);
  assert.equal(disclosure.streams[0].capability, "perception.sensorium.color.subscribe");
});

test("disclosure never includes frame content even if a record carries it", () => {
  // Property test: a future bug where someone attached frame bytes to
  // a subscription record should not leak through disclosure. The
  // disclosure surface only carries the declared fields it knows
  // about — extra fields like `frame_data` get dropped on the floor.
  const disclosure = describeActiveSensoriumSubscriptions(
    [
      activeSubscription({
        frame_data: "this is fake JPEG data and must never appear in disclosure",
        last_frame_bytes: [0xff, 0xd8, 0xff, 0xe0],
      }),
    ],
    { now: NOW },
  );
  const serialized = JSON.stringify(disclosure);
  assert.equal(serialized.includes("fake JPEG"), false);
  assert.equal(serialized.includes("last_frame_bytes"), false);
  assert.equal(serialized.includes("frame_data"), false);
  assert.equal(disclosure.frames_recorded, false);
});

test("disclosure rejects non-array input", () => {
  assert.throws(() => describeActiveSensoriumSubscriptions(null), {
    message: /must be an array/,
  });
  assert.throws(() => describeActiveSensoriumSubscriptions("nope"), {
    message: /must be an array/,
  });
});

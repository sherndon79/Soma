// Step-4 overreach tests for Sensorium subscription requests.
//
// These tests are separate from sensoriumSubscriptionRequest.test.js to
// keep the *named overreach scenarios* findable on their own. The unit
// tests in that file prove the validator's per-rule behavior; this
// file pins the rejection of specific overreach SHAPES that the
// disabled-first sequence explicitly forbids.
//
// Overreach classes covered:
//
//   1. Cross-capability topic confusion — the color capability cannot
//      be invoked against the depth topic, the status capability
//      cannot be invoked against the location topic, etc.
//   2. Future-shaped field overreach — fields that look plausible for
//      a future schema (e.g. subscription_callback_url,
//      region_of_interest, target_resolution_w) are rejected, not
//      silently accepted and forwarded.
//   3. IMU subtopic enforcement — the imu capability is broad enough
//      to cover both accel and gyro, but the topic must still resolve
//      to one of those specific tails, not to /realsense/imu alone.
//   4. Capability-spoofing-by-payload — a request that pretends to be
//      multiple capabilities at once (color constraints on a status
//      subscription, etc.) is rejected.
//
// Each test asserts the rejection code stays stable
// (sensorium_subscription_request_invalid). The error_messages aren't
// load-bearing across the suite — they're informational — but the
// codes are part of the contract.

import assert from "node:assert/strict";
import test from "node:test";

import { validateSensoriumSubscriptionRequest } from "../src/sensoriumSubscriptionRequest.js";

const CROSS_CAPABILITY_TOPIC_PAIRS = [
  {
    capability: "perception.sensorium.color.subscribe",
    topic: "sensor/jetsorano/realsense/depth",
    why: "color capability with depth topic",
  },
  {
    capability: "perception.sensorium.color.subscribe",
    topic: "sensor/jetsorano/status",
    why: "color capability with status topic",
  },
  {
    capability: "perception.sensorium.depth.subscribe",
    topic: "sensor/jetsorano/realsense/color",
    why: "depth capability with color topic",
  },
  {
    capability: "perception.sensorium.presence.subscribe",
    topic: "sensor/jetsorano/realsense/depth",
    why: "presence capability with raw depth topic",
  },
  {
    capability: "perception.sensorium.depth.subscribe",
    topic: "perception/jetsorano/presence",
    why: "depth capability with derived presence topic",
  },
  {
    capability: "perception.sensorium.status.subscribe",
    topic: "sensor/jetsorano/location",
    why: "status capability with location topic",
  },
  {
    capability: "perception.sensorium.location.subscribe",
    topic: "sensor/jetsorano/status",
    why: "location capability with status topic",
  },
  {
    capability: "perception.sensorium.imu.subscribe",
    topic: "sensor/jetsorano/realsense/color",
    why: "imu capability with color topic",
  },
  {
    capability: "perception.sensorium.imu.subscribe",
    topic: "sensor/jetsorano/realsense/imu", // missing /accel or /gyro
    why: "imu capability without a specific subtopic",
  },
];

test("Sensorium overreach: cross-capability topic confusion is rejected", () => {
  for (const { capability, topic, why } of CROSS_CAPABILITY_TOPIC_PAIRS) {
    assert.throws(
      () =>
        validateSensoriumSubscriptionRequest({ topic }, { capability }),
      { code: "sensorium_subscription_request_invalid" },
      `expected rejection for: ${why} (cap=${capability} topic=${topic})`,
    );
  }
});

// ── Future-shaped field overreach ──────────────────────────────────────────

const FUTURE_TOP_LEVEL_FIELDS = [
  "schema_version",
  "subscription_callback_url",
  "client_session_id",
  "preferences",
  "metadata",
  "extensions",
];

test("Sensorium overreach: future-shaped top-level fields are rejected", () => {
  for (const field of FUTURE_TOP_LEVEL_FIELDS) {
    assert.throws(
      () =>
        validateSensoriumSubscriptionRequest(
          { topic: "sensor/jetsorano/status", [field]: "anything" },
          { capability: "perception.sensorium.status.subscribe" },
        ),
      { code: "sensorium_subscription_request_invalid" },
      `expected rejection for future top-level field: ${field}`,
    );
  }
});

const FUTURE_CONSTRAINT_FIELDS = [
  "region_of_interest",
  "target_resolution_w",
  "target_resolution_h",
  "callback_url",
  "model_input_hint",
  "schema_version",
];

test("Sensorium overreach: future-shaped constraint fields are rejected", () => {
  for (const field of FUTURE_CONSTRAINT_FIELDS) {
    assert.throws(
      () =>
        validateSensoriumSubscriptionRequest(
          {
            topic: "sensor/jetsorano/realsense/color",
            constraints: { [field]: "anything" },
          },
          { capability: "perception.sensorium.color.subscribe" },
        ),
      { code: "sensorium_subscription_request_invalid" },
      `expected rejection for future constraint field: ${field}`,
    );
  }
});

// ── Capability-spoofing-by-payload ─────────────────────────────────────────

test("Sensorium overreach: video-only constraints on non-video capabilities are rejected", () => {
  // Trying to attach max_fps + downsample_to + format_required to a
  // status subscription (or any non-video subscription) is a payload
  // shape that suggests "I want to receive video here." The validator
  // must reject it.
  for (const capability of [
    "perception.sensorium.status.subscribe",
    "perception.sensorium.location.subscribe",
    "perception.sensorium.imu.subscribe",
  ]) {
    // Pick a topic that matches the capability so the rejection is
    // unambiguously about the constraint set, not the topic.
    const topicByCapability = {
      "perception.sensorium.status.subscribe": "sensor/jetsorano/status",
      "perception.sensorium.location.subscribe": "sensor/jetsorano/location",
      "perception.sensorium.imu.subscribe": "sensor/jetsorano/realsense/imu/accel",
    };
    assert.throws(
      () =>
        validateSensoriumSubscriptionRequest(
          {
            topic: topicByCapability[capability],
            constraints: {
              max_fps: 5,
              downsample_to: [384, 384],
              format_required: "jpeg",
            },
          },
          { capability },
        ),
      { code: "sensorium_subscription_request_invalid" },
      `expected rejection of video-shaped constraints on ${capability}`,
    );
  }
});

test("Sensorium overreach: depth-format on color capability is rejected (and vice versa)", () => {
  assert.throws(
    () =>
      validateSensoriumSubscriptionRequest(
        {
          topic: "sensor/jetsorano/realsense/color",
          constraints: { format_required: "png" }, // depth-only format
        },
        { capability: "perception.sensorium.color.subscribe" },
      ),
    { code: "sensorium_subscription_request_invalid" },
  );

  assert.throws(
    () =>
      validateSensoriumSubscriptionRequest(
        {
          topic: "sensor/jetsorano/realsense/depth",
          constraints: { format_required: "jpeg" }, // color-only format
        },
        { capability: "perception.sensorium.depth.subscribe" },
      ),
    { code: "sensorium_subscription_request_invalid" },
  );
});

// ── End-to-end: every overreach surfaces the same error code ───────────────

test("Sensorium overreach: every rejected payload surfaces sensorium_subscription_request_invalid", () => {
  // Sanity test: the union of all overreach payloads above should
  // produce ONE stable error code that callers can match on. This
  // matters because Soma's policy gateway and proposal flow will key
  // off the code to decide error classification (refused vs invalid
  // vs internal error). If a future change accidentally introduces a
  // different code for some rejection path, this test catches it.

  const payloads = [
    [
      { topic: "sensor/jetsorano/realsense/depth" },
      { capability: "perception.sensorium.color.subscribe" },
    ],
    [
      { topic: "sensor/jetsorano/status", schema_version: 2 },
      { capability: "perception.sensorium.status.subscribe" },
    ],
    [
      {
        topic: "sensor/jetsorano/realsense/color",
        constraints: { target_resolution_w: 1920 },
      },
      { capability: "perception.sensorium.color.subscribe" },
    ],
    [
      {
        topic: "sensor/jetsorano/realsense/imu", // imu without subtopic
      },
      { capability: "perception.sensorium.imu.subscribe" },
    ],
  ];

  for (const [body, options] of payloads) {
    try {
      validateSensoriumSubscriptionRequest(body, options);
      assert.fail(`expected rejection for body=${JSON.stringify(body)}`);
    } catch (err) {
      assert.equal(
        err.code,
        "sensorium_subscription_request_invalid",
        `unexpected error code for body=${JSON.stringify(body)}: ${err.code}`,
      );
      assert.equal(err.statusCode, 400);
      assert.ok(
        Array.isArray(err.validation_errors) &&
          err.validation_errors.length > 0,
        "expected validation_errors array on rejection",
      );
    }
  }
});

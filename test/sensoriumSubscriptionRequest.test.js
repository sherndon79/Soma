import assert from "node:assert/strict";
import test from "node:test";

import {
  SENSORIUM_SUBSCRIPTION_CAPABILITIES,
  validateSensoriumSubscriptionRequest,
} from "../src/sensoriumSubscriptionRequest.js";

// ── Happy paths ─────────────────────────────────────────────────────────────

test("Sensorium request validator accepts a full color subscription request", () => {
  const result = validateSensoriumSubscriptionRequest(
    {
      topic: "sensor/jetsorano/realsense/color",
      constraints: {
        max_seconds: 600,
        max_fps: 5,
        downsample_to: [384, 384],
        format_required: "jpeg",
      },
    },
    { capability: "perception.sensorium.color.subscribe" },
  );

  assert.deepEqual(result, {
    capability: "perception.sensorium.color.subscribe",
    topic: "sensor/jetsorano/realsense/color",
    constraints: {
      max_seconds: 600,
      max_fps: 5,
      downsample_to: [384, 384],
      format_required: "jpeg",
    },
  });
});

test("Sensorium request validator accepts a minimal status subscription request", () => {
  const result = validateSensoriumSubscriptionRequest(
    { topic: "sensor/jetsorano/status" },
    { capability: "perception.sensorium.status.subscribe" },
  );

  assert.deepEqual(result, {
    capability: "perception.sensorium.status.subscribe",
    topic: "sensor/jetsorano/status",
    constraints: {},
  });
});

test("Sensorium request validator accepts derived presence topic", () => {
  const result = validateSensoriumSubscriptionRequest(
    {
      topic: "perception/jetsorano/presence",
      constraints: {
        max_seconds: 120,
        max_fps: 5,
      },
    },
    { capability: "perception.sensorium.presence.subscribe" },
  );

  assert.deepEqual(result, {
    capability: "perception.sensorium.presence.subscribe",
    topic: "perception/jetsorano/presence",
    constraints: {
      max_seconds: 120,
      max_fps: 5,
    },
  });
});

test("Sensorium request validator accepts full derived pose topic", () => {
  const result = validateSensoriumSubscriptionRequest(
    {
      topic: "perception/jetsorano/pose/features",
      constraints: {
        max_seconds: 120,
        max_fps: 10,
      },
    },
    { capability: "perception.sensorium.pose.subscribe" },
  );

  assert.deepEqual(result, {
    capability: "perception.sensorium.pose.subscribe",
    topic: "perception/jetsorano/pose/features",
    constraints: {
      max_seconds: 120,
      max_fps: 10,
    },
  });
});

test("Sensorium request validator accepts both imu accel and gyro topics", () => {
  for (const topic of [
    "sensor/jetsorano/realsense/imu/accel",
    "sensor/jetsorano/realsense/imu/gyro",
  ]) {
    const result = validateSensoriumSubscriptionRequest(
      { topic, constraints: { max_seconds: 60 } },
      { capability: "perception.sensorium.imu.subscribe" },
    );
    assert.equal(result.topic, topic);
    assert.equal(result.constraints.max_seconds, 60);
  }
});

test("Sensorium request validator drops unknown allowed-set keys silently when copying constraints", () => {
  // (Keys outside the allowed set are rejected, not silently dropped —
  // this test confirms the *allowed* keys round-trip cleanly without
  // foreign properties sneaking through Object spread on body.)
  const result = validateSensoriumSubscriptionRequest(
    {
      topic: "sensor/jetsorano/status",
      constraints: { max_seconds: 30 },
    },
    { capability: "perception.sensorium.status.subscribe" },
  );
  assert.deepEqual(Object.keys(result.constraints), ["max_seconds"]);
});

// ── Capability-key validation ───────────────────────────────────────────────

test("Sensorium request validator rejects an unrecognized capability key", () => {
  assert.throws(
    () =>
      validateSensoriumSubscriptionRequest(
        { topic: "sensor/jetsorano/status" },
        { capability: "perception.sensorium.future.subscribe" },
      ),
    {
      code: "sensorium_subscription_request_invalid",
      validation_errors: [
        'capability "perception.sensorium.future.subscribe" is not a recognized Sensorium subscription capability',
      ],
    },
  );
});

test("Sensorium request validator rejects a missing capability key", () => {
  assert.throws(
    () =>
      validateSensoriumSubscriptionRequest({
        topic: "sensor/jetsorano/status",
      }),
    {
      code: "sensorium_subscription_request_invalid",
    },
  );
});

// ── Top-level shape ─────────────────────────────────────────────────────────

test("Sensorium request validator rejects non-object bodies", () => {
  assert.throws(
    () =>
      validateSensoriumSubscriptionRequest("not an object", {
        capability: "perception.sensorium.status.subscribe",
      }),
    { code: "sensorium_subscription_request_invalid" },
  );
});

test("Sensorium request validator rejects unknown top-level fields", () => {
  assert.throws(
    () =>
      validateSensoriumSubscriptionRequest(
        {
          topic: "sensor/jetsorano/status",
          extra: "not-allowed",
        },
        { capability: "perception.sensorium.status.subscribe" },
      ),
    {
      code: "sensorium_subscription_request_invalid",
      validation_errors: ["request.extra is not allowed"],
    },
  );
});

// ── Topic validation ────────────────────────────────────────────────────────

test("Sensorium request validator rejects a missing topic", () => {
  assert.throws(
    () =>
      validateSensoriumSubscriptionRequest(
        { constraints: { max_seconds: 30 } },
        { capability: "perception.sensorium.status.subscribe" },
      ),
    {
      code: "sensorium_subscription_request_invalid",
      validation_errors: ["request.topic must be a non-empty string"],
    },
  );
});

test("Sensorium request validator rejects an empty topic", () => {
  assert.throws(
    () =>
      validateSensoriumSubscriptionRequest(
        { topic: "" },
        { capability: "perception.sensorium.status.subscribe" },
      ),
    {
      code: "sensorium_subscription_request_invalid",
      validation_errors: ["request.topic must be a non-empty string"],
    },
  );
});

test("Sensorium request validator rejects a topic without the sensor/<host>/<tail> shape", () => {
  for (const topic of [
    "no/scheme",
    "sensor/",
    "sensor/jetsorano",      // host but no tail
    "sensor//realsense/color", // empty host segment
    "wrong-prefix/jetsorano/status",
  ]) {
    assert.throws(
      () =>
        validateSensoriumSubscriptionRequest(
          { topic },
          { capability: "perception.sensorium.status.subscribe" },
        ),
      {
        code: "sensorium_subscription_request_invalid",
      },
      `expected rejection for topic ${JSON.stringify(topic)}`,
    );
  }
});

// ── Constraint validation ───────────────────────────────────────────────────

test("Sensorium request validator rejects unknown constraint keys", () => {
  assert.throws(
    () =>
      validateSensoriumSubscriptionRequest(
        {
          topic: "sensor/jetsorano/realsense/color",
          constraints: { quality: "best" },
        },
        { capability: "perception.sensorium.color.subscribe" },
      ),
    {
      code: "sensorium_subscription_request_invalid",
      validation_errors: [
        "request.constraints.quality is not allowed for perception.sensorium.color.subscribe",
      ],
    },
  );
});

test("Sensorium request validator keeps derived presence distinct from raw depth constraints", () => {
  assert.throws(
    () =>
      validateSensoriumSubscriptionRequest(
        {
          topic: "perception/jetsorano/presence",
          constraints: {
            max_seconds: 120,
            max_fps: 5,
            downsample_to: [384, 384],
          },
        },
        { capability: "perception.sensorium.presence.subscribe" },
      ),
    {
      code: "sensorium_subscription_request_invalid",
      validation_errors: [
        "request.constraints.downsample_to is not allowed for perception.sensorium.presence.subscribe",
      ],
    },
  );

  assert.throws(
    () =>
      validateSensoriumSubscriptionRequest(
        {
          topic: "perception/jetsorano/presence",
          constraints: {
            max_seconds: 120,
            max_fps: 5,
            format_required: "png",
          },
        },
        { capability: "perception.sensorium.presence.subscribe" },
      ),
    {
      code: "sensorium_subscription_request_invalid",
      validation_errors: [
        "request.constraints.format_required is not allowed for perception.sensorium.presence.subscribe",
      ],
    },
  );
});

test("Sensorium request validator keeps derived pose distinct from frame constraints", () => {
  assert.throws(
    () =>
      validateSensoriumSubscriptionRequest(
        {
          topic: "perception/jetsorano/pose/features",
          constraints: {
            max_seconds: 120,
            max_fps: 5,
            downsample_to: [384, 384],
          },
        },
        { capability: "perception.sensorium.pose.subscribe" },
      ),
    {
      code: "sensorium_subscription_request_invalid",
      validation_errors: [
        "request.constraints.downsample_to is not allowed for perception.sensorium.pose.subscribe",
      ],
    },
  );

  assert.throws(
    () =>
      validateSensoriumSubscriptionRequest(
        {
          topic: "perception/jetsorano/pose/features",
          constraints: {
            max_seconds: 120,
            max_fps: 5,
            format_required: "json",
          },
        },
        { capability: "perception.sensorium.pose.subscribe" },
      ),
    {
      code: "sensorium_subscription_request_invalid",
      validation_errors: [
        "request.constraints.format_required is not allowed for perception.sensorium.pose.subscribe",
      ],
    },
  );
});

test("Sensorium request validator rejects presence on the color topic", () => {
  assert.throws(
    () =>
      validateSensoriumSubscriptionRequest(
        {
          topic: "sensor/jetsorano/realsense/color",
          constraints: {
            max_seconds: 120,
            max_fps: 5,
          },
        },
        { capability: "perception.sensorium.presence.subscribe" },
      ),
    {
      code: "sensorium_subscription_request_invalid",
      validation_errors: [
        "request.topic must match perception/<host>/presence for perception.sensorium.presence.subscribe",
      ],
    },
  );
});

test("Sensorium request validator rejects broad presence wildcards before helper", () => {
  for (const topic of [
    "perception/**/presence",
    "perception/*/presence",
    "perception/jetsorano/**",
    "sensor/jetsorano/realsense/depth",
  ]) {
    assert.throws(
      () =>
        validateSensoriumSubscriptionRequest(
          { topic },
          { capability: "perception.sensorium.presence.subscribe" },
        ),
      {
        code: "sensorium_subscription_request_invalid",
      },
      `expected rejection for topic ${JSON.stringify(topic)}`,
    );
  }
});

test("Sensorium request validator rejects pose on non-pose topics", () => {
  for (const topic of [
    "perception/jetsorano/presence",
    "perception/jetsorano/pose/**",
    "sensor/jetsorano/realsense/color",
  ]) {
    assert.throws(
      () =>
        validateSensoriumSubscriptionRequest(
          { topic, constraints: { max_seconds: 120, max_fps: 5 } },
          { capability: "perception.sensorium.pose.subscribe" },
        ),
      {
        code: "sensorium_subscription_request_invalid",
      },
      `expected rejection for topic ${JSON.stringify(topic)}`,
    );
  }
});

test("Sensorium request validator rejects max_fps on non-streaming capabilities", () => {
  for (const cap of [
    "perception.sensorium.imu.subscribe",
    "perception.sensorium.location.subscribe",
    "perception.sensorium.status.subscribe",
  ]) {
    assert.throws(
      () =>
        validateSensoriumSubscriptionRequest(
          {
            topic: "sensor/jetsorano/status",
            constraints: { max_fps: 5 },
          },
          { capability: cap },
        ),
      {
        code: "sensorium_subscription_request_invalid",
      },
      `expected rejection for max_fps on ${cap}`,
    );
  }
});

test("Sensorium request validator rejects out-of-range max_seconds", () => {
  for (const bad of [0, -1, 3601, 99999, "30", 1.5]) {
    assert.throws(
      () =>
        validateSensoriumSubscriptionRequest(
          {
            topic: "sensor/jetsorano/status",
            constraints: { max_seconds: bad },
          },
          { capability: "perception.sensorium.status.subscribe" },
        ),
      {
        code: "sensorium_subscription_request_invalid",
      },
      `expected rejection for max_seconds=${JSON.stringify(bad)}`,
    );
  }
});

test("Sensorium request validator rejects out-of-range max_fps for video streams", () => {
  for (const bad of [0, 31, 100, "10", 1.5]) {
    assert.throws(
      () =>
        validateSensoriumSubscriptionRequest(
          {
            topic: "sensor/jetsorano/realsense/color",
            constraints: { max_fps: bad },
          },
          { capability: "perception.sensorium.color.subscribe" },
        ),
      {
        code: "sensorium_subscription_request_invalid",
      },
      `expected rejection for max_fps=${JSON.stringify(bad)}`,
    );
  }
});

test("Sensorium request validator rejects malformed downsample_to", () => {
  for (const bad of [
    [384],
    [384, 384, 384],
    ["384", "384"],
    [-1, 384],
    [10000, 10000],
    "384x384",
    null,
  ]) {
    assert.throws(
      () =>
        validateSensoriumSubscriptionRequest(
          {
            topic: "sensor/jetsorano/realsense/color",
            constraints: { downsample_to: bad },
          },
          { capability: "perception.sensorium.color.subscribe" },
        ),
      {
        code: "sensorium_subscription_request_invalid",
      },
      `expected rejection for downsample_to=${JSON.stringify(bad)}`,
    );
  }
});

test("Sensorium request validator rejects unknown format_required for color (only jpeg allowed)", () => {
  assert.throws(
    () =>
      validateSensoriumSubscriptionRequest(
        {
          topic: "sensor/jetsorano/realsense/color",
          constraints: { format_required: "png" },
        },
        { capability: "perception.sensorium.color.subscribe" },
      ),
    {
      code: "sensorium_subscription_request_invalid",
      validation_errors: [
        "request.constraints.format_required must be one of: jpeg",
      ],
    },
  );
});

test("Sensorium request validator rejects unknown format_required for depth (only png allowed)", () => {
  assert.throws(
    () =>
      validateSensoriumSubscriptionRequest(
        {
          topic: "sensor/jetsorano/realsense/depth",
          constraints: { format_required: "jpeg" },
        },
        { capability: "perception.sensorium.depth.subscribe" },
      ),
    {
      code: "sensorium_subscription_request_invalid",
      validation_errors: [
        "request.constraints.format_required must be one of: png",
      ],
    },
  );
});

// ── Exported metadata ───────────────────────────────────────────────────────

test("Sensorium request validator publishes its known capability set", () => {
  assert.deepEqual([...SENSORIUM_SUBSCRIPTION_CAPABILITIES].sort(), [
    "perception.sensorium.color.subscribe",
    "perception.sensorium.depth.subscribe",
    "perception.sensorium.imu.subscribe",
    "perception.sensorium.location.subscribe",
    "perception.sensorium.pose.subscribe",
    "perception.sensorium.presence.subscribe",
    "perception.sensorium.status.subscribe",
  ]);
});

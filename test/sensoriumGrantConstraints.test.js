import assert from "node:assert/strict";
import test from "node:test";

import { enforceSensoriumGrantConstraints } from "../src/sensoriumGrantConstraints.js";

const request = {
  capability: "perception.sensorium.color.subscribe",
  topic: "sensor/jetsorano/realsense/color",
  constraints: {
    max_seconds: 30,
    max_fps: 5,
    format_required: "jpeg",
    downsample_to: [320, 240],
  },
};

const grant = {
  id: "grant-sensorium-color",
  constraints: {
    max_seconds: 60,
    max_fps: 10,
    format_required: "jpeg",
    downsample_to: [640, 480],
  },
};

test("Sensorium grant constraints allow requests narrower than the active grant", () => {
  const bounded = enforceSensoriumGrantConstraints({ request, grant });

  assert.deepEqual(bounded.constraints, request.constraints);
});

test("Sensorium grant constraints apply grant maxima when request omits bounded values", () => {
  const bounded = enforceSensoriumGrantConstraints({
    request: {
      ...request,
      constraints: {},
    },
    grant,
  });

  assert.deepEqual(bounded.constraints, grant.constraints);
});

test("Sensorium grant constraints reject requests longer than grant maximum", () => {
  assertConstraintError(
    () => enforceSensoriumGrantConstraints({
      request: {
        ...request,
        constraints: { ...request.constraints, max_seconds: 61 },
      },
      grant,
    }),
    /max_seconds/,
  );
});

test("Sensorium grant constraints reject requests faster than grant maximum", () => {
  assertConstraintError(
    () => enforceSensoriumGrantConstraints({
      request: {
        ...request,
        constraints: { ...request.constraints, max_fps: 11 },
      },
      grant,
    }),
    /max_fps/,
  );
});

test("Sensorium grant constraints reject wrong requested format", () => {
  assertConstraintError(
    () => enforceSensoriumGrantConstraints({
      request: {
        ...request,
        constraints: { ...request.constraints, format_required: "png" },
      },
      grant,
    }),
    /format_required/,
  );
});

test("Sensorium grant constraints reject oversized downsample dimensions", () => {
  assertConstraintError(
    () => enforceSensoriumGrantConstraints({
      request: {
        ...request,
        constraints: { ...request.constraints, downsample_to: [800, 480] },
      },
      grant,
    }),
    /downsample_to/,
  );
});

test("Sensorium grant constraints reject requested bounded keys absent from grant", () => {
  assertConstraintError(
    () => enforceSensoriumGrantConstraints({
      request,
      grant: { id: "grant-without-constraints", constraints: {} },
    }),
    /grant\.constraints\.max_seconds/,
  );
});

test("Sensorium grant constraints reject malformed grant limits", () => {
  assertConstraintError(
    () => enforceSensoriumGrantConstraints({
      request,
      grant: {
        id: "grant-malformed",
        constraints: {
          max_seconds: "sixty",
          max_fps: 10,
          format_required: "jpeg",
          downsample_to: [640, 480],
        },
      },
    }),
    /grant\.constraints\.max_seconds/,
  );
});

function assertConstraintError(fn, pattern) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, "sensorium_subscription_grant_constraints_exceeded");
    assert.equal(error.statusCode, 403);
    assert.match(error.message, pattern);
    assert.ok(Array.isArray(error.validation_errors));
    return true;
  });
}

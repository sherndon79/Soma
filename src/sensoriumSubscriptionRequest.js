// Request-shape validator for Sensorium subscription invocations.
//
// Step 3 of the disabled-first sequence in
// docs/concepts/drafts/sensorium_integration.md: validate the body of a
// proposed Sensorium subscription request and reject anything malformed
// or over-broad *before* any helper is reached. The validator is a pure
// function; it does not establish any subscription and does not touch
// the Zenoh fabric.
//
// Even after this module lands, the public capability path stays
// fail-closed because:
//   - No grant exists for any perception.sensorium.* capability
//   - No Soma endpoint yet routes to this validator
//   - The Rust sensor-broker helper that would back any allowed
//     subscription is not implemented
//
// The validator is published as a building block for later slices
// (proposal evaluation, the helper invocation contract) to invoke.

const SENSORIUM_CAPABILITY_KEYS = new Set([
  "perception.sensorium.color.subscribe",
  "perception.sensorium.depth.subscribe",
  "perception.sensorium.imu.subscribe",
  "perception.sensorium.location.subscribe",
  "perception.sensorium.status.subscribe",
]);

const REQUEST_KEYS = new Set(["topic", "constraints"]);

// Per-capability allowed constraint keys and (where relevant) the
// allowed `format_required` values. Constraints not in the allowed set
// for a given capability are rejected; capability-specific constraints
// like `max_fps` and `downsample_to` are silently ignored on
// non-streaming capabilities by being absent from those allowed sets.
const CONSTRAINT_RULES = {
  "perception.sensorium.color.subscribe": {
    allowed: new Set(["max_seconds", "max_fps", "downsample_to", "format_required"]),
    formats: new Set(["jpeg"]),
  },
  "perception.sensorium.depth.subscribe": {
    allowed: new Set(["max_seconds", "max_fps", "downsample_to", "format_required"]),
    formats: new Set(["png"]),
  },
  "perception.sensorium.imu.subscribe": {
    allowed: new Set(["max_seconds"]),
    formats: null,
  },
  "perception.sensorium.location.subscribe": {
    allowed: new Set(["max_seconds"]),
    formats: null,
  },
  "perception.sensorium.status.subscribe": {
    allowed: new Set(["max_seconds"]),
    formats: null,
  },
};

// Bounded integer constraints. min/max are inclusive.
const INTEGER_LIMIT_RANGES = {
  max_seconds: [1, 3600],
  max_fps:     [1, 30],
};

// Downsample target bounds. Each dimension must fit within plausible
// sensor output sizes; rejecting <16 or >1920 catches obvious garbage
// while letting consumers downsample to model-encoder-friendly sizes
// (e.g., 384x384 for Gemma-style encoders).
const DOWNSAMPLE_MIN = 16;
const DOWNSAMPLE_MAX = 1920;

// Topic must look like `sensor/<host>/<segment(s)>`. Host segment uses
// the same shape as Sensorium's hostname-scoped namespace; deeper
// segments cover the topic tails (e.g., realsense/color, realsense/imu/
// accel). The pattern is permissive about depth so future Sensorium
// publishers (audio, etc.) don't need to be re-validated here.
const TOPIC_PATTERN = /^sensor\/[a-z0-9-]+(\/[a-z0-9_-]+)+$/;

export function validateSensoriumSubscriptionRequest(body, { capability } = {}) {
  const errors = [];

  if (!SENSORIUM_CAPABILITY_KEYS.has(capability)) {
    errors.push(
      `capability "${capability ?? "(missing)"}" is not a recognized Sensorium subscription capability`,
    );
  }

  if (!isPlainObject(body)) {
    errors.push("request must be an object");
    throwSensoriumSubscriptionError(errors);
  }

  for (const key of Object.keys(body)) {
    if (!REQUEST_KEYS.has(key)) {
      errors.push(`request.${key} is not allowed`);
    }
  }

  if (typeof body.topic !== "string" || body.topic.length === 0) {
    errors.push("request.topic must be a non-empty string");
  } else if (!TOPIC_PATTERN.test(body.topic)) {
    errors.push("request.topic must match sensor/<host>/<tail>");
  }

  const normalizedConstraints = {};
  if (body.constraints !== undefined) {
    if (!isPlainObject(body.constraints)) {
      errors.push("request.constraints must be an object when provided");
    } else if (SENSORIUM_CAPABILITY_KEYS.has(capability)) {
      const rules = CONSTRAINT_RULES[capability];

      for (const key of Object.keys(body.constraints)) {
        if (!rules.allowed.has(key)) {
          errors.push(
            `request.constraints.${key} is not allowed for ${capability}`,
          );
        }
      }

      validateConstraintBounds(body.constraints, rules, errors);

      // Copy through only the keys that survived; unknown keys are
      // never carried into the normalized result.
      for (const key of rules.allowed) {
        if (key in body.constraints) {
          normalizedConstraints[key] = body.constraints[key];
        }
      }
    }
  }

  if (errors.length > 0) {
    throwSensoriumSubscriptionError(errors);
  }

  return {
    capability,
    topic: body.topic,
    constraints: normalizedConstraints,
  };
}

function validateConstraintBounds(constraints, rules, errors) {
  for (const [key, [minimum, maximum]] of Object.entries(INTEGER_LIMIT_RANGES)) {
    if (!(key in constraints)) {
      continue;
    }
    if (!rules.allowed.has(key)) {
      // Already reported as "not allowed for this capability"; don't
      // double-report a bounds violation on top of it.
      continue;
    }
    const v = constraints[key];
    if (!Number.isInteger(v) || v < minimum || v > maximum) {
      errors.push(
        `request.constraints.${key} must be an integer from ${minimum} to ${maximum}`,
      );
    }
  }

  if ("downsample_to" in constraints && rules.allowed.has("downsample_to")) {
    const ds = constraints.downsample_to;
    const valid =
      Array.isArray(ds) &&
      ds.length === 2 &&
      ds.every(
        (v) => Number.isInteger(v) && v >= DOWNSAMPLE_MIN && v <= DOWNSAMPLE_MAX,
      );
    if (!valid) {
      errors.push(
        `request.constraints.downsample_to must be [width, height] with each integer ${DOWNSAMPLE_MIN}..${DOWNSAMPLE_MAX}`,
      );
    }
  }

  if ("format_required" in constraints && rules.allowed.has("format_required")) {
    if (rules.formats === null) {
      errors.push(
        "request.constraints.format_required is not applicable to this capability",
      );
    } else if (
      typeof constraints.format_required !== "string" ||
      !rules.formats.has(constraints.format_required)
    ) {
      errors.push(
        `request.constraints.format_required must be one of: ${[...rules.formats].join(", ")}`,
      );
    }
  }
}

function throwSensoriumSubscriptionError(errors) {
  const error = new Error(
    `Sensorium subscription request is invalid: ${errors.join("; ")}`,
  );
  error.statusCode = 400;
  error.code = "sensorium_subscription_request_invalid";
  error.validation_errors = errors;
  throw error;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Re-exports for callers that want to introspect the catalog.
export const SENSORIUM_SUBSCRIPTION_CAPABILITIES = Object.freeze([
  ...SENSORIUM_CAPABILITY_KEYS,
]);

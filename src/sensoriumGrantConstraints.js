const SENSORIUM_GRANT_CONSTRAINT_KEYS = new Set([
  "max_seconds",
  "max_fps",
  "format_required",
  "downsample_to",
]);

export function enforceSensoriumGrantConstraints({ request, grant } = {}) {
  const requested = objectOrEmpty(request?.constraints);
  const grantConstraints = objectOrEmpty(grant?.constraints);
  const errors = [];
  const constraints = { ...requested };

  for (const key of Object.keys(grantConstraints)) {
    if (!SENSORIUM_GRANT_CONSTRAINT_KEYS.has(key)) {
      continue;
    }
    if (key === "max_seconds" || key === "max_fps") {
      enforceIntegerMaximum({
        key,
        requested,
        grantConstraints,
        constraints,
        errors,
      });
    }
    if (key === "format_required") {
      enforceExactString({
        key,
        requested,
        grantConstraints,
        constraints,
        errors,
      });
    }
    if (key === "downsample_to") {
      enforceDownsampleMaximum({
        requested,
        grantConstraints,
        constraints,
        errors,
      });
    }
  }

  for (const key of Object.keys(requested)) {
    if (
      SENSORIUM_GRANT_CONSTRAINT_KEYS.has(key) &&
      !Object.hasOwn(grantConstraints, key)
    ) {
      errors.push(`grant.constraints.${key} must exist before request.constraints.${key} can be used`);
    }
  }

  if (errors.length > 0) {
    const error = new Error(
      `Sensorium subscription request exceeds grant constraints: ${errors.join("; ")}`,
    );
    error.statusCode = 403;
    error.code = "sensorium_subscription_grant_constraints_exceeded";
    error.validation_errors = errors;
    throw error;
  }

  return {
    ...request,
    constraints,
  };
}

function enforceIntegerMaximum({ key, requested, grantConstraints, constraints, errors }) {
  const grantValue = grantConstraints[key];
  if (!Number.isInteger(grantValue) || grantValue <= 0) {
    errors.push(`grant.constraints.${key} must be a positive integer`);
    return;
  }
  if (!Object.hasOwn(requested, key)) {
    constraints[key] = grantValue;
    return;
  }
  const requestedValue = requested[key];
  if (!Number.isInteger(requestedValue) || requestedValue > grantValue) {
    errors.push(`request.constraints.${key} must be no greater than grant limit ${grantValue}`);
  }
}

function enforceExactString({ key, requested, grantConstraints, constraints, errors }) {
  const grantValue = grantConstraints[key];
  if (typeof grantValue !== "string" || grantValue.length === 0) {
    errors.push(`grant.constraints.${key} must be a non-empty string`);
    return;
  }
  if (!Object.hasOwn(requested, key)) {
    constraints[key] = grantValue;
    return;
  }
  if (requested[key] !== grantValue) {
    errors.push(`request.constraints.${key} must match grant value ${grantValue}`);
  }
}

function enforceDownsampleMaximum({ requested, grantConstraints, constraints, errors }) {
  const grantValue = grantConstraints.downsample_to;
  if (!isDimensionPair(grantValue)) {
    errors.push("grant.constraints.downsample_to must be [width, height]");
    return;
  }
  if (!Object.hasOwn(requested, "downsample_to")) {
    constraints.downsample_to = [...grantValue];
    return;
  }
  const requestedValue = requested.downsample_to;
  if (!isDimensionPair(requestedValue)) {
    errors.push("request.constraints.downsample_to must be [width, height]");
    return;
  }
  if (requestedValue[0] > grantValue[0] || requestedValue[1] > grantValue[1]) {
    errors.push(
      `request.constraints.downsample_to must fit within grant limit ${grantValue[0]}x${grantValue[1]}`,
    );
  }
}

function isDimensionPair(value) {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((entry) => Number.isInteger(entry) && entry > 0)
  );
}

function objectOrEmpty(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

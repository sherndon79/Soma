const CONTRACTS = {
  "perception.sensorium.color.subscribe": {
    capability: "perception.sensorium.color.subscribe",
    stream_type: "color",
    expected_schema_version: 1,
    risk_class: "restricted",
    allowed_summary_fields: [
      "schema_version",
      "frame_number",
      "width",
      "height",
      "format",
      "payload_size",
    ],
    excluded_fields: [
      "data",
      "payload_bytes",
      "image_bytes",
      "image_content",
      "screenshot",
      "text_content",
      "raw_frame",
      "timestamp",
    ],
    allowed_formats: ["jpeg"],
    requires_constraints: ["max_seconds", "max_fps", "format_required", "downsample_to"],
    content_retention: "forbidden",
    model_delivery_without_further_grant: false,
  },
};

export function getSensoriumStreamContract(capability) {
  const contract = CONTRACTS[capability];
  if (!contract) {
    return null;
  }
  return deepCopy(contract);
}

export function assertSensoriumSummaryWithinContract(capability, summary) {
  const contract = getSensoriumStreamContract(capability);
  if (!contract) {
    throwContractError(
      "sensorium_stream_contract_unknown",
      `No Sensorium stream contract is defined for ${capability ?? "(missing)"}`,
    );
  }
  if (!isPlainObject(summary)) {
    throwContractError(
      "sensorium_stream_summary_invalid",
      "Sensorium stream summary must be an object",
    );
  }

  const allowed = new Set(contract.allowed_summary_fields);
  const excluded = new Set(contract.excluded_fields);
  const errors = [];

  for (const key of Object.keys(summary)) {
    if (excluded.has(key) || !allowed.has(key)) {
      errors.push(`summary.${key} is not allowed for ${capability}`);
    }
  }

  if (!Number.isInteger(summary.schema_version)) {
    errors.push("summary.schema_version must be an integer");
  }
  if (
    "frame_number" in summary &&
    (!Number.isInteger(summary.frame_number) || summary.frame_number < 0)
  ) {
    errors.push("summary.frame_number must be a non-negative integer");
  }
  if (
    "width" in summary &&
    (!Number.isInteger(summary.width) || summary.width <= 0)
  ) {
    errors.push("summary.width must be a positive integer");
  }
  if (
    "height" in summary &&
    (!Number.isInteger(summary.height) || summary.height <= 0)
  ) {
    errors.push("summary.height must be a positive integer");
  }
  if (
    "format" in summary &&
    !contract.allowed_formats.includes(summary.format)
  ) {
    errors.push(`summary.format must be one of: ${contract.allowed_formats.join(", ")}`);
  }
  if (
    "payload_size" in summary &&
    (!Number.isInteger(summary.payload_size) || summary.payload_size < 0)
  ) {
    errors.push("summary.payload_size must be a non-negative integer");
  }

  if (errors.length > 0) {
    throwContractError(
      "sensorium_stream_summary_contract_violation",
      `Sensorium stream summary violates contract: ${errors.join("; ")}`,
      errors,
    );
  }

  return copyAllowedSummary(summary, contract);
}

function copyAllowedSummary(summary, contract) {
  const out = {};
  for (const key of contract.allowed_summary_fields) {
    if (summary[key] !== undefined && summary[key] !== null) {
      out[key] = summary[key];
    }
  }
  return out;
}

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwContractError(code, message, validationErrors = []) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 400;
  error.validation_errors = validationErrors;
  throw error;
}

export const SENSORIUM_COLOR_STREAM_CONTRACT = Object.freeze(
  getSensoriumStreamContract("perception.sensorium.color.subscribe"),
);

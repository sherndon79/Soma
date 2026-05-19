const VISUAL_ATTACH_CAPABILITY_PREFIX = "model.context.visual.";
const VISUAL_ATTACH_CAPABILITY_SUFFIX = ".attach";

const ALLOWED_TOP_LEVEL_FIELDS = new Set([
  "capability",
  "grant_id",
  "source_subscription_ids",
  "source_capabilities",
  "source_provider",
  "source_topic",
  "source_grant_id",
  "model_target",
  "payload_type",
  "max_frame_count",
  "max_frame_age_ms",
  "transformed_dimensions",
  "format_required",
  "preview_acknowledged",
  "retention_mode",
]);

const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "data",
  "payload",
  "payload_bytes",
  "bytes",
  "image_bytes",
  "depth_bytes",
  "raw_bytes",
  "raw_depth",
  "frame_bytes",
  "screenshot",
  "point_cloud",
  "mesh",
  "scene_description",
  "ocr_text",
  "prompt",
  "messages",
  "model_response",
  "training_record",
]);

export function validateModelVisualAttachRequest(body = {}, { grants = [] } = {}) {
  const errors = [];

  if (!isPlainObject(body)) {
    throwModelVisualAttachRequestError(["request body must be an object"]);
  }

  for (const key of Object.keys(body)) {
    if (!ALLOWED_TOP_LEVEL_FIELDS.has(key)) {
      errors.push(`unexpected field ${key}`);
    }
  }
  validatePayloadFree("request", body, errors);

  const request = {
    capability: stringValue(body.capability),
    grant_id: stringValue(body.grant_id),
    source_subscription_ids: normalizeStringList(body.source_subscription_ids),
    source_capabilities: normalizeStringList(body.source_capabilities),
    source_provider: stringValue(body.source_provider),
    source_topic: stringValue(body.source_topic),
    source_grant_id: stringValue(body.source_grant_id),
    model_target: stringValue(body.model_target),
    payload_type: stringValue(body.payload_type),
    max_frame_count: body.max_frame_count,
    max_frame_age_ms: body.max_frame_age_ms,
    transformed_dimensions: Array.isArray(body.transformed_dimensions)
      ? [...body.transformed_dimensions]
      : [],
    format_required: stringValue(body.format_required),
    preview_acknowledged: body.preview_acknowledged,
    retention_mode: stringValue(body.retention_mode),
  };

  validateRequestShape(request, errors);

  const grant = findActiveGrant(grants, request.grant_id);
  if (!grant) {
    errors.push("an active model visual attach grant is required");
  } else {
    validateGrantAuthority({ request, grant, errors });
  }

  if (errors.length > 0) {
    throwModelVisualAttachRequestError(errors);
  }

  return {
    ...request,
    grant_id: grant.id,
    provider: grant.provider,
    scope: grant.scope,
    activation_performed: false,
    subscription_activated: false,
    model_delivery_performed: false,
    payload_attached: false,
    payload_bytes_included: false,
  };
}

function validateRequestShape(request, errors) {
  if (!isModelVisualAttachCapability(request.capability)) {
    errors.push("capability must be a model-facing visual attach capability");
  }
  if (!request.grant_id) {
    errors.push("grant_id is required");
  }
  if (request.source_subscription_ids.length === 0) {
    errors.push("source_subscription_ids must include at least one source subscription");
  }
  if (request.source_capabilities.length === 0) {
    errors.push("source_capabilities must include at least one source capability");
  }
  for (const field of ["source_provider", "source_topic", "source_grant_id", "model_target", "payload_type", "format_required"]) {
    if (!request[field]) {
      errors.push(`${field} is required`);
    }
  }
  if (request.preview_acknowledged !== true) {
    errors.push("preview_acknowledged must be true");
  }
  if (request.retention_mode !== "none") {
    errors.push("retention_mode must be none");
  }
  if (request.max_frame_count !== 1) {
    errors.push("max_frame_count must be 1");
  }
  if (!Number.isInteger(request.max_frame_age_ms) || request.max_frame_age_ms < 1) {
    errors.push("max_frame_age_ms must be a positive integer");
  }
  if (!validDimensions(request.transformed_dimensions)) {
    errors.push("transformed_dimensions must be [width,height] positive integers");
  }
}

function validateGrantAuthority({ request, grant, errors }) {
  if (!isModelVisualAttachCapability(grant.capability)) {
    errors.push("grant_id must reference a model visual attach grant");
    return;
  }
  if (grant.capability !== request.capability) {
    errors.push("request capability must match grant capability");
  }
  if (grant.scope !== "once") {
    errors.push("model visual attach grants must have once scope");
  }

  const constraints = isPlainObject(grant.constraints) ? grant.constraints : {};
  if (!sameStringSet(request.source_subscription_ids, normalizeStringList(constraints.source_subscription_ids))) {
    errors.push("source_subscription_ids must match grant constraints");
  }
  if (!sameStringSet(request.source_capabilities, normalizeStringList(constraints.source_capabilities))) {
    errors.push("source_capabilities must match grant constraints");
  }
  for (const field of [
    "source_provider",
    "source_topic",
    "source_grant_id",
    "model_target",
    "payload_type",
    "format_required",
    "retention_mode",
  ]) {
    if (request[field] !== stringValue(constraints[field])) {
      errors.push(`${field} must match grant constraints`);
    }
  }
  if (constraints.preview_acknowledged !== true) {
    errors.push("grant constraints must record preview_acknowledged=true");
  }
  if (request.max_frame_count !== constraints.max_frame_count) {
    errors.push("max_frame_count must match grant constraints");
  }
  if (request.max_frame_age_ms > constraints.max_frame_age_ms) {
    errors.push("max_frame_age_ms must not exceed grant constraints");
  }
  if (!sameDimensions(request.transformed_dimensions, constraints.transformed_dimensions)) {
    errors.push("transformed_dimensions must match grant constraints");
  }
}

function findActiveGrant(grants, grantId) {
  if (!Array.isArray(grants) || !grantId) {
    return null;
  }
  return grants.find((grant) => grant?.id === grantId && grant?.status === "active") ?? null;
}

function validatePayloadFree(label, value, errors) {
  for (const path of forbiddenPayloadPaths(value, label)) {
    errors.push(`${path} is forbidden in model-facing visual attach requests`);
  }
}

function forbiddenPayloadPaths(value, path) {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => forbiddenPayloadPaths(entry, `${path}[${index}]`));
  }
  if (!isPlainObject(value)) {
    return [];
  }
  const paths = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_PAYLOAD_KEYS.has(key)) {
      paths.push(childPath);
    }
    paths.push(...forbiddenPayloadPaths(child, childPath));
  }
  return paths;
}

function isModelVisualAttachCapability(capability) {
  return capability.startsWith(VISUAL_ATTACH_CAPABILITY_PREFIX) &&
    capability.endsWith(VISUAL_ATTACH_CAPABILITY_SUFFIX);
}

function sameStringSet(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((entry) => rightSet.has(entry));
}

function sameDimensions(left, right) {
  return Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === 2 &&
    right.length === 2 &&
    left[0] === right[0] &&
    left[1] === right[1];
}

function validDimensions(value) {
  return Array.isArray(value) &&
    value.length === 2 &&
    value.every((entry) => Number.isInteger(entry) && entry >= 1);
}

function normalizeStringList(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => stringValue(entry))
    .filter(Boolean);
}

function stringValue(value) {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function throwModelVisualAttachRequestError(errors) {
  const error = new Error(`Invalid model visual attach request: ${errors.join("; ")}`);
  error.statusCode = 400;
  error.code = "invalid_model_visual_attach_request";
  error.validation_errors = errors;
  throw error;
}

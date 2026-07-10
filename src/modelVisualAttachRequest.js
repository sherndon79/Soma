const VISUAL_ATTACH_CAPABILITY_PREFIX = "model.context.visual.";
const VISUAL_ATTACH_CAPABILITY_SUFFIX = ".attach";

const ALLOWED_TOP_LEVEL_FIELDS = new Set([
  "capability",
  "grant_id",
  "source_subscription_ids",
  "source_capabilities",
  "source_topics",
  "source_grant_ids",
  "source_provider",
  "source_topic",
  "source_grant_id",
  "model_target",
  "payload_type",
  "max_frame_count",
  "max_frame_age_ms",
  "transformed_dimensions",
  "format_required",
  "depth_representation",
  "pose_representation",
  "composite_representation",
  "max_pairing_skew_ms",
  "preview_artifact_id",
  "preview_acknowledgement_id",
  "preview_acknowledged_by",
  "preview_acknowledged_at",
  "preview_acknowledged",
  "preview_cleanup_required",
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
    source_topics: normalizeStringList(body.source_topics),
    source_grant_ids: normalizeStringList(body.source_grant_ids),
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
    depth_representation: stringValue(body.depth_representation),
    pose_representation: stringValue(body.pose_representation),
    composite_representation: stringValue(body.composite_representation),
    max_pairing_skew_ms: body.max_pairing_skew_ms,
    preview_artifact_id: stringValue(body.preview_artifact_id),
    preview_acknowledgement_id: stringValue(body.preview_acknowledgement_id),
    preview_acknowledged_by: stringValue(body.preview_acknowledged_by),
    preview_acknowledged_at: stringValue(body.preview_acknowledged_at),
    preview_acknowledged: body.preview_acknowledged,
    preview_cleanup_required: body.preview_cleanup_required,
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

  const validated = {
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
  if (!validated.depth_representation) {
    delete validated.depth_representation;
  }
  if (!validated.pose_representation) {
    delete validated.pose_representation;
  }
  if (!validated.composite_representation) {
    delete validated.composite_representation;
  }
  if (!Number.isInteger(validated.max_pairing_skew_ms)) {
    delete validated.max_pairing_skew_ms;
  }
  if (validated.source_topics.length === 0) {
    delete validated.source_topics;
  }
  if (validated.source_grant_ids.length === 0) {
    delete validated.source_grant_ids;
  }
  return validated;
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
  for (const field of ["preview_artifact_id", "preview_acknowledgement_id", "preview_acknowledged_by", "preview_acknowledged_at"]) {
    if (!request[field]) {
      errors.push(`${field} is required`);
    }
  }
  if (request.preview_acknowledged_by !== "user") {
    errors.push("preview_acknowledged_by must be user");
  }
  if (!isIsoTimestamp(request.preview_acknowledged_at)) {
    errors.push("preview_acknowledged_at must be an ISO timestamp");
  }
  if (request.preview_cleanup_required !== true) {
    errors.push("preview_cleanup_required must be true");
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
  if (request.payload_type === "depth" && !["depth_png", "colorized_png"].includes(request.depth_representation)) {
    errors.push("depth_representation must be depth_png or colorized_png for depth payloads");
  }
  if (request.payload_type !== "depth" && request.depth_representation) {
    errors.push("depth_representation is only allowed for depth payloads");
  }
  if (request.payload_type === "pose" && !["pose_msgpack", "pose_json"].includes(request.pose_representation)) {
    errors.push("pose_representation must be pose_msgpack or pose_json for pose payloads");
  }
  if (request.payload_type !== "pose" && request.pose_representation) {
    errors.push("pose_representation is only allowed for pose payloads");
  }
  if (request.payload_type === "composite") {
    if (request.source_subscription_ids.length < 2) {
      errors.push("composite payloads require color and depth source subscriptions");
    }
    for (const capability of ["perception.sensorium.color.subscribe", "perception.sensorium.depth.subscribe"]) {
      if (!request.source_capabilities.includes(capability)) {
        errors.push(`composite source_capabilities must include ${capability}`);
      }
    }
    if (request.source_topics.length < 2) {
      errors.push("composite payloads require source_topics for color and depth");
    }
    if (request.source_grant_ids.length < 2) {
      errors.push("composite payloads require source_grant_ids for color and depth");
    }
    if (request.composite_representation !== "paired_image_blocks") {
      errors.push("composite_representation must be paired_image_blocks for composite payloads");
    }
    if (!Number.isInteger(request.max_pairing_skew_ms) || request.max_pairing_skew_ms < 0) {
      errors.push("max_pairing_skew_ms must be a non-negative integer for composite payloads");
    }
    if (Number.isInteger(request.max_pairing_skew_ms) && request.max_pairing_skew_ms > request.max_frame_age_ms) {
      errors.push("max_pairing_skew_ms must not exceed max_frame_age_ms");
    }
  } else {
    if (request.composite_representation) {
      errors.push("composite_representation is only allowed for composite payloads");
    }
    if (Number.isInteger(request.max_pairing_skew_ms)) {
      errors.push("max_pairing_skew_ms is only allowed for composite payloads");
    }
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
  if (request.payload_type === "composite") {
    if (!sameStringSet(request.source_topics, normalizeStringList(constraints.source_topics))) {
      errors.push("source_topics must match grant constraints");
    }
    if (!sameStringSet(request.source_grant_ids, normalizeStringList(constraints.source_grant_ids))) {
      errors.push("source_grant_ids must match grant constraints");
    }
    if (request.max_pairing_skew_ms !== constraints.max_pairing_skew_ms) {
      errors.push("max_pairing_skew_ms must match grant constraints");
    }
  }
  for (const field of [
    "source_provider",
    "source_topic",
    "source_grant_id",
    "model_target",
    "payload_type",
    "format_required",
    "depth_representation",
    "pose_representation",
    "composite_representation",
    "preview_artifact_id",
    "preview_acknowledgement_id",
    "preview_acknowledged_by",
    "preview_acknowledged_at",
    "retention_mode",
  ]) {
    if (request[field] !== stringValue(constraints[field])) {
      errors.push(`${field} must match grant constraints`);
    }
  }
  if (constraints.preview_acknowledged !== true) {
    errors.push("grant constraints must record preview_acknowledged=true");
  }
  if (constraints.preview_cleanup_required !== true) {
    errors.push("grant constraints must record preview_cleanup_required=true");
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

function isIsoTimestamp(value) {
  const normalized = stringValue(value);
  if (!normalized) {
    return false;
  }
  const timestamp = Date.parse(normalized);
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString() === normalized;
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

const VISUAL_ATTACH_CAPABILITY_PREFIX = "model.context.visual.";
const VISUAL_ATTACH_CAPABILITY_SUFFIX = ".attach";
const PREVIEW_RETENTION_MODE = "ephemeral_preview";
const ACKNOWLEDGEMENT_DECISION = "acknowledged";

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

export function validateModelVisualPreviewArtifactMetadata(body = {}) {
  const errors = [];
  if (!isPlainObject(body)) {
    throwPreviewArtifactError(["preview artifact metadata must be an object"]);
  }
  validatePayloadFree("preview_artifact", body, errors);

  const artifact = {
    preview_artifact_id: stringValue(body.preview_artifact_id),
    capability: stringValue(body.capability),
    source_subscription_ids: normalizeStringList(body.source_subscription_ids),
    source_capabilities: normalizeStringList(body.source_capabilities),
    source_provider: stringValue(body.source_provider),
    source_topic: stringValue(body.source_topic),
    source_grant_id: stringValue(body.source_grant_id),
    model_target: stringValue(body.model_target),
    payload_type: stringValue(body.payload_type),
    frame_count: body.frame_count,
    frame_age_ms: body.frame_age_ms,
    transformed_dimensions: Array.isArray(body.transformed_dimensions)
      ? [...body.transformed_dimensions]
      : [],
    format_required: stringValue(body.format_required),
    depth_units_present: body.depth_units_present === true,
    fused_color_depth: body.fused_color_depth === true,
    preview_rendered: body.preview_rendered,
    retention_mode: stringValue(body.retention_mode),
    cleanup_required: body.cleanup_required,
    cleanup_deadline_ms: body.cleanup_deadline_ms,
    payload_bytes_included: body.payload_bytes_included,
    payload_retained_after_acknowledgement: body.payload_retained_after_acknowledgement,
  };

  validateArtifactShape(artifact, errors);

  if (errors.length > 0) {
    throwPreviewArtifactError(errors);
  }

  return {
    ...artifact,
    model_delivery_performed: false,
    payload_attached: false,
  };
}

export function validateModelVisualPreviewAcknowledgement(body = {}, { artifact } = {}) {
  const errors = [];
  if (!isPlainObject(body)) {
    throwPreviewAcknowledgementError(["preview acknowledgement must be an object"]);
  }
  validatePayloadFree("preview_acknowledgement", body, errors);

  const normalizedArtifact = validateModelVisualPreviewArtifactMetadata(artifact);
  const acknowledgement = {
    acknowledgement_id: stringValue(body.acknowledgement_id),
    preview_artifact_id: stringValue(body.preview_artifact_id),
    decision: stringValue(body.decision),
    acknowledged_by: stringValue(body.acknowledged_by),
    acknowledged_at: stringValue(body.acknowledged_at),
    retention_mode: stringValue(body.retention_mode),
    payload_retained_after_acknowledgement: body.payload_retained_after_acknowledgement,
    cleanup_required: body.cleanup_required,
  };

  if (!acknowledgement.acknowledgement_id) {
    errors.push("acknowledgement_id is required");
  }
  if (acknowledgement.preview_artifact_id !== normalizedArtifact.preview_artifact_id) {
    errors.push("preview_artifact_id must match the preview artifact");
  }
  if (acknowledgement.decision !== ACKNOWLEDGEMENT_DECISION) {
    errors.push("decision must be acknowledged");
  }
  if (acknowledgement.acknowledged_by !== "user") {
    errors.push("acknowledged_by must be user");
  }
  if (!isIsoTimestamp(acknowledgement.acknowledged_at)) {
    errors.push("acknowledged_at must be an ISO timestamp");
  }
  if (acknowledgement.retention_mode !== PREVIEW_RETENTION_MODE) {
    errors.push("retention_mode must be ephemeral_preview");
  }
  if (acknowledgement.payload_retained_after_acknowledgement !== false) {
    errors.push("payload_retained_after_acknowledgement must be false");
  }
  if (acknowledgement.cleanup_required !== true) {
    errors.push("cleanup_required must be true");
  }

  if (errors.length > 0) {
    throwPreviewAcknowledgementError(errors);
  }

  return {
    ...acknowledgement,
    preview_acknowledged: true,
    capability: normalizedArtifact.capability,
    source_subscription_ids: [...normalizedArtifact.source_subscription_ids],
    model_target: normalizedArtifact.model_target,
    payload_type: normalizedArtifact.payload_type,
    transformed_dimensions: [...normalizedArtifact.transformed_dimensions],
    format_required: normalizedArtifact.format_required,
    model_delivery_performed: false,
    payload_attached: false,
    payload_bytes_included: false,
  };
}

function validateArtifactShape(artifact, errors) {
  if (!artifact.preview_artifact_id) {
    errors.push("preview_artifact_id is required");
  }
  if (!isModelVisualAttachCapability(artifact.capability)) {
    errors.push("capability must be a model-facing visual attach capability");
  }
  if (artifact.source_subscription_ids.length === 0) {
    errors.push("source_subscription_ids must include at least one source subscription");
  }
  if (artifact.source_capabilities.length === 0) {
    errors.push("source_capabilities must include at least one source capability");
  }
  for (const field of ["source_provider", "source_topic", "source_grant_id", "model_target", "payload_type", "format_required"]) {
    if (!artifact[field]) {
      errors.push(`${field} is required`);
    }
  }
  if (artifact.frame_count !== 1) {
    errors.push("frame_count must be 1");
  }
  if (!Number.isInteger(artifact.frame_age_ms) || artifact.frame_age_ms < 0) {
    errors.push("frame_age_ms must be a non-negative integer");
  }
  if (!validDimensions(artifact.transformed_dimensions)) {
    errors.push("transformed_dimensions must be [width,height] positive integers");
  }
  if (artifact.preview_rendered !== true) {
    errors.push("preview_rendered must be true before acknowledgement");
  }
  if (artifact.retention_mode !== PREVIEW_RETENTION_MODE) {
    errors.push("retention_mode must be ephemeral_preview");
  }
  if (artifact.cleanup_required !== true) {
    errors.push("cleanup_required must be true");
  }
  if (!Number.isInteger(artifact.cleanup_deadline_ms) || artifact.cleanup_deadline_ms < 1) {
    errors.push("cleanup_deadline_ms must be a positive integer");
  }
  if (artifact.payload_bytes_included !== false) {
    errors.push("payload_bytes_included must be false");
  }
  if (artifact.payload_retained_after_acknowledgement !== false) {
    errors.push("payload_retained_after_acknowledgement must be false");
  }
}

function validatePayloadFree(label, value, errors) {
  for (const path of forbiddenPayloadPaths(value, label)) {
    errors.push(`${path} is forbidden in model visual preview metadata`);
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

function validDimensions(value) {
  return Array.isArray(value) &&
    value.length === 2 &&
    value.every((entry) => Number.isInteger(entry) && entry >= 1);
}

function isIsoTimestamp(value) {
  if (!value) {
    return false;
  }
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString() === value;
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

function throwPreviewArtifactError(errors) {
  const error = new Error(`Invalid model visual preview artifact metadata: ${errors.join("; ")}`);
  error.statusCode = 400;
  error.code = "invalid_model_visual_preview_artifact";
  error.validation_errors = errors;
  throw error;
}

function throwPreviewAcknowledgementError(errors) {
  const error = new Error(`Invalid model visual preview acknowledgement: ${errors.join("; ")}`);
  error.statusCode = 400;
  error.code = "invalid_model_visual_preview_acknowledgement";
  error.validation_errors = errors;
  throw error;
}

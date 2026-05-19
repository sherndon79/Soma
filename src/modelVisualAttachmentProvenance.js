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

export function createModelVisualAttachmentProvenanceSummary({ request } = {}) {
  const errors = [];
  if (!isPlainObject(request)) {
    throwModelVisualAttachmentProvenanceError(["request must be an object"]);
  }
  validatePayloadFree("request", request, errors);
  if (errors.length > 0) {
    throwModelVisualAttachmentProvenanceError(errors);
  }

  return {
    event_type: "model.context.visual.attached",
    capability: stringValue(request.capability),
    provider: stringValue(request.provider),
    scope: stringValue(request.scope),
    grant_id: stringValue(request.grant_id),
    source_subscription_ids: normalizeStringList(request.source_subscription_ids),
    source_capabilities: normalizeStringList(request.source_capabilities),
    source_provider: stringValue(request.source_provider),
    source_topic: stringValue(request.source_topic),
    source_grant_id: stringValue(request.source_grant_id),
    model_target: stringValue(request.model_target),
    payload_type: stringValue(request.payload_type),
    frame_count: numberOrNull(request.max_frame_count),
    max_frame_age_ms: numberOrNull(request.max_frame_age_ms),
    transformed_dimensions: Array.isArray(request.transformed_dimensions)
      ? [...request.transformed_dimensions]
      : [],
    format_required: stringValue(request.format_required),
    preview_artifact_id: stringValue(request.preview_artifact_id),
    preview_acknowledgement_id: stringValue(request.preview_acknowledgement_id),
    preview_acknowledged_by: stringValue(request.preview_acknowledged_by),
    preview_acknowledged_at: stringValue(request.preview_acknowledged_at),
    preview_cleanup_required: request.preview_cleanup_required === true,
    retention_mode: stringValue(request.retention_mode),
    payload_retained: false,
    memory_write_authorized: false,
    payload_bytes_included: false,
    model_delivery_performed: true,
    payload_attached: true,
    visual_memory_written: false,
    training_use_authorized: false,
  };
}

function validatePayloadFree(label, value, errors) {
  for (const path of forbiddenPayloadPaths(value, label)) {
    errors.push(`${path} is forbidden in model visual attachment provenance`);
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

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value.map((entry) => stringValue(entry)).filter(Boolean)
    : [];
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function stringValue(value) {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function throwModelVisualAttachmentProvenanceError(errors) {
  const error = new Error(`Invalid model visual attachment provenance input: ${errors.join("; ")}`);
  error.code = "invalid_model_visual_attachment_provenance";
  error.statusCode = 400;
  error.validation_errors = errors;
  throw error;
}

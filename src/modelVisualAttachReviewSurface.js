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
]);

export function modelVisualAttachProposalReviewText(response = {}) {
  assertNoPayloadFields(response, "response");

  const proposal = response.proposal ?? {};
  const review = response.review ?? response.review_context ?? {};
  const source = review.source ?? {};
  const preview = review.preview ?? {};
  const retention = review.retention ?? {};

  return [
    "Model visual attach proposal",
    `  capability: ${proposal.capability ?? review.capability ?? "unknown"}`,
    `  provider: ${review.provider ?? "unknown"}`,
    `  source: ${source.provider ?? "unknown"} ${source.topic ?? "unknown"}`,
    `  source subscription: ${source.subscription_id ?? joinList(source.subscription_ids)}`,
    `  source grant: ${source.grant_id ?? "unknown"}`,
    `  source capability: ${source.capability ?? joinList(source.capabilities)}`,
    `  model target: ${review.model_target ?? "unknown"}`,
    `  payload: ${review.payload_type ?? "unknown"} ${dimensionsText(review.transformed_dimensions)} ${review.format_required ?? "unknown"}`,
    `  frame bound: count=${review.frame_count ?? "unknown"} max_age_ms=${review.max_frame_age_ms ?? "unknown"}`,
    `  preview: required=${booleanText(preview.required)} available=${booleanText(preview.available)} acknowledgement_required=${booleanText(preview.acknowledgement_required)} acknowledged=${booleanText(preview.acknowledged)}`,
    `  preview acknowledgement: ${previewAcknowledgementText({
      artifactId: preview.artifact_id,
      acknowledgementId: preview.acknowledgement_id,
      actor: preview.acknowledged_by,
      acknowledgedAt: preview.acknowledged_at,
      cleanupRequired: preview.cleanup_required,
    })}`,
    `  retention: mode=${retention.mode ?? "unknown"} payload_retained=${booleanText(retention.payload_retained)} memory_write=${booleanText(retention.memory_write_authorized ?? review.memory_write_authorized)}`,
    `  model boundary: ${review.model_boundary_warning ?? "Visual payload attachment is irreversible inside a model turn."}`,
    "  approval boundary: proposal approval is not preview acknowledgement or model delivery",
    `  activation performed: ${booleanText(response.activation_performed)}`,
    `  subscription activated: ${booleanText(response.subscription_activated)}`,
    `  model delivery performed: ${booleanText(response.model_delivery_performed ?? review.model_delivery_performed)}`,
    `  payload attached: ${booleanText(response.payload_attached ?? review.payload_attached)}`,
    `  payload bytes included: ${booleanText(response.payload_bytes_included ?? review.payload_bytes_included)}`,
  ].join("\n");
}

export function modelVisualAttachGrantCandidateReviewText(response = {}) {
  assertNoPayloadFields(response, "response");

  const grant = response.grant_create_input ?? {};
  const constraints = grant.constraints ?? {};
  const provenance = response.provenance_summary ?? {};

  return [
    "Model visual attach grant candidate",
    `  source proposal: ${response.source_proposal_id ?? provenance.proposal_id ?? "unknown"}`,
    `  capability: ${grant.capability ?? provenance.capability ?? "unknown"}`,
    `  provider: ${grant.provider ?? provenance.provider ?? "unknown"}`,
    `  scope: ${grant.scope ?? provenance.scope ?? "unknown"}`,
    `  source: ${constraints.source_provider ?? provenance.source_provider ?? "unknown"} ${constraints.source_topic ?? provenance.source_topic ?? "unknown"}`,
    `  source subscriptions: ${joinList(constraints.source_subscription_ids ?? provenance.source_subscription_ids)}`,
    `  source capabilities: ${joinList(constraints.source_capabilities ?? provenance.source_capabilities)}`,
    `  source grant: ${constraints.source_grant_id ?? provenance.source_grant_id ?? "unknown"}`,
    `  model target: ${constraints.model_target ?? provenance.model_target ?? "unknown"}`,
    `  payload: ${constraints.payload_type ?? provenance.payload_type ?? "unknown"} ${dimensionsText(constraints.transformed_dimensions ?? provenance.transformed_dimensions)} ${constraints.format_required ?? provenance.format_required ?? "unknown"}`,
    `  frame bound: count=${constraints.max_frame_count ?? provenance.frame_count ?? "unknown"} max_age_ms=${constraints.max_frame_age_ms ?? provenance.max_frame_age_ms ?? "unknown"}`,
    `  preview acknowledged: ${booleanText(constraints.preview_acknowledged ?? provenance.preview_acknowledged)}`,
    `  preview acknowledgement: ${previewAcknowledgementText({
      artifactId: constraints.preview_artifact_id ?? provenance.preview_artifact_id,
      acknowledgementId: constraints.preview_acknowledgement_id ?? provenance.preview_acknowledgement_id,
      actor: constraints.preview_acknowledged_by ?? provenance.preview_acknowledged_by,
      acknowledgedAt: constraints.preview_acknowledged_at ?? provenance.preview_acknowledged_at,
      cleanupRequired: constraints.preview_cleanup_required ?? provenance.preview_cleanup_required,
    })}`,
    `  retention: mode=${constraints.retention_mode ?? provenance.retention_mode ?? "unknown"} payload_retained=${booleanText(provenance.payload_retained)} memory_write=${booleanText(provenance.memory_write_authorized)}`,
    "  model boundary: grant candidate is not model delivery; attachment remains irreversible once implemented",
    `  grant written: ${booleanText(response.grant_written)}`,
    `  subscription activated: ${booleanText(response.subscription_activated)}`,
    `  model delivery performed: ${booleanText(response.model_delivery_performed ?? provenance.model_delivery_performed)}`,
    `  payload attached: ${booleanText(response.payload_attached ?? provenance.payload_attached)}`,
    `  payload bytes included: ${booleanText(response.payload_bytes_included ?? provenance.payload_bytes_included)}`,
  ].join("\n");
}

function assertNoPayloadFields(value, path) {
  const forbidden = forbiddenPayloadPaths(value, path);
  if (forbidden.length === 0) {
    return;
  }
  const error = new Error(`Model visual attach review surface rejects payload fields: ${forbidden.join(", ")}`);
  error.code = "model_visual_attach_review_payload_field";
  error.statusCode = 400;
  error.validation_errors = forbidden;
  throw error;
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

function dimensionsText(value) {
  if (!Array.isArray(value) || value.length !== 2) {
    return "dimensions=unknown";
  }
  return `dimensions=${value[0]}x${value[1]}`;
}

function joinList(value) {
  return Array.isArray(value) && value.length > 0 ? value.join(", ") : "unknown";
}

function previewAcknowledgementText({
  artifactId,
  acknowledgementId,
  actor,
  acknowledgedAt,
  cleanupRequired,
}) {
  return [
    `artifact=${artifactId ?? "unknown"}`,
    `acknowledgement=${acknowledgementId ?? "unknown"}`,
    `actor=${actor ?? "unknown"}`,
    `at=${acknowledgedAt ?? "unknown"}`,
    `cleanup_required=${booleanText(cleanupRequired)}`,
  ].join(" ");
}

function booleanText(value) {
  return value === true ? "yes" : "no";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

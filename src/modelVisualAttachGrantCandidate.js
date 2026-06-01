import { validateGrantCreate } from "./grants.js";

const VISUAL_ATTACH_CAPABILITY_PREFIX = "model.context.visual.";
const VISUAL_ATTACH_CAPABILITY_SUFFIX = ".attach";
const ONCE_SCOPE = "once";

export function buildModelVisualAttachGrantCandidateFromProposal(
  proposal = {},
  {
    catalog = {},
    providerRegistry = {},
    now,
    createId,
  } = {},
) {
  const errors = [];

  if (proposal.type === "capability_design") {
    throwModelVisualAttachGrantCandidateError(
      ["capability design proposals are review-only and cannot create model visual attach grant candidates"],
      "model_visual_attach_grant_candidate_rejects_capability_design",
    );
  }

  if (proposal.status !== "approved" || proposal.decision?.decision !== "approved") {
    errors.push("proposal must be approved before a model visual attach grant candidate can be built");
  }
  if (proposal.decision?.decided_by !== "user") {
    errors.push("proposal approval must be decided by the user");
  }

  const approvalProvenanceId = stringValue(proposal.decision?.provenance_id);
  if (!approvalProvenanceId) {
    errors.push("approved proposal must include approval provenance before grant candidate creation");
  }

  const capability = stringValue(proposal.capability);
  if (!isModelVisualAttachCapability(capability)) {
    errors.push("proposal capability must be a model-facing visual attach capability");
  }

  const review = plainObjectOrNull(proposal.review_context);
  const intent = plainObjectOrNull(proposal.grant_intent);
  if (!review) {
    errors.push("proposal must include model visual review_context");
  }
  if (!intent) {
    errors.push("proposal must include model visual grant_intent");
  }

  if (review && intent) {
    validateReviewAndIntent({
      proposal,
      review,
      intent,
      errors,
    });
  }

  if (errors.length > 0) {
    throwModelVisualAttachGrantCandidateError(errors);
  }

  const constraints = {
    ...intent.constraints,
    source_subscription_ids: [...intent.source_subscription_ids],
    source_capabilities: [...intent.source_capabilities],
    source_provider: review.source.provider,
    source_topic: review.source.topic,
    source_grant_id: review.source.grant_id,
    model_target: intent.model_target,
    payload_type: intent.payload_type,
    preview_artifact_id: intent.preview_artifact_id,
    preview_acknowledgement_id: intent.preview_acknowledgement_id,
    preview_acknowledged_by: intent.preview_acknowledged_by,
    preview_acknowledged_at: intent.preview_acknowledged_at,
    preview_acknowledged: true,
    preview_cleanup_required: true,
    retention_mode: "none",
  };

  const candidate = {
    capability,
    provider: intent.provider,
    scope: ONCE_SCOPE,
    constraints,
    approved_by: "user",
    approval_provenance_id: approvalProvenanceId,
    reason: proposal.reason,
    created_at: now?.(),
    id: createId?.(),
    review_required: false,
    direct_user_action: false,
  };

  try {
    return {
      grant_create_input: validateGrantCreate(candidate, {
        catalog,
        providerRegistry,
        now,
        createId,
      }),
      provenance_summary: buildModelVisualAttachGrantCandidateProvenanceSummary({
        proposal,
        review,
        intent,
        approvalProvenanceId,
      }),
      source_proposal_id: proposal.id ?? "",
      activation_performed: false,
      grant_written: false,
      subscription_activated: false,
      model_delivery_performed: false,
      payload_attached: false,
      payload_bytes_included: false,
    };
  } catch (error) {
    if (error?.code) {
      throwModelVisualAttachGrantCandidateError([error.message], error.code);
    }
    throw error;
  }
}

export function buildModelVisualAttachGrantCandidateProvenanceSummary({
  proposal = {},
  review = {},
  intent = {},
  approvalProvenanceId = "",
} = {}) {
  return {
    event_type: "model.context.visual.grant_candidate_built",
    proposal_id: stringValue(proposal.id),
    capability: stringValue(proposal.capability),
    provider: stringValue(intent.provider),
    scope: stringValue(intent.scope),
    source_subscription_ids: normalizeStringList(intent.source_subscription_ids),
    source_capabilities: normalizeStringList(intent.source_capabilities),
    source_provider: stringValue(review.source?.provider),
    source_topic: stringValue(review.source?.topic),
    source_grant_id: stringValue(review.source?.grant_id),
    model_target: stringValue(intent.model_target),
    payload_type: stringValue(intent.payload_type),
    preview_artifact_id: stringValue(intent.preview_artifact_id),
    preview_acknowledgement_id: stringValue(intent.preview_acknowledgement_id),
    preview_acknowledged_by: stringValue(intent.preview_acknowledged_by),
    preview_acknowledged_at: stringValue(intent.preview_acknowledged_at),
    frame_count: review.frame_count ?? null,
    max_frame_age_ms: review.max_frame_age_ms ?? null,
    transformed_dimensions: Array.isArray(review.transformed_dimensions)
      ? [...review.transformed_dimensions]
      : [],
    format_required: stringValue(review.format_required),
    preview_acknowledged: review.preview?.acknowledged === true,
    retention_mode: stringValue(review.retention?.mode),
    payload_retained: review.retention?.payload_retained === true,
    memory_write_authorized: review.memory_write_authorized === true,
    approval_provenance_id: stringValue(approvalProvenanceId),
    payload_bytes_included: false,
    model_delivery_performed: false,
    payload_attached: false,
  };
}

function validateReviewAndIntent({ proposal, review, intent, errors }) {
  if (intent.capability !== proposal.capability || review.capability !== proposal.capability) {
    errors.push("review_context and grant_intent must match proposal capability");
  }
  if (intent.provider !== review.provider) {
    errors.push("review_context and grant_intent must match provider");
  }
  if (intent.scope !== ONCE_SCOPE || review.scope !== ONCE_SCOPE) {
    errors.push("model visual attach grant candidates currently require once scope");
  }
  if (proposal.requested_scope !== ONCE_SCOPE) {
    errors.push("approved proposal must have requested_scope=once");
  }
  if (!plainObjectOrNull(intent.constraints)) {
    errors.push("grant_intent.constraints must be an object");
  }
  if (!Array.isArray(intent.source_subscription_ids) || intent.source_subscription_ids.length === 0) {
    errors.push("grant_intent.source_subscription_ids must include at least one source subscription");
  }
  if (!Array.isArray(intent.source_capabilities) || intent.source_capabilities.length === 0) {
    errors.push("grant_intent.source_capabilities must include at least one source capability");
  }
  if (!plainObjectOrNull(review.source)) {
    errors.push("review_context.source is required");
  }
  if (review.model_target !== intent.model_target) {
    errors.push("review_context and grant_intent must match model_target");
  }
  if (review.payload_type !== intent.payload_type) {
    errors.push("review_context and grant_intent must match payload_type");
  }
  if (review.preview?.required !== true || review.preview?.available !== true) {
    errors.push("review_context.preview must be required and available");
  }
  if (review.preview?.acknowledgement_required !== true) {
    errors.push("review_context.preview.acknowledgement_required must be true");
  }
  if (review.preview?.acknowledged !== true) {
    errors.push("review_context.preview.acknowledged must be true before candidate creation");
  }
  if (intent.preview_required !== true) {
    errors.push("grant_intent.preview_required must be true");
  }
  if (!stringValue(intent.preview_artifact_id) || review.preview?.artifact_id !== intent.preview_artifact_id) {
    errors.push("review_context.preview.artifact_id must match grant_intent.preview_artifact_id");
  }
  if (!stringValue(intent.preview_acknowledgement_id) || review.preview?.acknowledgement_id !== intent.preview_acknowledgement_id) {
    errors.push("review_context.preview.acknowledgement_id must match grant_intent.preview_acknowledgement_id");
  }
  if (intent.preview_acknowledged_by !== "user" || review.preview?.acknowledged_by !== "user") {
    errors.push("preview acknowledgement must be by user");
  }
  if (!isIsoTimestamp(intent.preview_acknowledged_at) || review.preview?.acknowledged_at !== intent.preview_acknowledged_at) {
    errors.push("review_context.preview.acknowledged_at must match grant_intent.preview_acknowledged_at");
  }
  if (review.preview?.cleanup_required !== true || intent.preview_cleanup_required !== true) {
    errors.push("preview cleanup_required must be true");
  }
  if (review.retention?.mode !== "none" || intent.retention_mode !== "none") {
    errors.push("review_context and grant_intent retention_mode must be none");
  }
  if (review.retention?.payload_retained !== false) {
    errors.push("review_context.retention.payload_retained must be false");
  }
  if (review.memory_write_authorized !== false || review.retention?.memory_write_authorized !== false) {
    errors.push("memory_write_authorized must remain false");
  }
  if (review.model_delivery_performed !== false || intent.model_delivery_performed !== false) {
    errors.push("model_delivery_performed must remain false");
  }
  if (review.payload_attached !== false) {
    errors.push("review_context.payload_attached must remain false");
  }
  if (review.payload_bytes_included !== false) {
    errors.push("review_context.payload_bytes_included must remain false");
  }
  if (proposal.activation_performed === true || intent.activation_performed === true) {
    errors.push("activation_performed must remain false");
  }

  validateSourceIdentity({ review, intent, errors });
  validatePayloadFree("review_context", review, errors);
  validatePayloadFree("grant_intent", intent, errors);
}

function validateSourceIdentity({ review, intent, errors }) {
  const source = review.source ?? {};
  const reviewSubscriptionIds = normalizeStringList(source.subscription_ids);
  const intentSubscriptionIds = normalizeStringList(intent.source_subscription_ids);
  const reviewCapabilities = normalizeStringList(source.capabilities);
  const intentCapabilities = normalizeStringList(intent.source_capabilities);

  if (source.subscription_id && !reviewSubscriptionIds.includes(source.subscription_id)) {
    reviewSubscriptionIds.unshift(stringValue(source.subscription_id));
  }
  if (source.capability && !reviewCapabilities.includes(source.capability)) {
    reviewCapabilities.unshift(stringValue(source.capability));
  }
  if (!sameStringSet(reviewSubscriptionIds, intentSubscriptionIds)) {
    errors.push("review_context.source.subscription_ids must match grant_intent.source_subscription_ids");
  }
  if (!sameStringSet(reviewCapabilities, intentCapabilities)) {
    errors.push("review_context.source.capabilities must match grant_intent.source_capabilities");
  }
  if (!stringValue(source.provider)) {
    errors.push("review_context.source.provider is required");
  }
  if (!stringValue(source.topic)) {
    errors.push("review_context.source.topic is required");
  }
  if (!stringValue(source.grant_id)) {
    errors.push("review_context.source.grant_id is required");
  }
}

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

function validatePayloadFree(label, value, errors) {
  for (const path of forbiddenPayloadPaths(value, label)) {
    errors.push(`${path} is forbidden in model-facing visual grant candidates`);
  }
}

function forbiddenPayloadPaths(value, path) {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => forbiddenPayloadPaths(entry, `${path}[${index}]`));
  }
  if (!plainObjectOrNull(value)) {
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

function normalizeStringList(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => stringValue(entry))
    .filter(Boolean);
}

function plainObjectOrNull(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
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

function throwModelVisualAttachGrantCandidateError(
  errors,
  code = "invalid_model_visual_attach_grant_candidate",
) {
  const error = new Error(`Invalid model visual attach grant candidate: ${errors.join("; ")}`);
  error.statusCode = 400;
  error.code = code;
  error.validation_errors = errors;
  throw error;
}

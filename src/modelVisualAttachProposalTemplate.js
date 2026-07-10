const VISUAL_ATTACH_CAPABILITIES = {
  "model.context.visual.color.attach": {
    payload_type: "color",
    sequence: false,
    source_capabilities: ["perception.sensorium.color.subscribe"],
    format_required: "jpeg",
  },
  "model.context.visual.depth.attach": {
    payload_type: "depth",
    sequence: false,
    source_capabilities: ["perception.sensorium.depth.subscribe"],
    format_required: "png",
  },
  "model.context.visual.composite.attach": {
    payload_type: "composite",
    sequence: false,
    source_capabilities: [
      "perception.sensorium.color.subscribe",
      "perception.sensorium.depth.subscribe",
    ],
    format_required: "composite",
  },
  "model.context.visual.pose.attach": {
    payload_type: "pose",
    sequence: false,
    source_capabilities: ["perception.sensorium.pose.subscribe"],
    format_required: "msgpack",
  },
  "model.context.visual.color.sequence.attach": {
    payload_type: "color_sequence",
    base_payload_type: "color",
    sequence: true,
    source_capabilities: ["perception.sensorium.color.subscribe"],
    format_required: "jpeg_sequence",
    budget_unit: "frames",
    client_attachment_unit: "image_blocks",
  },
  "model.context.visual.depth.sequence.attach": {
    payload_type: "depth_sequence",
    base_payload_type: "depth",
    sequence: true,
    source_capabilities: ["perception.sensorium.depth.subscribe"],
    format_required: "png_sequence",
    budget_unit: "frames",
    client_attachment_unit: "image_blocks",
  },
  "model.context.visual.pose.sequence.attach": {
    payload_type: "pose_sequence",
    base_payload_type: "pose",
    sequence: true,
    source_capabilities: ["perception.sensorium.pose.subscribe"],
    format_required: "json_sequence",
    budget_unit: "frames",
    client_attachment_unit: "json_payloads",
  },
  "model.context.visual.composite.sequence.attach": {
    payload_type: "composite_sequence",
    base_payload_type: "composite",
    sequence: true,
    source_capabilities: [
      "perception.sensorium.color.subscribe",
      "perception.sensorium.depth.subscribe",
    ],
    format_required: "composite_sequence",
    budget_unit: "pairs",
    client_attachment_unit: "image_blocks",
  },
};

const ONCE_SCOPE = "once";
const WINDOW_SCOPE = "window";
const DEFAULT_REQUESTED_BY = "assistant";
const DEFAULT_FALLBACK = "Continue without visual model context for this turn.";
const DEFAULT_FRAME_COUNT = 1;
const MAX_FRAME_AGE_MS = 60_000;
const MAX_DIMENSION = 1920;

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

export function buildModelVisualAttachProposalTemplate({
  capability = "",
  provider = "",
  source_subscription_id = "",
  source_subscription_ids = [],
  source_capability = "",
  source_capabilities = [],
  source_provider = "",
  source_topic = "",
  source_grant_id = "",
  source_summary = {},
  model_target = "",
  preview = {},
  retention = {},
  constraints = {},
  requested_by = DEFAULT_REQUESTED_BY,
  requested_scope = ONCE_SCOPE,
  reason = "",
  fallback = DEFAULT_FALLBACK,
  catalog = {},
  providerRegistry = {},
} = {}) {
  const errors = [];
  const capabilityKey = stringValue(capability);
  const providerId = stringValue(provider);
  const requestedBy = stringValue(requested_by) || DEFAULT_REQUESTED_BY;
  const scope = stringValue(requested_scope);
  const normalizedReason = stringValue(reason);
  const normalizedFallback = stringValue(fallback) || DEFAULT_FALLBACK;
  const modelTarget = stringValue(model_target);
  const visualDefinition = VISUAL_ATTACH_CAPABILITIES[capabilityKey];

  if (!visualDefinition) {
    errors.push(`capability "${capabilityKey || "(missing)"}" is not a recognized model-facing visual attach capability`);
  }
  const allowedTemplateScopes = visualDefinition?.sequence === true
    ? [WINDOW_SCOPE]
    : [ONCE_SCOPE, WINDOW_SCOPE];
  if (!allowedTemplateScopes.includes(scope)) {
    errors.push(`model-facing visual attach proposal templates currently require requested_scope=${allowedTemplateScopes.join(" or ")}`);
  }
  if (!normalizedReason) {
    errors.push("reason is required");
  }
  if (!modelTarget) {
    errors.push("model_target is required");
  }

  const capabilityDefinition = findCapability(catalog, capabilityKey);
  if (!capabilityDefinition) {
    errors.push(`capability "${capabilityKey || "(missing)"}" is not present in the capability catalog`);
  } else {
    if (capabilityDefinition.activation_policy !== "explicit_grant") {
      errors.push(`capability "${capabilityKey}" must use activation_policy=explicit_grant`);
    }
    if (
      Array.isArray(capabilityDefinition.allowed_scopes) &&
      capabilityDefinition.allowed_scopes.length > 0 &&
      !capabilityDefinition.allowed_scopes.includes(scope)
    ) {
      errors.push(`capability "${capabilityKey}" does not allow requested_scope=${scope}`);
    }
  }

  const providerDefinition = findProvider(providerRegistry, providerId);
  if (!providerDefinition) {
    errors.push(`provider "${providerId || "(missing)"}" is not present in the provider registry`);
  } else if (!providerSupportsCapability(providerDefinition, capabilityKey)) {
    errors.push(`provider "${providerId}" does not support ${capabilityKey}`);
  }

  const normalizedSource = normalizeSource({
    source_subscription_id,
    source_subscription_ids,
    source_capability,
    source_capabilities,
  });
  if (visualDefinition) {
    validateSource(normalizedSource, visualDefinition, errors);
  }
  if (!stringValue(source_provider)) {
    errors.push("source_provider is required");
  }
  if (!stringValue(source_topic)) {
    errors.push("source_topic is required");
  }
  if (!stringValue(source_grant_id)) {
    errors.push("source_grant_id is required");
  }

  const normalizedConstraints = validateConstraints(constraints, visualDefinition, errors);
  const normalizedPreview = validatePreview(preview, errors);
  const normalizedRetention = validateRetention(retention, errors);
  validatePayloadFree("source_summary", source_summary, errors);
  validatePayloadFree("preview", preview, errors);

  if (errors.length > 0) {
    throwModelVisualAttachProposalTemplateError(errors);
  }

  const payloadType = visualDefinition.payload_type;
  const activeDisclosure = [
    `model visual context: ${payloadType}`,
    `source ${source_provider} ${source_topic}`,
    `model target ${modelTarget}`,
    "preview required",
    "retention none",
  ].join(", ");

  return {
    type: "model_visual_attach_proposal_template",
    proposal: {
      requested_by: requestedBy,
      capability: capabilityKey,
      reason: normalizedReason,
      requested_scope: scope,
      data_exposed: [...(capabilityDefinition.data_exposed ?? [])],
      excluded_data: [...(capabilityDefinition.excluded_by_default ?? [])],
      risk: `One-shot ${payloadType} visual attachment to ${modelTarget}; visual payload delivery is irreversible inside a model turn.`,
      fallback: normalizedFallback,
    },
    review: {
      capability: capabilityKey,
      provider: providerId,
      risk_class: capabilityDefinition.risk_class ?? "unknown",
      scope,
      source: {
        subscription_id: normalizedSource.subscription_ids[0] ?? "",
        subscription_ids: [...normalizedSource.subscription_ids],
        capability: normalizedSource.capabilities[0] ?? "",
        capabilities: [...normalizedSource.capabilities],
        provider: stringValue(source_provider),
        topic: stringValue(source_topic),
        grant_id: stringValue(source_grant_id),
      },
      model_target: modelTarget,
      payload_type: payloadType,
      frame_count: normalizedConstraints.max_frame_count,
      max_frame_age_ms: normalizedConstraints.max_frame_age_ms,
      transformed_dimensions: [...normalizedConstraints.transformed_dimensions],
      format_required: normalizedConstraints.format_required,
      preview: normalizedPreview,
      retention: normalizedRetention,
      memory_write_authorized: false,
      model_delivery_performed: false,
      payload_attached: false,
      payload_bytes_included: false,
      bridge_state: visualDefinition.sequence === true,
      budget_unit: normalizedConstraints.budget_unit,
      client_attachment_unit: normalizedConstraints.client_attachment_unit,
      active_disclosure: activeDisclosure,
      model_boundary_warning:
        "Visual payloads can be withheld before delivery, but cannot be removed from a model turn after attachment.",
      provenance_posture:
        "Record visual delivery intent, source identifiers, model target, preview posture, constraints, and retention mode only; never record image or depth bytes.",
    },
    grant_intent: {
      capability: capabilityKey,
      provider: providerId,
      scope,
      source_subscription_ids: [...normalizedSource.subscription_ids],
      source_capabilities: [...normalizedSource.capabilities],
      model_target: modelTarget,
      payload_type: payloadType,
      constraints: normalizedConstraints,
      preview_required: true,
      retention_mode: "none",
      reason: normalizedReason,
      activation_performed: false,
      model_delivery_performed: false,
    },
    activation_performed: false,
    model_delivery_performed: false,
    subscription_activated: false,
    payload_attached: false,
    payload_bytes_included: false,
    durable: false,
    writable: false,
  };
}

function normalizeSource({
  source_subscription_id,
  source_subscription_ids,
  source_capability,
  source_capabilities,
}) {
  const subscriptionIds = normalizeStringList(source_subscription_ids);
  const capabilities = normalizeStringList(source_capabilities);
  const singleSubscriptionId = stringValue(source_subscription_id);
  const singleCapability = stringValue(source_capability);

  if (singleSubscriptionId) {
    subscriptionIds.unshift(singleSubscriptionId);
  }
  if (singleCapability) {
    capabilities.unshift(singleCapability);
  }

  return {
    subscription_ids: [...new Set(subscriptionIds)],
    capabilities: [...new Set(capabilities)],
  };
}

function validateSource(source, visualDefinition, errors) {
  const expectedSourceCount = visualDefinition.source_capabilities.length;
  if (source.subscription_ids.length < expectedSourceCount) {
    errors.push(expectedSourceCount === 1
      ? "source_subscription_id is required"
      : "source_subscription_ids must include color and depth subscriptions");
  }
  for (const expected of visualDefinition.source_capabilities) {
    if (!source.capabilities.includes(expected)) {
      errors.push(`source_capabilities must include ${expected}`);
    }
  }
}

function validateConstraints(constraints, visualDefinition, errors) {
  if (!isPlainObject(constraints)) {
    errors.push("constraints must be an object");
    return {};
  }

  const maxFrameCount = constraints.max_frame_count;
  if (visualDefinition?.sequence === true) {
    if (!Number.isInteger(maxFrameCount) || maxFrameCount < 1) {
      errors.push("constraints.max_frame_count must be a positive integer for sequence attachments");
    }
  } else if (maxFrameCount !== DEFAULT_FRAME_COUNT) {
    errors.push("constraints.max_frame_count must be 1 for the scaffold");
  }

  const maxFrameAgeMs = constraints.max_frame_age_ms;
  if (!Number.isInteger(maxFrameAgeMs) || maxFrameAgeMs < 1 || maxFrameAgeMs > MAX_FRAME_AGE_MS) {
    errors.push(`constraints.max_frame_age_ms must be an integer from 1 to ${MAX_FRAME_AGE_MS}`);
  }

  const transformedDimensions = constraints.transformed_dimensions;
  if (!validDimensions(transformedDimensions)) {
    errors.push(`constraints.transformed_dimensions must be [width,height] integers from 1 to ${MAX_DIMENSION}`);
  }

  const formatRequired = stringValue(constraints.format_required);
  if (visualDefinition && formatRequired !== visualDefinition.format_required) {
    errors.push(`constraints.format_required must be ${visualDefinition.format_required}`);
  }
  const basePayloadType = visualDefinition?.base_payload_type ?? visualDefinition?.payload_type;
  const depthRepresentation = stringValue(constraints.depth_representation) || "depth_png";
  if (basePayloadType === "depth" && !["depth_png", "colorized_png"].includes(depthRepresentation)) {
    errors.push("constraints.depth_representation must be depth_png or colorized_png");
  }
  const poseRepresentation = stringValue(constraints.pose_representation) || "pose_msgpack";
  if (basePayloadType === "pose" && !["pose_msgpack", "pose_json"].includes(poseRepresentation)) {
    errors.push("constraints.pose_representation must be pose_msgpack or pose_json");
  }
  const compositeRepresentation = stringValue(constraints.composite_representation) || "paired_image_blocks";
  if (basePayloadType === "composite" && compositeRepresentation !== "paired_image_blocks") {
    errors.push("constraints.composite_representation must be paired_image_blocks");
  }
  const maxPairingSkewMs = constraints.max_pairing_skew_ms;
  if (
    basePayloadType === "composite" &&
    (!Number.isInteger(maxPairingSkewMs) || maxPairingSkewMs < 0 || maxPairingSkewMs > maxFrameAgeMs)
  ) {
    errors.push("constraints.max_pairing_skew_ms must be an integer from 0 to max_frame_age_ms");
  }
  const effectiveSamplingFps = constraints.effective_sampling_fps;
  const burstMaxFrames = constraints.burst_max_frames;
  const burstSpanMs = constraints.burst_span_ms;
  const burstDownsample = constraints.burst_downsample;
  const windowFrameBudget = constraints.window_frame_budget;
  if (visualDefinition?.sequence === true) {
    if (!Number.isInteger(effectiveSamplingFps) || effectiveSamplingFps < 1) {
      errors.push("constraints.effective_sampling_fps must be a positive integer for sequence attachments");
    }
    if (!Number.isInteger(burstMaxFrames) || burstMaxFrames < 1) {
      errors.push("constraints.burst_max_frames must be a positive integer for sequence attachments");
    }
    if (Number.isInteger(maxFrameCount) && Number.isInteger(burstMaxFrames) && maxFrameCount !== burstMaxFrames) {
      errors.push("constraints.max_frame_count must match burst_max_frames for sequence attachments");
    }
    if (!Number.isInteger(burstSpanMs) || burstSpanMs < 1) {
      errors.push("constraints.burst_span_ms must be a positive integer for sequence attachments");
    }
    if (!validDimensions(burstDownsample)) {
      errors.push(`constraints.burst_downsample must be [width,height] integers from 1 to ${MAX_DIMENSION}`);
    }
    if (windowFrameBudget !== null && windowFrameBudget !== undefined &&
      (!Number.isInteger(windowFrameBudget) || windowFrameBudget < burstMaxFrames)) {
      errors.push("constraints.window_frame_budget must be null or an integer at least burst_max_frames");
    }
  } else if (windowFrameBudget !== null && windowFrameBudget !== undefined &&
    (!Number.isInteger(windowFrameBudget) || windowFrameBudget < 1)) {
    errors.push("constraints.window_frame_budget must be null or a positive integer");
  }

  return {
    max_frame_count: maxFrameCount,
    max_frame_age_ms: maxFrameAgeMs,
    transformed_dimensions: Array.isArray(transformedDimensions) ? [...transformedDimensions] : [],
    format_required: formatRequired,
    ...(basePayloadType === "depth"
      ? { depth_representation: depthRepresentation }
      : {}),
    ...(basePayloadType === "pose"
      ? { pose_representation: poseRepresentation }
      : {}),
    ...(basePayloadType === "composite"
      ? {
        composite_representation: compositeRepresentation,
        max_pairing_skew_ms: maxPairingSkewMs,
      }
      : {}),
    ...(visualDefinition?.sequence === true
      ? {
        effective_sampling_fps: effectiveSamplingFps,
        burst_max_frames: burstMaxFrames,
        burst_span_ms: burstSpanMs,
        burst_downsample: Array.isArray(burstDownsample) ? [...burstDownsample] : [],
        window_frame_budget: windowFrameBudget ?? null,
        budget_unit: visualDefinition.budget_unit,
        client_attachment_unit: visualDefinition.client_attachment_unit,
      }
      : {}),
    ...(visualDefinition?.sequence !== true && Number.isInteger(windowFrameBudget)
      ? { window_frame_budget: windowFrameBudget }
      : {}),
  };
}

function validatePreview(preview, errors) {
  if (!isPlainObject(preview)) {
    errors.push("preview must be an object");
    return {};
  }
  if (preview.required !== true) {
    errors.push("preview.required must be true");
  }
  if (preview.available !== true) {
    errors.push("preview.available must be true");
  }
  if (preview.acknowledgement_required !== true) {
    errors.push("preview.acknowledgement_required must be true");
  }
  return {
    required: true,
    available: true,
    acknowledgement_required: true,
    acknowledged: false,
  };
}

function validateRetention(retention, errors) {
  if (!isPlainObject(retention)) {
    errors.push("retention must be an object");
    return {};
  }
  if (retention.mode !== "none") {
    errors.push("retention.mode must be none");
  }
  if (retention.payload_retained !== false) {
    errors.push("retention.payload_retained must be false");
  }
  return {
    mode: "none",
    payload_retained: false,
    memory_write_authorized: false,
  };
}

function validatePayloadFree(label, value, errors) {
  for (const path of forbiddenPayloadPaths(value, label)) {
    errors.push(`${path} is forbidden in model-facing visual proposal templates`);
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

function validDimensions(value) {
  return Array.isArray(value) &&
    value.length === 2 &&
    value.every((entry) => Number.isInteger(entry) && entry >= 1 && entry <= MAX_DIMENSION);
}

function findCapability(catalog = {}, key = "") {
  const capabilities = Array.isArray(catalog.capabilities) ? catalog.capabilities : [];
  return capabilities.find((entry) => entry.key === key) ?? null;
}

function findProvider(providerRegistry = {}, providerId = "") {
  const providers = Array.isArray(providerRegistry.providers) ? providerRegistry.providers : [];
  return providers.find((entry) => entry.id === providerId) ?? null;
}

function providerSupportsCapability(provider = {}, capability = "") {
  const capabilities = Array.isArray(provider.capabilities) ? provider.capabilities : [];
  return capabilities.some((entry) => {
    if (typeof entry === "string") {
      return entry === capability;
    }
    return entry?.key === capability;
  });
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

function throwModelVisualAttachProposalTemplateError(errors) {
  const error = new Error(`Invalid model-facing visual attach proposal template: ${errors.join("; ")}`);
  error.statusCode = 400;
  error.code = "invalid_model_visual_attach_proposal_template";
  error.validation_errors = errors;
  throw error;
}

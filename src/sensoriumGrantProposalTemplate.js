import { validateSensoriumSubscriptionRequest } from "./sensoriumSubscriptionRequest.js";

const SENSORIUM_CAPABILITIES = {
  "perception.sensorium.color.subscribe": {
    stream_type: "color",
    required_constraints: ["max_seconds", "max_fps", "format_required", "downsample_to"],
  },
  "perception.sensorium.depth.subscribe": {
    stream_type: "depth",
    required_constraints: ["max_seconds", "max_fps", "format_required", "downsample_to"],
  },
  "perception.sensorium.presence.subscribe": {
    stream_type: "presence",
    required_constraints: ["max_seconds", "max_fps"],
  },
  "perception.sensorium.pose.subscribe": {
    stream_type: "pose",
    required_constraints: ["max_seconds", "max_fps"],
  },
  "perception.sensorium.imu.subscribe": {
    stream_type: "imu",
    required_constraints: ["max_seconds"],
  },
  "perception.sensorium.location.subscribe": {
    stream_type: "location",
    required_constraints: ["max_seconds"],
  },
  "perception.sensorium.status.subscribe": {
    stream_type: "status",
    required_constraints: ["max_seconds"],
  },
};

const SESSION_SCOPE = "session";
const DEFAULT_REQUESTED_BY = "assistant";
const DEFAULT_FALLBACK = "Continue without Sensorium perception for this task.";
const NO_PAYLOAD_RECORDING = "Frame payloads, coordinates, and raw samples are not recorded by default.";
const PROVENANCE_POSTURE =
  "Record lifecycle metadata, provider/topic identity, constraints, and aggregate counters only.";

export function buildSensoriumGrantProposalTemplate({
  capability = "",
  provider = "",
  topic = "",
  constraints = {},
  requested_by = DEFAULT_REQUESTED_BY,
  requested_scope = SESSION_SCOPE,
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
  const sensoriumDefinition = SENSORIUM_CAPABILITIES[capabilityKey];

  if (!sensoriumDefinition) {
    errors.push(`capability "${capabilityKey || "(missing)"}" is not a recognized Sensorium capability`);
  }
  if (scope !== SESSION_SCOPE) {
    errors.push("Sensorium grant proposal templates currently require requested_scope=session");
  }
  if (!normalizedReason) {
    errors.push("reason is required");
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

  let validatedRequest = null;
  try {
    validatedRequest = validateSensoriumSubscriptionRequest(
      { topic, constraints },
      { capability: capabilityKey },
    );
  } catch (error) {
    errors.push(...(error.validation_errors ?? [error.message]));
  }

  if (providerDefinition && validatedRequest && !providerHostMatchesTopic(providerDefinition, validatedRequest.topic)) {
    errors.push(`provider "${providerId}" does not authorize topic ${validatedRequest.topic}`);
  }

  if (sensoriumDefinition && isPlainObject(constraints)) {
    for (const key of sensoriumDefinition.required_constraints) {
      if (!Object.hasOwn(constraints, key)) {
        errors.push(`constraints.${key} is required for ${capabilityKey}`);
      }
    }
  }

  if (errors.length > 0) {
    throwSensoriumGrantProposalTemplateError(errors);
  }

  const grantConstraints = { ...validatedRequest.constraints };
  const hostSegment = providerDefinition.host_segment ?? topicHost(validatedRequest.topic);
  const streamType = sensoriumDefinition.stream_type;
  const riskClass = capabilityDefinition.risk_class ?? "unknown";
  const activeDisclosure = activeDisclosureText({
    streamType,
    hostSegment,
    constraints: grantConstraints,
  });

  const review = {
    capability: capabilityKey,
    provider: providerId,
    host_segment: hostSegment,
    topic: validatedRequest.topic,
    stream_type: streamType,
    risk_class: riskClass,
    scope,
    constraints: grantConstraints,
    max_seconds: grantConstraints.max_seconds ?? null,
    max_fps: grantConstraints.max_fps ?? null,
    format_required: grantConstraints.format_required ?? "",
    downsample_to: Array.isArray(grantConstraints.downsample_to)
      ? [...grantConstraints.downsample_to]
      : [],
    recording_posture: NO_PAYLOAD_RECORDING,
    model_boundary_warning: modelBoundaryWarning(streamType),
    active_disclosure: activeDisclosure,
    revocation: {
      summary: `Revoking this grant stops active ${streamType} subscriptions for ${hostSegment} immediately.`,
      immediate_stop: true,
    },
    provenance_posture: PROVENANCE_POSTURE,
  };

  return {
    type: "sensorium_grant_proposal_template",
    proposal: {
      requested_by: requestedBy,
      capability: capabilityKey,
      reason: normalizedReason,
      requested_scope: scope,
      data_exposed: [...(capabilityDefinition.data_exposed ?? [])],
      excluded_data: [...(capabilityDefinition.excluded_by_default ?? [])],
      risk: riskSummary({ streamType, riskClass, hostSegment }),
      fallback: normalizedFallback,
    },
    review,
    grant_intent: {
      capability: capabilityKey,
      provider: providerId,
      scope,
      constraints: grantConstraints,
      reason: normalizedReason,
      activation_performed: false,
    },
    activation_performed: false,
    durable: false,
    writable: false,
  };
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

function providerHostMatchesTopic(provider = {}, topic = "") {
  if (!provider.host_segment) {
    return true;
  }
  return topic.startsWith(`sensor/${provider.host_segment}/`) ||
    topic.startsWith(`perception/${provider.host_segment}/`);
}

function topicHost(topic = "") {
  return topic.split("/")[1] ?? "";
}

function activeDisclosureText({ streamType, hostSegment, constraints }) {
  const parts = [`perception via Sensorium: ${streamType} from ${hostSegment}`];
  if (Number.isInteger(constraints.max_fps)) {
    parts.push(`${constraints.max_fps} fps max`);
  }
  if (Number.isInteger(constraints.max_seconds)) {
    parts.push(`expires in ${constraints.max_seconds} seconds`);
  }
  return parts.join(", ");
}

function modelBoundaryWarning(streamType) {
  if (streamType === "presence") {
    return "Presence events are Sensorium-derived coarse count buckets for output discretion (H2), not raw frames to Node, color, or identity claims; identity is not_performed. Count=0 does not relax private-output discretion until a separate reviewed FOV-coverage step is complete, and default coverage remains unreviewed.";
  }
  if (streamType === "pose") {
    return "Pose features expose full derived body, face, hand, posture, gaze, gesture, motion, and 3D position context to the local occupant once explicitly granted. Raw color/depth frames and identity recognition remain excluded unless separately granted.";
  }
  if (streamType === "color" || streamType === "depth") {
    return "Camera-class payloads can be stopped or withheld later, but frames already incorporated into a model turn cannot be removed from that turn's working context.";
  }
  return "Payloads can be stopped or withheld later, but samples already incorporated into a model turn cannot be removed from that turn's working context.";
}

function riskSummary({ streamType, riskClass, hostSegment }) {
  if (streamType === "presence") {
    return `Sensorium presence events from ${hostSegment}; risk_class=${riskClass}; minimized derived count buckets feed output-discretion decisions without raw frames, color, audio, or identity recognition.`;
  }
  if (streamType === "pose") {
    return `Sensorium full derived pose features from ${hostSegment}; risk_class=${riskClass}; exposes landmark tiers and derived posture/gaze/gesture/motion context without raw color/depth frames or identity recognition.`;
  }
  return `Sensorium ${streamType} stream from ${hostSegment}; risk_class=${riskClass}; live perception is not fully reversible once consumed by a model turn.`;
}

function stringValue(value) {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function throwSensoriumGrantProposalTemplateError(errors) {
  const error = new Error(`Invalid Sensorium grant proposal template: ${errors.join("; ")}`);
  error.statusCode = 400;
  error.code = "invalid_sensorium_grant_proposal_template";
  error.validation_errors = errors;
  throw error;
}

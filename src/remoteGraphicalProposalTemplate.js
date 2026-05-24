const REMOTE_GRAPHICAL_CAPABILITIES = {
  "perception.remote_desktop.video.subscribe": {
    mode: "view_only",
    authority: "video",
    required_channels: ["video"],
    forbidden_channels: ["pointer", "keyboard", "clipboard", "audio", "file_transfer", "recording"],
  },
  "desktop.remote.input.pointer": {
    mode: "pointer_input",
    authority: "pointer",
    required_channels: ["pointer"],
    forbidden_channels: ["video", "keyboard", "clipboard", "file_transfer", "recording"],
  },
  "desktop.remote.input.keyboard": {
    mode: "keyboard_input",
    authority: "keyboard",
    required_channels: ["keyboard"],
    forbidden_channels: ["video", "pointer", "clipboard", "file_transfer", "recording"],
  },
  "desktop.remote.session.disconnect": {
    mode: "disconnect",
    authority: "disconnect",
    required_channels: ["disconnect"],
    forbidden_channels: ["video", "pointer", "keyboard", "clipboard", "file_transfer", "recording"],
  },
};

const DEFAULT_REQUESTED_BY = "assistant";
const DEFAULT_FALLBACK = "Continue without remote graphical session access for this task.";
const DEFAULT_LOCALITY = "lan";
const SESSION_SCOPE = "session";
const MAX_SECONDS_MIN = 1;
const MAX_SECONDS_MAX = 3600;
const MAX_FPS_MIN = 1;
const MAX_FPS_MAX = 60;
const MAX_DIMENSION = 3840;
const MIN_WIDTH = 160;
const MIN_HEIGHT = 120;

export function buildRemoteGraphicalProposalTemplate({
  capability = "",
  provider = "",
  target_host = "",
  mode = "",
  constraints = {},
  requested_channels = [],
  requested_by = DEFAULT_REQUESTED_BY,
  requested_scope = SESSION_SCOPE,
  reason = "",
  fallback = DEFAULT_FALLBACK,
  locality = DEFAULT_LOCALITY,
  attended = true,
  catalog = {},
  providerRegistry = {},
} = {}) {
  const errors = [];
  const capabilityKey = stringValue(capability);
  const providerId = stringValue(provider);
  const targetHost = stringValue(target_host);
  const requestedMode = stringValue(mode);
  const requestedBy = stringValue(requested_by) || DEFAULT_REQUESTED_BY;
  const scope = stringValue(requested_scope);
  const normalizedReason = stringValue(reason);
  const normalizedFallback = stringValue(fallback) || DEFAULT_FALLBACK;
  const normalizedLocality = normalizeLocality(locality, errors);
  const definition = REMOTE_GRAPHICAL_CAPABILITIES[capabilityKey];

  if (!definition) {
    errors.push(`capability "${capabilityKey || "(missing)"}" is not a recognized remote graphical capability`);
  }
  if (definition && requestedMode !== definition.mode) {
    errors.push(`mode must be ${definition.mode} for ${capabilityKey}`);
  }
  if (!normalizedReason) {
    errors.push("reason is required");
  }
  if (scope !== "once" && scope !== SESSION_SCOPE) {
    errors.push("remote graphical proposal templates require requested_scope=once or requested_scope=session");
  }
  if (!isHostLike(targetHost)) {
    errors.push("target_host must be a hostname-like identifier");
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

  const normalizedConstraints = normalizeConstraints(constraints, definition, errors);
  const normalizedChannels = normalizeRequestedChannels(requested_channels, definition, errors);

  if (errors.length > 0) {
    throwRemoteGraphicalProposalTemplateError(errors);
  }

  const riskClass = capabilityDefinition.risk_class ?? "unknown";
  const grantConstraints = {
    target_host: targetHost,
    mode: definition.mode,
    locality: normalizedLocality,
    attended: Boolean(attended),
    requested_channels: normalizedChannels,
    max_seconds: normalizedConstraints.max_seconds,
  };
  if (definition.authority === "video") {
    grantConstraints.max_fps = normalizedConstraints.max_fps;
    grantConstraints.max_width = normalizedConstraints.max_width;
    grantConstraints.max_height = normalizedConstraints.max_height;
  }

  return {
    type: "remote_graphical_session_proposal_template",
    proposal: {
      requested_by: requestedBy,
      capability: capabilityKey,
      reason: normalizedReason,
      requested_scope: scope,
      data_exposed: [...(capabilityDefinition.data_exposed ?? [])],
      excluded_data: [...(capabilityDefinition.excluded_by_default ?? [])],
      risk: riskSummary({
        authority: definition.authority,
        riskClass,
        targetHost,
        locality: normalizedLocality,
      }),
      fallback: normalizedFallback,
    },
    review: {
      capability: capabilityKey,
      provider: providerId,
      target_host: targetHost,
      mode: definition.mode,
      authority: definition.authority,
      risk_class: riskClass,
      scope,
      locality: normalizedLocality,
      attended: Boolean(attended),
      constraints: grantConstraints,
      requested_channels: normalizedChannels,
      excluded_channels: [...definition.forbidden_channels],
      active_disclosure: activeDisclosureText({
        authority: definition.authority,
        targetHost,
        maxSeconds: normalizedConstraints.max_seconds,
      }),
      revocation: {
        summary: `Revoking this grant stops ${definition.authority} authority for ${targetHost}.`,
        immediate_stop: true,
      },
      recording_posture: "No screenshots, frames, keystrokes, pointer paths, clipboard contents, or recordings are retained by default.",
      model_boundary_warning: modelBoundaryWarning(definition.authority),
      provenance_posture: "Record target host, provider, capability, requested bounds, lifecycle, and aggregate counters only.",
    },
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

function normalizeConstraints(value, definition, errors) {
  if (!isPlainObject(value)) {
    errors.push("constraints must be an object");
    return {};
  }
  const allowed = new Set(definition?.authority === "video"
    ? ["max_seconds", "max_fps", "max_width", "max_height"]
    : ["max_seconds"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push(`constraints.${key} is not allowed for ${definition?.authority ?? "unknown"} authority`);
    }
  }
  const normalized = {
    max_seconds: parseInteger(value.max_seconds, "constraints.max_seconds", MAX_SECONDS_MIN, MAX_SECONDS_MAX, errors),
  };
  if (definition?.authority === "video") {
    normalized.max_fps = parseInteger(value.max_fps, "constraints.max_fps", MAX_FPS_MIN, MAX_FPS_MAX, errors);
    normalized.max_width = parseInteger(value.max_width, "constraints.max_width", MIN_WIDTH, MAX_DIMENSION, errors);
    normalized.max_height = parseInteger(value.max_height, "constraints.max_height", MIN_HEIGHT, MAX_DIMENSION, errors);
  }
  return normalized;
}

function normalizeRequestedChannels(value, definition, errors) {
  const requested = Array.isArray(value) && value.length > 0
    ? value.map((entry) => stringValue(entry)).filter(Boolean)
    : [...(definition?.required_channels ?? [])];
  const unique = [...new Set(requested)];
  if (definition) {
    for (const required of definition.required_channels) {
      if (!unique.includes(required)) {
        errors.push(`requested_channels must include ${required}`);
      }
    }
    for (const channel of unique) {
      if (!definition.required_channels.includes(channel)) {
        errors.push(`requested_channels.${channel} is not authorized by ${definition.mode}`);
      }
    }
  }
  return unique;
}

function parseInteger(value, label, min, max, errors) {
  if (!Number.isInteger(value)) {
    errors.push(`${label} must be an integer from ${min} to ${max}`);
    return null;
  }
  if (value < min || value > max) {
    errors.push(`${label} must be an integer from ${min} to ${max}`);
    return null;
  }
  return value;
}

function normalizeLocality(value, errors) {
  const locality = stringValue(value) || DEFAULT_LOCALITY;
  if (!["local", "lan", "vpn", "internet"].includes(locality)) {
    errors.push("locality must be local, lan, vpn, or internet");
  }
  return locality;
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

function activeDisclosureText({ authority, targetHost, maxSeconds }) {
  return `remote graphical ${authority} authority for ${targetHost}, expires in ${maxSeconds} seconds`;
}

function modelBoundaryWarning(authority) {
  if (authority === "video") {
    return "Remote desktop frames can be stopped or withheld later, but frames already incorporated into a model turn cannot be removed from that turn's working context.";
  }
  return "Remote input can be logged and stopped later, but input already sent to the remote system cannot be unsent.";
}

function riskSummary({ authority, riskClass, targetHost, locality }) {
  return `Remote graphical ${authority} authority for ${targetHost} over ${locality}; risk_class=${riskClass}; pairing is substrate, not permission.`;
}

function isHostLike(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/.test(value);
}

function stringValue(value) {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function throwRemoteGraphicalProposalTemplateError(errors) {
  const error = new Error(`Invalid remote graphical proposal template: ${errors.join("; ")}`);
  error.statusCode = 400;
  error.code = "invalid_remote_graphical_proposal_template";
  error.validation_errors = errors;
  throw error;
}

const EXPECTED_PROVIDER_ID = "soma.provider.remote_desktop.sunshine";
const EXPECTED_MANIFEST_VERSION = "soma.remote_graphical.provider_manifest.v1";
const EXPECTED_PROVIDER_CONTRACT = "soma.remote_graphical.broker.v1";
const EXPECTED_RUNTIME = "remote-graphical-session";

const REQUIRED_RUNTIME_OPT_INS = [
  "SOMA_REMOTE_GRAPHICAL_ENABLED=1",
  "SOMA_REMOTE_GRAPHICAL_PROVIDER=soma.provider.remote_desktop.sunshine",
];

const ALLOWED_LOCALITIES = new Set(["local", "lan", "vpn", "internet"]);

const REQUIRED_DISABLED_AUTHORITIES = [
  "pairing",
  "credential_persistence",
  "video_observation",
  "screenshot_capture",
  "ocr",
  "pointer_input",
  "keyboard_input",
  "clipboard",
  "file_transfer",
  "audio",
  "controller_input",
  "recording",
  "model_visual_delivery",
  "durable_grant_writes",
];

const REQUIRED_ACTIONS = new Set([
  "status",
  "open_session",
  "describe_active",
  "cleanup_for_grant",
]);

const OPEN_SESSION_MUST_NOT_ENABLE = [
  "video",
  "input",
  "recording",
  "model_delivery",
];

export function validateRemoteGraphicalLiveProviderManifest(manifest) {
  const errors = [];
  if (!isPlainObject(manifest)) {
    throwRemoteGraphicalLiveProviderManifestError(["manifest must be an object"]);
  }

  requireExact(manifest.id, EXPECTED_PROVIDER_ID, "id", errors);
  requireExact(manifest.manifest_version, EXPECTED_MANIFEST_VERSION, "manifest_version", errors);
  requireExact(manifest.provider_contract, EXPECTED_PROVIDER_CONTRACT, "provider_contract", errors);
  requireExact(manifest.runtime, EXPECTED_RUNTIME, "runtime", errors);
  if (manifest.default_enabled !== false) {
    errors.push("default_enabled must be false");
  }

  validateImplementation(manifest.implementation, errors);
  validateRuntimeOptIns(manifest.required_runtime_opt_ins, errors);
  validateTargetConstraints(manifest.target_constraints, errors);
  validateSupportedActions(manifest.supported_actions, errors);
  validateDisabledAuthorities(manifest.disabled_authorities, errors);

  if (errors.length > 0) {
    throwRemoteGraphicalLiveProviderManifestError(errors);
  }

  return copyPlainJson(manifest);
}

function validateImplementation(implementation, errors) {
  if (!isPlainObject(implementation)) {
    errors.push("implementation must be an object");
    return;
  }
  requireExact(implementation.broker_kind, "moonlight-client-broker", "implementation.broker_kind", errors);
  requireExact(implementation.transport, "sunshine-moonlight", "implementation.transport", errors);
  requireExact(
    implementation.construction,
    "explicit-runtime-injection",
    "implementation.construction",
    errors,
  );
}

function validateRuntimeOptIns(optIns, errors) {
  if (!Array.isArray(optIns)) {
    errors.push("required_runtime_opt_ins must be an array");
    return;
  }
  for (const required of REQUIRED_RUNTIME_OPT_INS) {
    if (!optIns.includes(required)) {
      errors.push(`required_runtime_opt_ins must include ${required}`);
    }
  }
}

function validateTargetConstraints(targetConstraints, errors) {
  if (!isPlainObject(targetConstraints)) {
    errors.push("target_constraints must be an object");
    return;
  }
  if (!Array.isArray(targetConstraints.allowed_hosts) || targetConstraints.allowed_hosts.length < 1) {
    errors.push("target_constraints.allowed_hosts must include at least one host");
  } else {
    for (const [index, host] of targetConstraints.allowed_hosts.entries()) {
      if (!isNonEmptyString(host)) {
        errors.push(`target_constraints.allowed_hosts[${index}] must be a non-empty string`);
      }
      if (host === "*" || String(host).includes("*")) {
        errors.push(`target_constraints.allowed_hosts[${index}] must not be a wildcard`);
      }
    }
  }
  if (!Array.isArray(targetConstraints.locality) || targetConstraints.locality.length < 1) {
    errors.push("target_constraints.locality must include at least one locality");
  } else {
    for (const locality of targetConstraints.locality) {
      if (!ALLOWED_LOCALITIES.has(locality)) {
        errors.push(`target_constraints.locality includes unsupported locality ${String(locality)}`);
      }
    }
  }
  if (targetConstraints.attended_required !== true) {
    errors.push("target_constraints.attended_required must be true");
  }
  if (!isNonEmptyString(targetConstraints.operator_rollback)) {
    errors.push("target_constraints.operator_rollback must be a non-empty string");
  }
}

function validateSupportedActions(actions, errors) {
  if (!Array.isArray(actions)) {
    errors.push("supported_actions must be an array");
    return;
  }
  const byAction = new Map();
  for (const [index, action] of actions.entries()) {
    if (!isPlainObject(action)) {
      errors.push(`supported_actions[${index}] must be an object`);
      continue;
    }
    if (!isNonEmptyString(action.action)) {
      errors.push(`supported_actions[${index}].action must be a non-empty string`);
      continue;
    }
    byAction.set(action.action, action);
  }
  for (const action of REQUIRED_ACTIONS) {
    if (!byAction.has(action)) {
      errors.push(`supported_actions must include ${action}`);
    }
  }

  const status = byAction.get("status");
  if (status) {
    requireBoolean(status.requires_grant, false, "supported_actions.status.requires_grant", errors);
    requireBoolean(status.live_transport_allowed, false, "supported_actions.status.live_transport_allowed", errors);
  }

  const openSession = byAction.get("open_session");
  if (openSession) {
    requireBoolean(openSession.requires_grant, true, "supported_actions.open_session.requires_grant", errors);
    requireBoolean(openSession.requires_user_actor, true, "supported_actions.open_session.requires_user_actor", errors);
    requireBoolean(openSession.requires_review, true, "supported_actions.open_session.requires_review", errors);
    requireBoolean(openSession.live_transport_allowed, true, "supported_actions.open_session.live_transport_allowed", errors);
    validateRequiredStrings(
      openSession.must_not_enable,
      OPEN_SESSION_MUST_NOT_ENABLE,
      "supported_actions.open_session.must_not_enable",
      errors,
    );
  }

  const describeActive = byAction.get("describe_active");
  if (describeActive) {
    requireBoolean(
      describeActive.live_transport_allowed,
      false,
      "supported_actions.describe_active.live_transport_allowed",
      errors,
    );
  }

  const cleanupForGrant = byAction.get("cleanup_for_grant");
  if (cleanupForGrant) {
    requireBoolean(cleanupForGrant.requires_grant, true, "supported_actions.cleanup_for_grant.requires_grant", errors);
  }
}

function validateDisabledAuthorities(authorities, errors) {
  validateRequiredStrings(authorities, REQUIRED_DISABLED_AUTHORITIES, "disabled_authorities", errors);
}

function validateRequiredStrings(values, requiredValues, path, errors) {
  if (!Array.isArray(values)) {
    errors.push(`${path} must be an array`);
    return;
  }
  for (const required of requiredValues) {
    if (!values.includes(required)) {
      errors.push(`${path} must include ${required}`);
    }
  }
}

function requireExact(actual, expected, path, errors) {
  if (actual !== expected) {
    errors.push(`${path} must be ${expected}`);
  }
}

function requireBoolean(actual, expected, path, errors) {
  if (actual !== expected) {
    errors.push(`${path} must be ${expected}`);
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function copyPlainJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function throwRemoteGraphicalLiveProviderManifestError(errors) {
  const error = new Error(`Invalid remote graphical live provider manifest: ${errors.join("; ")}`);
  error.code = "invalid_remote_graphical_live_provider_manifest";
  error.statusCode = 400;
  error.validation_errors = errors;
  throw error;
}

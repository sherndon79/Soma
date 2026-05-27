import {
  REMOTE_GRAPHICAL_LIVE_BROKER_DEFAULT_BINARY,
} from "./remoteGraphicalLiveBrokerManager.js";

export function planRemoteGraphicalLiveBrokerManagerStartup({
  posture = {},
  helperBinaryPath = REMOTE_GRAPHICAL_LIVE_BROKER_DEFAULT_BINARY,
} = {}) {
  const normalized = normalizePosture(posture);
  const reviewedHelperBinaryPath = isReviewedHelperBinaryPath(helperBinaryPath);

  if (!normalized.requested) {
    return startupPlan({
      posture: normalized,
      helperBinaryPath,
      reviewedHelperBinaryPath,
      eligibility: "runtime_not_requested",
      reason: "Remote graphical live manager startup requires explicit runtime opt-in.",
    });
  }

  if (!normalized.configured || !normalized.manifest_loaded) {
    return startupPlan({
      posture: normalized,
      helperBinaryPath,
      reviewedHelperBinaryPath,
      eligibility: "manifest_not_configured",
      reason: "Remote graphical live manager startup requires configured repository manifest posture.",
    });
  }

  if (!normalized.provider || !normalized.target_host) {
    return startupPlan({
      posture: normalized,
      helperBinaryPath,
      reviewedHelperBinaryPath,
      eligibility: "manifest_identity_incomplete",
      reason: "Remote graphical live manager startup requires provider and target host identity.",
    });
  }

  if (!reviewedHelperBinaryPath) {
    return startupPlan({
      posture: normalized,
      helperBinaryPath,
      reviewedHelperBinaryPath,
      eligibility: "helper_binary_not_reviewed",
      reason: "Remote graphical live manager startup requires a reviewed helper binary path.",
    });
  }

  return startupPlan({
    posture: normalized,
    helperBinaryPath,
    reviewedHelperBinaryPath,
    eligible: true,
    eligibility: "eligible",
    reason: "Remote graphical live manager startup posture is eligible for future construction.",
  });
}

function startupPlan({
  posture,
  helperBinaryPath,
  reviewedHelperBinaryPath,
  eligible = false,
  eligibility,
  reason,
}) {
  return {
    eligible: Boolean(eligible),
    eligibility: stringValue(eligibility),
    reason: stringValue(reason),
    provider: posture.provider,
    target_host: posture.target_host,
    requested: posture.requested,
    configured: posture.configured,
    manifest_loaded: posture.manifest_loaded,
    manifest_source_kind: posture.manifest_source_kind,
    helper_binary_path: stringValue(helperBinaryPath),
    reviewed_helper_binary_path: Boolean(reviewedHelperBinaryPath),
    manager_constructed: false,
    helper_started: false,
    broker_called: false,
    session_opened: false,
    pairing_performed: false,
    video_attached: false,
    input_dispatched: false,
    recording_started: false,
    provider_session_stopped: false,
    model_delivery: false,
    live_transport_used: false,
  };
}

function isReviewedHelperBinaryPath(value) {
  const path = stringValue(value);
  return path === REMOTE_GRAPHICAL_LIVE_BROKER_DEFAULT_BINARY
    || path.endsWith("/target/debug/soma-moonlight-broker");
}

function normalizePosture(value = {}) {
  return {
    requested: Boolean(value.requested),
    configured: Boolean(value.configured),
    manifest_loaded: Boolean(value.manifest_loaded),
    provider: stringValue(value.provider),
    target_host: stringValue(value.target_host ?? value.targetHost),
    manifest_source_kind: stringValue(value.manifest_source_kind),
  };
}

function stringValue(value) {
  return String(value ?? "").trim();
}

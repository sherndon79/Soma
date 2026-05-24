const REMOTE_GRAPHICAL_CAPABILITIES = new Set([
  "perception.remote_desktop.video.subscribe",
  "desktop.remote.input.pointer",
  "desktop.remote.input.keyboard",
  "desktop.remote.session.disconnect",
]);

export function buildRemoteGraphicalSessionOpenReview({
  grant = {},
  reason = "",
  requested_by = "assistant",
} = {}) {
  const errors = [];
  const normalizedGrant = normalizeGrant(grant);
  const normalizedReason = stringValue(reason);
  const requestedBy = stringValue(requested_by) || "assistant";

  if (!normalizedGrant.id) {
    errors.push("session-open review requires a grant");
  }
  if (normalizedGrant.status !== "active") {
    errors.push("session-open review requires an active grant");
  }
  if (!REMOTE_GRAPHICAL_CAPABILITIES.has(normalizedGrant.capability)) {
    errors.push("session-open review requires a remote graphical grant");
  }
  if (!normalizedGrant.provider) {
    errors.push("session-open review requires a grant provider");
  }
  if (!isHostLike(normalizedGrant.constraints.target_host)) {
    errors.push("session-open review requires grant constraints.target_host");
  }
  if (!normalizedGrant.constraints.mode) {
    errors.push("session-open review requires grant constraints.mode");
  }
  if (!normalizedReason) {
    errors.push("session-open review requires reason");
  }

  if (errors.length > 0) {
    throwSessionOpenReviewError(errors);
  }

  const targetHost = normalizedGrant.constraints.target_host;
  return {
    type: "remote_graphical_session_open_review",
    requested_by: requestedBy,
    source_grant_id: normalizedGrant.id,
    capability: normalizedGrant.capability,
    provider: normalizedGrant.provider,
    target_host: targetHost,
    scope: normalizedGrant.scope,
    reason: normalizedReason,
    broker_action: "open_session",
    review: {
      action: "open_session",
      target_host: targetHost,
      provider: normalizedGrant.provider,
      source_grant_id: normalizedGrant.id,
      source_capability: normalizedGrant.capability,
      source_mode: normalizedGrant.constraints.mode,
      locality: normalizedGrant.constraints.locality ?? "",
      attended: normalizedGrant.constraints.attended ?? null,
      session_open_authority: "review_required",
      video_observation_authority: "separate_action_required",
      input_authority: "separate_action_required",
      disconnect_authority: "separate_action_required",
      recording_authority: "not_requested",
      model_delivery_authority: "not_requested",
      active_disclosure: `Review opening a remote graphical broker session for ${targetHost}.`,
      revocation: {
        summary: "Revoking the source grant prevents future broker use for this authority.",
        immediate_stop: false,
      },
      provenance_posture: "Record target host, provider, source grant, requested action, and non-activation flags only.",
    },
    activation_performed: false,
    review_only: true,
    durable: false,
    grant_written: false,
    broker_called: false,
    session_opened: false,
    pairing_performed: false,
    video_attached: false,
    input_dispatched: false,
    recording_started: false,
    model_delivery: false,
    live_transport_used: false,
  };
}

function normalizeGrant(grant) {
  const constraints = grant && typeof grant === "object" && !Array.isArray(grant.constraints)
    && grant.constraints && typeof grant.constraints === "object"
    ? grant.constraints
    : {};
  return {
    id: stringValue(grant?.id),
    status: stringValue(grant?.status),
    capability: stringValue(grant?.capability),
    provider: stringValue(grant?.provider),
    scope: stringValue(grant?.scope),
    constraints: {
      ...constraints,
      target_host: stringValue(constraints.target_host),
      mode: stringValue(constraints.mode),
      locality: stringValue(constraints.locality),
    },
  };
}

function isHostLike(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/.test(String(value ?? ""));
}

function stringValue(value) {
  return String(value ?? "").trim();
}

function throwSessionOpenReviewError(errors) {
  const error = new Error(`Invalid remote graphical session-open review: ${errors.join("; ")}`);
  error.statusCode = 400;
  error.code = "invalid_remote_graphical_session_open_review";
  error.validation_errors = errors;
  throw error;
}

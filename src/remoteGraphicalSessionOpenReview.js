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

export function buildRemoteGraphicalSessionOpenRefusal({
  grant = {},
  reason = "",
  actor = "",
  requested_by = "assistant",
  brokerStatus = {},
} = {}) {
  const normalizedActor = stringValue(actor);
  if (normalizedActor !== "user") {
    const error = new Error("Remote graphical session-open requires an explicit user actor.");
    error.statusCode = 400;
    error.code = "remote_graphical_session_open_requires_user_actor";
    throw error;
  }

  const review = buildRemoteGraphicalSessionOpenReview({
    grant,
    reason,
    requested_by,
  });
  const refusal = remoteGraphicalBrokerRefusalFromStatus(brokerStatus);

  return {
    ...review,
    type: "remote_graphical_session_open_refusal",
    refused: true,
    status: refusal.status,
    state: refusal.state,
    error: refusal.code,
    message: refusal.message,
    review_only: false,
    broker_called: false,
    provider_session_stopped: false,
    session_id: "",
  };
}

export function remoteGraphicalBrokerRefusalFromStatus(status = {}) {
  const requested = Boolean(status.requested);
  const enabled = Boolean(status.enabled);
  const configured = Boolean(status.configured);
  const providerStatus = stringValue(status.status);
  const providerState = stringValue(status.state);

  if (!requested || !enabled) {
    return {
      code: "remote_graphical_broker_not_enabled",
      status: "broker_not_enabled",
      state: "disabled",
      message: "Remote graphical session-open requires explicit runtime opt-in before broker use.",
    };
  }

  if (!configured) {
    return {
      code: "remote_graphical_broker_not_configured",
      status: "provider_not_configured",
      state: providerState || "unconfigured",
      message: "Remote graphical session-open requires a configured remote graphical broker.",
    };
  }

  return {
    code: "remote_graphical_broker_provider_unavailable",
    status: providerStatus || "session_open_disabled",
    state: providerState || "configured_inactive",
    message: "Remote graphical broker is configured, but live session-open activation is not enabled in this slice.",
  };
}

export function buildRemoteGraphicalSessionOpenFixtureSuccess({
  review = {},
  brokerResult = {},
} = {}) {
  const sessionId = stringValue(brokerResult.session_id ?? brokerResult.id);
  if (!sessionId) {
    const error = new Error("Remote graphical broker fixture session-open requires session_id.");
    error.code = "remote_graphical_broker_session_open_failed";
    error.statusCode = 502;
    throw error;
  }

  return {
    ...review,
    type: "remote_graphical_session_open_result",
    refused: false,
    status: stringValue(brokerResult.status) || "opened",
    state: stringValue(brokerResult.state) || "open",
    session_id: sessionId,
    provider: stringValue(brokerResult.provider) || stringValue(review.provider),
    target_host: stringValue(brokerResult.target_host ?? brokerResult.targetHost) || stringValue(review.target_host),
    locality: stringValue(brokerResult.locality),
    attended: brokerResult.attended === undefined ? null : Boolean(brokerResult.attended),
    review_only: false,
    activation_performed: true,
    broker_called: true,
    session_opened: true,
    fixture_only: true,
    durable: false,
    grant_written: false,
    pairing_performed: false,
    video_attached: false,
    input_dispatched: false,
    recording_started: false,
    provider_session_stopped: false,
    model_delivery: false,
    live_transport_used: false,
  };
}

export function buildRemoteGraphicalSessionOpenBrokerFailure({
  review = {},
  cause,
} = {}) {
  return {
    ...review,
    type: "remote_graphical_session_open_refusal",
    refused: true,
    status: "session_open_failed",
    state: "failed",
    error: "remote_graphical_broker_session_open_failed",
    message: "Remote graphical broker fixture session-open failed before live transport.",
    cause_code: stringValue(cause?.code),
    review_only: false,
    broker_called: true,
    session_opened: false,
    provider_session_stopped: false,
    session_id: "",
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

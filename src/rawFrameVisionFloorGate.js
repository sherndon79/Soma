export const RAW_FRAME_VISION_FLOOR_REASONS = Object.freeze({
  ALLOWED: "allowed",
  EPISODE_NOT_LIVE: "episode_not_live",
  GRANT_RECOVERY_DEGRADED: "grant_recovery_degraded",
  VISUAL_GRANT_NOT_ACTIVE: "visual_grant_not_active",
  RETENTION_NOT_NONE: "retention_not_none",
  SOURCE_SUBSCRIPTION_NOT_ACTIVE: "source_subscription_not_active",
  SOURCE_SUBSCRIPTION_HOST_MISMATCH: "source_subscription_host_mismatch",
  SOLO_ATTESTATION_MISSING: "solo_attestation_missing",
  SOLO_ATTESTATION_UNTRUSTED_ORIGIN: "solo_attestation_untrusted_origin",
  SOLO_ATTESTATION_OCCUPANT_WRITABLE: "solo_attestation_occupant_writable",
  SOLO_ATTESTATION_NOT_CONSENTING: "solo_attestation_not_consenting",
  SOLO_ATTESTATION_STALE: "solo_attestation_stale",
  PRESENCE_UNAVAILABLE: "presence_unavailable",
  PRESENCE_HOST_MISMATCH: "presence_host_mismatch",
  PRESENCE_STALE: "presence_stale",
  PRESENCE_COUNT_NOT_EXACTLY_ONE: "presence_count_not_exactly_one",
  PRESENCE_ADDITIONAL_PERSON_DETECTED: "presence_additional_person_detected",
  PRESENCE_CONFIDENCE_INSUFFICIENT: "presence_confidence_insufficient",
  RUN_POSTURE_SETH_NOT_CONSENTING: "run_posture_seth_not_consenting",
  PROFILE_NOT_VISION_CAPABLE: "profile_not_vision_capable",
});

const DEFAULT_ATTESTATION_TTL_MS = 60_000;
const DEFAULT_PRESENCE_TTL_MS = 2_000;
const TRUSTED_ATTESTATION_ORIGINS = new Set([
  "seth",
  "steward",
  "operator",
  "trusted_run_control",
  "trusted_local_hardware",
]);
const OCCUPANT_ATTESTATION_ORIGINS = new Set([
  "occupant",
  "assistant",
  "model",
  "chat",
  "tool_call",
  "forum",
  "memory",
  "visual_attach_request",
]);
const LIVE_EPISODE_STATUSES = new Set(["active", "running", "open"]);
const CLOSED_EPISODE_STATUSES = new Set(["paused", "distressed", "ejected", "closed", "aborted"]);
const MODALITY_CAPABILITY_SUFFIX = Object.freeze({
  color: "color.attach",
  depth: "depth.attach",
  pose: "pose.attach",
  composite: "composite.attach",
});

export function decideRawFrameVisionFloorGate({
  runPosture = {},
  episodeStatus = "",
  visualGrant = {},
  grantRecoveryReport = null,
  soloAttestation = null,
  presenceState = null,
  sourceSubscription = {},
  profile = {},
  modality = "",
  sourceHost = "",
  now = new Date(),
  attestationTtlMs = DEFAULT_ATTESTATION_TTL_MS,
  presenceTtlMs = DEFAULT_PRESENCE_TTL_MS,
} = {}) {
  const evaluatedAt = asDate(now);
  const requestedModality = stringValue(modality || visualGrant?.constraints?.payload_type || sourceSubscription?.modality);
  const expectedHost = stringValue(sourceHost || visualGrant?.constraints?.source_host || sourceSubscription?.source_host);
  const checks = baseChecks({ evaluatedAt, requestedModality, expectedHost });

  const episode = evaluateEpisode({ runPosture, episodeStatus });
  checks.episode_live = episode.ok;
  if (!episode.ok) return refusal(episode.reason, checks);

  checks.grant_recovery_clean = !grantRecoveryReport?.degraded;
  if (!checks.grant_recovery_clean) return refusal(RAW_FRAME_VISION_FLOOR_REASONS.GRANT_RECOVERY_DEGRADED, checks);

  const grant = evaluateVisualGrant({ visualGrant, requestedModality, expectedHost });
  Object.assign(checks, grant.checks);
  if (!grant.ok) return refusal(grant.reason, checks);

  const subscription = evaluateSourceSubscription({ sourceSubscription, expectedHost, visualGrant });
  Object.assign(checks, subscription.checks);
  if (!subscription.ok) return refusal(subscription.reason, checks);

  const attestation = evaluateSoloAttestation({ soloAttestation, evaluatedAt, attestationTtlMs });
  Object.assign(checks, attestation.checks);
  if (!attestation.ok) return refusal(attestation.reason, checks);

  const presence = evaluatePresence({ presenceState, expectedHost, evaluatedAt, presenceTtlMs });
  Object.assign(checks, presence.checks);
  if (!presence.ok) return refusal(presence.reason, checks);

  const posture = evaluateRunPosture(runPosture);
  Object.assign(checks, posture.checks);
  if (!posture.ok) return refusal(posture.reason, checks);

  checks.profile_vision_capable = profileSupportsVision(profile, requestedModality);
  if (!checks.profile_vision_capable) {
    return refusal(RAW_FRAME_VISION_FLOOR_REASONS.PROFILE_NOT_VISION_CAPABLE, checks);
  }

  return {
    allowed: true,
    reason: RAW_FRAME_VISION_FLOOR_REASONS.ALLOWED,
    checks: Object.freeze({
      ...checks,
      profile_vision_capable: true,
    }),
  };
}

function evaluateEpisode({ runPosture = {}, episodeStatus = "" } = {}) {
  const status = stringValue(episodeStatus || runPosture.status || runPosture.episode_status);
  if (!status) {
    return { ok: false, reason: RAW_FRAME_VISION_FLOOR_REASONS.EPISODE_NOT_LIVE };
  }
  if (CLOSED_EPISODE_STATUSES.has(status)) {
    return { ok: false, reason: RAW_FRAME_VISION_FLOOR_REASONS.EPISODE_NOT_LIVE };
  }
  if (status && !LIVE_EPISODE_STATUSES.has(status)) {
    return { ok: false, reason: RAW_FRAME_VISION_FLOOR_REASONS.EPISODE_NOT_LIVE };
  }
  const controlState = stringValue(runPosture.control_state);
  if (CLOSED_EPISODE_STATUSES.has(controlState)) {
    return { ok: false, reason: RAW_FRAME_VISION_FLOOR_REASONS.EPISODE_NOT_LIVE };
  }
  return { ok: true };
}

function evaluateVisualGrant({ visualGrant = {}, requestedModality = "", expectedHost = "" } = {}) {
  const constraints = visualGrant.constraints ?? {};
  const capability = stringValue(visualGrant.capability);
  const modalitySuffix = MODALITY_CAPABILITY_SUFFIX[requestedModality];
  const active = visualGrant.status === "active";
  const capabilityMatches = Boolean(modalitySuffix && capability === `model.context.visual.${modalitySuffix}`);
  const hostMatches = !expectedHost || !constraints.source_host || stringValue(constraints.source_host) === expectedHost;
  const retentionNone = stringValue(constraints.retention_mode) === "none";
  const checks = {
    visual_grant_active: active && capabilityMatches && hostMatches,
    retention_none: retentionNone,
  };
  if (!checks.visual_grant_active) {
    return { ok: false, reason: RAW_FRAME_VISION_FLOOR_REASONS.VISUAL_GRANT_NOT_ACTIVE, checks };
  }
  if (!checks.retention_none) {
    return { ok: false, reason: RAW_FRAME_VISION_FLOOR_REASONS.RETENTION_NOT_NONE, checks };
  }
  return { ok: true, checks };
}

function evaluateSourceSubscription({ sourceSubscription = {}, expectedHost = "", visualGrant = {} } = {}) {
  const subscriptionId = stringValue(sourceSubscription.subscription_id || sourceSubscription.id);
  const grantSubscriptionIds = Array.isArray(visualGrant?.constraints?.source_subscription_ids)
    ? visualGrant.constraints.source_subscription_ids.map(stringValue)
    : [];
  const status = stringValue(sourceSubscription.status || sourceSubscription.subscription_status);
  const active = Boolean(subscriptionId) &&
    ["active", "running", "open"].includes(status) &&
    (grantSubscriptionIds.length === 0 || grantSubscriptionIds.includes(subscriptionId));
  const host = stringValue(sourceSubscription.source_host || sourceSubscription.host);
  const hostMatches = Boolean(expectedHost && host && host === expectedHost);
  const checks = {
    source_subscription_active: active,
    source_subscription_host_matches: hostMatches,
  };
  if (!active) {
    return { ok: false, reason: RAW_FRAME_VISION_FLOOR_REASONS.SOURCE_SUBSCRIPTION_NOT_ACTIVE, checks };
  }
  if (!hostMatches) {
    return { ok: false, reason: RAW_FRAME_VISION_FLOOR_REASONS.SOURCE_SUBSCRIPTION_HOST_MISMATCH, checks };
  }
  return { ok: true, checks };
}

function evaluateSoloAttestation({ soloAttestation, evaluatedAt, attestationTtlMs } = {}) {
  const checks = {
    solo_attestation_present: Boolean(soloAttestation && typeof soloAttestation === "object"),
    solo_attestation_fresh: false,
    solo_attestation_non_occupant_writable: false,
    solo_attestation_seth_present_and_consenting: false,
  };
  if (!checks.solo_attestation_present) {
    return { ok: false, reason: RAW_FRAME_VISION_FLOOR_REASONS.SOLO_ATTESTATION_MISSING, checks };
  }
  const origin = stringValue(
    soloAttestation.input_origin ||
    soloAttestation.origin ||
    soloAttestation.actor ||
    soloAttestation.source,
  );
  if (OCCUPANT_ATTESTATION_ORIGINS.has(origin)) {
    return { ok: false, reason: RAW_FRAME_VISION_FLOOR_REASONS.SOLO_ATTESTATION_OCCUPANT_WRITABLE, checks };
  }
  if (!TRUSTED_ATTESTATION_ORIGINS.has(origin)) {
    return { ok: false, reason: RAW_FRAME_VISION_FLOOR_REASONS.SOLO_ATTESTATION_UNTRUSTED_ORIGIN, checks };
  }
  const occupantWritable = soloAttestation.occupant_writable === true ||
    soloAttestation.occupant_refreshed === true ||
    soloAttestation.occupant_influenced === true ||
    soloAttestation.refreshed_by === "occupant" ||
    soloAttestation.created_by === "occupant";
  checks.solo_attestation_non_occupant_writable = !occupantWritable;
  if (!checks.solo_attestation_non_occupant_writable) {
    return { ok: false, reason: RAW_FRAME_VISION_FLOOR_REASONS.SOLO_ATTESTATION_OCCUPANT_WRITABLE, checks };
  }
  checks.solo_attestation_seth_present_and_consenting =
    soloAttestation.seth_present === true &&
    soloAttestation.seth_consented === true &&
    soloAttestation.active_control === true &&
    soloAttestation.no_other_person_in_frame === true;
  if (!checks.solo_attestation_seth_present_and_consenting) {
    return { ok: false, reason: RAW_FRAME_VISION_FLOOR_REASONS.SOLO_ATTESTATION_NOT_CONSENTING, checks };
  }
  const issuedAt = parseDate(soloAttestation.issued_at || soloAttestation.attested_at || soloAttestation.created_at);
  const expiresAt = parseDate(soloAttestation.expires_at);
  checks.solo_attestation_fresh = soloAttestation.perception_window_active === true
    ? isActiveWindow({ issuedAt, expiresAt, evaluatedAt })
    : isFresh({
      observedAt: issuedAt,
      expiresAt,
      evaluatedAt,
      ttlMs: attestationTtlMs,
    });
  if (!checks.solo_attestation_fresh) {
    return { ok: false, reason: RAW_FRAME_VISION_FLOOR_REASONS.SOLO_ATTESTATION_STALE, checks };
  }
  return { ok: true, checks };
}

function evaluatePresence({ presenceState, expectedHost, evaluatedAt, presenceTtlMs } = {}) {
  const presence = presenceState?.snapshot && typeof presenceState.snapshot === "function"
    ? presenceState.snapshot({ now: () => evaluatedAt })
    : presenceState;
  const checks = {
    presence_available: presence?.status === "available",
    presence_host_matches: false,
    presence_fresh: false,
    presence_person_count_exactly_one: false,
    presence_no_additional_person: false,
    presence_confidence_sufficient: false,
  };
  if (!checks.presence_available) {
    return { ok: false, reason: RAW_FRAME_VISION_FLOOR_REASONS.PRESENCE_UNAVAILABLE, checks };
  }
  const host = stringValue(presence.source_host || presence.host || presence.reading_host);
  checks.presence_host_matches = Boolean(expectedHost && host && host === expectedHost);
  if (!checks.presence_host_matches) {
    return { ok: false, reason: RAW_FRAME_VISION_FLOOR_REASONS.PRESENCE_HOST_MISMATCH, checks };
  }
  checks.presence_fresh = isFresh({
    observedAt: parseDate(presence.observed_at),
    expiresAt: parseDate(presence.expires_at),
    evaluatedAt,
    ttlMs: presenceTtlMs,
  });
  if (!checks.presence_fresh) {
    return { ok: false, reason: RAW_FRAME_VISION_FLOOR_REASONS.PRESENCE_STALE, checks };
  }
  checks.presence_person_count_exactly_one = presence.person_count === 1;
  if (!checks.presence_person_count_exactly_one) {
    return { ok: false, reason: RAW_FRAME_VISION_FLOOR_REASONS.PRESENCE_COUNT_NOT_EXACTLY_ONE, checks };
  }
  checks.presence_no_additional_person = presence.additional_person_present === "not_detected";
  if (!checks.presence_no_additional_person) {
    return { ok: false, reason: RAW_FRAME_VISION_FLOOR_REASONS.PRESENCE_ADDITIONAL_PERSON_DETECTED, checks };
  }
  checks.presence_confidence_sufficient = ["medium", "high"].includes(presence.confidence_bucket);
  if (!checks.presence_confidence_sufficient) {
    return { ok: false, reason: RAW_FRAME_VISION_FLOOR_REASONS.PRESENCE_CONFIDENCE_INSUFFICIENT, checks };
  }
  return { ok: true, checks };
}

function evaluateRunPosture(runPosture = {}) {
  const checks = {
    run_posture_seth_present_and_consenting: runPosture.seth_present === true &&
      runPosture.seth_consented_to_visual_egress === true,
  };
  if (!checks.run_posture_seth_present_and_consenting) {
    return { ok: false, reason: RAW_FRAME_VISION_FLOOR_REASONS.RUN_POSTURE_SETH_NOT_CONSENTING, checks };
  }
  return { ok: true, checks };
}

function profileSupportsVision(profile = {}, modality = "") {
  if (profile.vision_input_supported === true || profile.image_input_supported === true) {
    return true;
  }
  const supportedModalities = new Set(normalizeStringArray(
    profile.supported_visual_modalities ||
    profile.vision_modalities ||
    profile.model_context_visual_modalities,
  ));
  if (supportedModalities.has(modality)) {
    return true;
  }
  return false;
}

function isFresh({ observedAt, expiresAt, evaluatedAt, ttlMs } = {}) {
  if (!observedAt) {
    return false;
  }
  const observedMs = observedAt.getTime();
  const evaluatedMs = evaluatedAt.getTime();
  if (observedMs > evaluatedMs) {
    return false;
  }
  if (evaluatedMs - observedMs > ttlMs) {
    return false;
  }
  if (expiresAt && expiresAt.getTime() <= evaluatedMs) {
    return false;
  }
  return true;
}

function isActiveWindow({ issuedAt, expiresAt, evaluatedAt } = {}) {
  if (!issuedAt || !expiresAt) {
    return false;
  }
  const issuedMs = issuedAt.getTime();
  const expiresMs = expiresAt.getTime();
  const evaluatedMs = evaluatedAt.getTime();
  return issuedMs <= evaluatedMs && evaluatedMs < expiresMs;
}

function refusal(reason, checks) {
  return {
    allowed: false,
    reason,
    checks: Object.freeze({ ...checks }),
  };
}

function baseChecks({ evaluatedAt, requestedModality, expectedHost } = {}) {
  return {
    evaluated_at: evaluatedAt.toISOString(),
    modality: requestedModality,
    source_host: expectedHost,
    episode_live: false,
    grant_recovery_clean: false,
    visual_grant_active: false,
    retention_none: false,
    source_subscription_active: false,
    source_subscription_host_matches: false,
    solo_attestation_present: false,
    solo_attestation_fresh: false,
    solo_attestation_non_occupant_writable: false,
    solo_attestation_seth_present_and_consenting: false,
    presence_available: false,
    presence_host_matches: false,
    presence_fresh: false,
    presence_person_count_exactly_one: false,
    presence_no_additional_person: false,
    presence_confidence_sufficient: false,
    run_posture_seth_present_and_consenting: false,
    profile_vision_capable: false,
  };
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

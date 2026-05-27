const REQUIRED_METHODS = [
  "status",
  "describeActive",
  "openSession",
  "cleanupForGrant",
];

export function describeRemoteGraphicalLiveBrokerContract() {
  return {
    contract: "soma.remote_graphical.broker.v1",
    actions: [
      {
        action: "status",
        requires_grant: false,
        live_transport_allowed: false,
      },
      {
        action: "describe_active",
        requires_grant: false,
        live_transport_allowed: false,
      },
      {
        action: "open_session",
        requires_grant: true,
        requires_user_actor: true,
        requires_review: true,
        live_transport_allowed: true,
        must_not_enable: ["video", "input", "recording", "model_delivery"],
      },
      {
        action: "cleanup_for_grant",
        requires_grant: true,
        live_transport_allowed: false,
      },
    ],
    required_methods: [...REQUIRED_METHODS],
    default_enabled: false,
    activation_enabled: false,
  };
}

export function evaluateRemoteGraphicalLiveBrokerReadiness({
  broker = {},
  brokerStatus = {},
  manifest = {},
  activationEnabled = false,
} = {}) {
  const status = normalizeBrokerStatus(brokerStatus);
  const provider = stringValue(manifest.id || status.provider);
  const targetHost = firstString(manifest.target_constraints?.allowed_hosts) || status.target_host;
  const manifestLoaded = Boolean(status.manifest_loaded || manifest.id);

  if (!status.requested || !status.enabled) {
    return readinessResult({
      status,
      provider,
      targetHost,
      manifestLoaded,
      readiness: "runtime_not_enabled",
      reason: "Remote graphical live broker readiness requires explicit runtime opt-in.",
    });
  }

  if (!status.configured) {
    return readinessResult({
      status,
      provider,
      targetHost,
      manifestLoaded,
      readiness: "provider_not_configured",
      reason: "Remote graphical live broker readiness requires configured provider status.",
    });
  }

  if (status.session_open_fixture) {
    return readinessResult({
      status,
      provider,
      targetHost,
      manifestLoaded,
      readiness: "fixture_broker_not_live",
      reason: "Fixture session-open brokers cannot satisfy live broker readiness.",
    });
  }

  if (!manifestLoaded) {
    return readinessResult({
      status,
      provider,
      targetHost,
      manifestLoaded,
      readiness: "runtime_manifest_required",
      reason: "Remote graphical live broker readiness requires a validated repository runtime manifest.",
    });
  }

  if (provider && status.provider && provider !== status.provider) {
    return readinessResult({
      status,
      provider,
      targetHost,
      manifestLoaded,
      readiness: "provider_mismatch",
      reason: "Remote graphical broker status provider does not match the runtime manifest.",
    });
  }

  if (targetHost && status.target_host && targetHost !== status.target_host) {
    return readinessResult({
      status,
      provider,
      targetHost,
      manifestLoaded,
      readiness: "target_host_mismatch",
      reason: "Remote graphical broker status target host does not match the runtime manifest.",
    });
  }

  const missingMethods = REQUIRED_METHODS.filter((method) => typeof broker?.[method] !== "function");
  if (missingMethods.length > 0) {
    return readinessResult({
      status,
      provider,
      targetHost,
      manifestLoaded,
      readiness: "broker_contract_incomplete",
      missingMethods,
      reason: "Remote graphical live broker is missing required interface methods.",
    });
  }

  if (!activationEnabled) {
    return readinessResult({
      status,
      provider,
      targetHost,
      manifestLoaded,
      candidate: true,
      readiness: "activation_guard_disabled",
      reason: "Remote graphical live broker shape is eligible for review, but live activation remains disabled.",
    });
  }

  return readinessResult({
    status,
    provider,
    targetHost,
    manifestLoaded,
    candidate: true,
    ready: true,
    activationEnabled,
    readiness: "ready",
    reason: "Remote graphical live broker readiness checks passed.",
  });
}

function readinessResult({
  status,
  provider = "",
  targetHost = "",
  manifestLoaded = false,
  candidate = false,
  ready = false,
  activationEnabled = false,
  readiness,
  reason,
  missingMethods = [],
} = {}) {
  return {
    ready: Boolean(ready),
    candidate: Boolean(candidate),
    activation_enabled: Boolean(activationEnabled),
    readiness: stringValue(readiness),
    reason: stringValue(reason),
    provider: stringValue(provider),
    target_host: stringValue(targetHost),
    manifest_loaded: Boolean(manifestLoaded),
    broker_requested: Boolean(status.requested),
    broker_enabled: Boolean(status.enabled),
    broker_configured: Boolean(status.configured),
    session_open_fixture: Boolean(status.session_open_fixture),
    missing_methods: [...missingMethods],
    activation_performed: false,
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

function normalizeBrokerStatus(value = {}) {
  return {
    requested: Boolean(value.requested),
    enabled: Boolean(value.enabled),
    configured: Boolean(value.configured),
    session_open_fixture: Boolean(value.session_open_fixture),
    provider: stringValue(value.provider),
    target_host: stringValue(value.target_host ?? value.targetHost),
    manifest_loaded: Boolean(value.manifest_loaded),
  };
}

function firstString(values) {
  return Array.isArray(values) ? stringValue(values[0]) : "";
}

function stringValue(value) {
  return String(value ?? "").trim();
}

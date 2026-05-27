export function decideRemoteGraphicalSessionOpenRouteInvocation({
  broker = {},
  brokerStatus = {},
  liveReadiness = {},
  allowLiveRouteInvocation = false,
} = {}) {
  const status = normalizeBrokerStatus(brokerStatus);
  const hasOpenSession = typeof broker?.openSession === "function";

  if (
    status.requested
    && status.enabled
    && status.configured
    && status.session_open_fixture
  ) {
    if (hasOpenSession) {
      return routeDecision({
        route_mode: "fixture_session_open",
        invoke_fixture: true,
        reason: "Configured fixture broker may be invoked by the current route.",
        status,
      });
    }
    return routeDecision({
      route_mode: "refusal",
      refusal: "fixture_broker_contract_incomplete",
      reason: "Configured fixture broker is missing openSession.",
      status,
    });
  }

  const readiness = normalizeLiveReadiness(liveReadiness);
  if (readiness.ready && allowLiveRouteInvocation) {
    return routeDecision({
      route_mode: "live_session_open",
      invoke_live: true,
      reason: "Live route invocation is explicitly enabled and readiness passed.",
      status,
      readiness,
    });
  }

  if (readiness.ready) {
    return routeDecision({
      route_mode: "refusal",
      refusal: "live_route_invocation_disabled",
      reason: "Live broker readiness passed, but route invocation remains disabled.",
      status,
      readiness,
    });
  }

  if (readiness.candidate) {
    return routeDecision({
      route_mode: "refusal",
      refusal: "live_activation_guard_disabled",
      reason: "Live broker shape is only a candidate; activation guard remains disabled.",
      status,
      readiness,
    });
  }

  return routeDecision({
    route_mode: "refusal",
    refusal: "broker_not_invokable",
    reason: "Remote graphical session-open route has no invokable broker path.",
    status,
    readiness,
  });
}

function routeDecision({
  route_mode,
  refusal = "",
  reason = "",
  invoke_fixture = false,
  invoke_live = false,
  status = {},
  readiness = {},
} = {}) {
  return {
    route_mode: stringValue(route_mode) || "refusal",
    refusal: stringValue(refusal),
    reason: stringValue(reason),
    invoke_fixture: Boolean(invoke_fixture),
    invoke_live: Boolean(invoke_live),
    requested: Boolean(status.requested),
    enabled: Boolean(status.enabled),
    configured: Boolean(status.configured),
    session_open_fixture: Boolean(status.session_open_fixture),
    live_ready: Boolean(readiness.ready),
    live_candidate: Boolean(readiness.candidate),
    live_readiness: stringValue(readiness.readiness),
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
  };
}

function normalizeLiveReadiness(value = {}) {
  return {
    ready: Boolean(value.ready),
    candidate: Boolean(value.candidate),
    readiness: stringValue(value.readiness),
  };
}

function stringValue(value) {
  return String(value ?? "").trim();
}

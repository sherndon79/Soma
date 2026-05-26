export class RemoteGraphicalBroker {
  constructor({
    family = "desktop.remote_graphical",
    provider = "",
    targetHost = "",
    runtimePosture = {},
  } = {}) {
    this.family = stringValue(family) || "desktop.remote_graphical";
    this.provider = stringValue(provider);
    this.targetHost = stringValue(targetHost);
    this.runtimePosture = normalizeRuntimePosture(runtimePosture);
  }

  status() {
    if (this.runtimePosture.configured) {
      return configuredProviderStatus({
        family: this.family,
        provider: this.provider || this.runtimePosture.provider,
        targetHost: this.targetHost || this.runtimePosture.target_host,
        runtimePosture: this.runtimePosture,
      });
    }
    return noProviderStatus({
      family: this.family,
      provider: this.provider,
      targetHost: this.targetHost,
      runtimePosture: this.runtimePosture,
    });
  }

  describeActive() {
    return this.status();
  }
}

export function createRemoteGraphicalBrokerStatus(value = {}) {
  const configured = Boolean(value.configured);
  const requested = Boolean(value.requested ?? value.runtime_requested ?? value.runtimePosture?.requested);
  const enabled = value.enabled === undefined && value.runtimePosture?.enabled === undefined
    ? configured
    : Boolean(value.enabled ?? value.runtimePosture?.enabled);
  const status = {
    family: stringValue(value.family) || "desktop.remote_graphical",
    requested,
    enabled,
    configured,
    session_open_fixture: Boolean(
      value.session_open_fixture
      ?? value.open_session_fixture
      ?? value.fixture_open_session
      ?? value.test_fixture?.open_session,
    ),
    status: stringValue(value.status) || "provider_not_configured",
    state: stringValue(value.state) || "unconfigured",
    provider: stringValue(value.provider),
    target_host: stringValue(value.target_host ?? value.targetHost),
    locality: stringValue(value.locality),
    attended: value.attended === undefined ? null : Boolean(value.attended),
    manifest_loaded: Boolean(value.manifest_loaded ?? value.runtimePosture?.manifest_loaded),
    manifest_status: stringValue(value.manifest_status ?? value.runtimePosture?.manifest_status),
    manifest_source_kind: stringValue(
      value.manifest_source_kind ?? value.runtimePosture?.manifest_source_kind,
    ),
    manifest_source: stringValue(value.manifest_source ?? value.runtimePosture?.manifest_source),
    active_count: nonNegativeInteger(value.active_count),
    sessions: Array.isArray(value.sessions)
      ? value.sessions.map(publicRemoteGraphicalSession)
      : [],
    summary: stringValue(value.summary) || "Remote graphical broker is not configured.",
    activation_performed: false,
    durable: false,
    grant_written: false,
    session_opened: false,
    pairing_performed: false,
    video_attached: false,
    input_dispatched: false,
    recording_started: false,
    provider_session_stopped: false,
    model_delivery: false,
    live_transport_used: false,
  };
  status.active_count = status.sessions.length > 0 ? status.sessions.length : status.active_count;
  return status;
}

function noProviderStatus({ family, provider, targetHost, runtimePosture: rawRuntimePosture } = {}) {
  const runtimePosture = normalizeRuntimePosture(rawRuntimePosture);
  const summary = runtimePosture.requested
    ? "Remote graphical broker opt-in requested, but no provider is configured."
    : "Remote graphical broker is not configured.";
  return createRemoteGraphicalBrokerStatus({
    family,
    runtimePosture,
    configured: false,
    status: "provider_not_configured",
    state: "unconfigured",
    provider,
    target_host: targetHost,
    active_count: 0,
    sessions: [],
    summary,
  });
}

function configuredProviderStatus({ family, provider, targetHost, runtimePosture: rawRuntimePosture } = {}) {
  const runtimePosture = normalizeRuntimePosture(rawRuntimePosture);
  return createRemoteGraphicalBrokerStatus({
    family,
    runtimePosture,
    configured: true,
    enabled: false,
    status: "provider_manifest_configured",
    state: "configured_inactive",
    provider,
    target_host: targetHost,
    locality: runtimePosture.locality,
    attended: runtimePosture.attended,
    manifest_loaded: runtimePosture.manifest_loaded,
    manifest_status: runtimePosture.manifest_status,
    manifest_source_kind: runtimePosture.manifest_source_kind,
    manifest_source: runtimePosture.manifest_source,
    active_count: 0,
    sessions: [],
    summary: runtimePosture.summary
      || "Remote graphical provider manifest is configured; live broker activation remains disabled.",
  });
}

function publicRemoteGraphicalSession(session = {}) {
  return {
    session_id: stringValue(session.session_id ?? session.id),
    target_host: stringValue(session.target_host ?? session.targetHost),
    provider: stringValue(session.provider),
    state: stringValue(session.state) || "unknown",
    locality: stringValue(session.locality),
    attended: session.attended === undefined ? null : Boolean(session.attended),
    active_authorities: stringList(session.active_authorities),
    input_channels: stringList(session.input_channels),
    video: plainObject(session.video),
    recording: Boolean(session.recording),
    model_delivery: Boolean(session.model_delivery),
    expires_at: stringValue(session.expires_at),
  };
}

function stringList(value) {
  return Array.isArray(value) ? value.map((entry) => stringValue(entry)).filter(Boolean) : [];
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...value };
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function stringValue(value) {
  return String(value ?? "").trim();
}

function normalizeRuntimePosture(value = {}) {
  return {
    requested: Boolean(value.requested),
    enabled: Boolean(value.enabled),
    configured: Boolean(value.configured),
    provider: stringValue(value.provider),
    target_host: stringValue(value.target_host ?? value.targetHost),
    locality: stringValue(value.locality),
    attended: value.attended === undefined ? null : Boolean(value.attended),
    manifest_loaded: Boolean(value.manifest_loaded),
    manifest_status: stringValue(value.manifest_status),
    manifest_source_kind: stringValue(value.manifest_source_kind),
    manifest_source: stringValue(value.manifest_source),
    summary: stringValue(value.summary),
  };
}

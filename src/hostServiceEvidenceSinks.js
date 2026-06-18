export function createHostServiceEvidenceSinks() {
  const sinks = {
    results: [],
    provenance: [],
    errors: [],
    cache: [],
    logs: [],
  };
  return Object.freeze({
    recordResult(result = {}) {
      sinks.results.push(allowlistedResult(result));
    },
    recordProvenance(event = {}) {
      sinks.provenance.push(allowlistedProvenance(event));
    },
    recordError(error = {}) {
      sinks.errors.push(Object.freeze({
        code: String(error.code ?? "service_status_unavailable").slice(0, 128),
        status_code: Number(error.statusCode ?? 500),
      }));
    },
    cacheResult(result = {}) {
      sinks.cache.push(allowlistedResult(result));
    },
    log(event = {}) {
      sinks.logs.push(Object.freeze({
        event_type: String(event.event_type ?? "").slice(0, 128),
        code: String(event.code ?? "").slice(0, 128),
        outcome: String(event.outcome ?? "").slice(0, 64),
      }));
    },
    snapshot() {
      return structuredClone(sinks);
    },
  });
}

function allowlistedResult(result) {
  return Object.freeze({
    service_handle: String(result.service_handle ?? ""),
    observation_generation: String(result.observation_generation ?? ""),
    load_state: String(result.load_state ?? "unknown"),
    active_state: String(result.active_state ?? "unknown"),
    sub_state: String(result.sub_state ?? "unknown"),
    unit_file_state_class: String(result.unit_file_state_class ?? "unknown"),
    can_restart: result.can_restart === true,
    restart_policy_class: String(result.restart_policy_class ?? "unknown"),
    state_changed_at_bucket: String(result.state_changed_at_bucket ?? "unknown"),
    healthy: result.healthy === true,
    content_included: false,
    identifiers_included: false,
  });
}

function allowlistedProvenance(event) {
  return Object.freeze({
    event_type: String(event.event_type ?? ""),
    code: String(event.code ?? ""),
    capability: String(event.capability ?? ""),
    provider: String(event.provider ?? ""),
    domain: String(event.domain ?? ""),
    task_id: String(event.task_id ?? ""),
    grant_id: String(event.grant_id ?? ""),
    descriptor_digest: String(event.descriptor_digest ?? ""),
    outcome: String(event.outcome ?? ""),
    content_included: false,
    identifiers_included: false,
  });
}

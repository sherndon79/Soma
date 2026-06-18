import { createHash } from "node:crypto";

import {
  HOST_SERVICE_SYNTHETIC_PROVIDER_ID,
  hostServiceError,
  normalizeHostServiceStatus,
} from "./hostServiceContracts.js";

export function createSyntheticHostServiceProvider({ fixtures = {}, now = () => Date.now() } = {}) {
  const fixtureMap = new Map(Object.entries(fixtures).map(([key, value]) => [key, structuredClone(value)]));
  const invocationCounts = new Map();
  return Object.freeze({
    provider_id: HOST_SERVICE_SYNTHETIC_PROVIDER_ID,
    readStatusRaw(descriptor = {}) {
      if (descriptor.domain !== "testing" || descriptor.synthetic !== true) {
        throw hostServiceError(
          "service_testing_live_fallthrough_denied",
          "Synthetic service provider accepts testing descriptors only.",
          403,
        );
      }
      const fixture = fixtureMap.get(String(descriptor.fixture_id ?? ""));
      if (!fixture) {
        throw hostServiceError("service_status_unavailable", "Synthetic service fixture is unavailable.", 503);
      }
      return structuredClone(fixture.status);
    },
    inspectForPlan(descriptor = {}) {
      const fixture = requireFixture(descriptor, fixtureMap);
      return internalObservation({ descriptor, fixture, now });
    },
    restart(descriptor = {}) {
      const fixture = requireFixture(descriptor, fixtureMap);
      const count = (invocationCounts.get(descriptor.fixture_id) ?? 0) + 1;
      invocationCounts.set(descriptor.fixture_id, count);
      if (fixture.apply_mode === "refused") {
        throw hostServiceError("service_restart_provider_refused", "Synthetic provider refused restart.", 409);
      }
      if (fixture.apply_mode === "ambiguous_without_apply") {
        const error = hostServiceError("service_restart_outcome_unknown", "Synthetic restart outcome is ambiguous.", 503);
        error.ambiguous = true;
        throw error;
      }
      fixture.status = {
        ...fixture.status,
        ...(fixture.post_restart_status ?? {}),
      };
      fixture.invocation_id = fixture.post_restart_invocation_id ?? `synthetic-invocation-${count}`;
      fixture.activation_timestamp = Number(fixture.activation_timestamp ?? 0) + 1;
      if (fixture.apply_mode === "ambiguous_after_apply") {
        const error = hostServiceError("service_restart_outcome_unknown", "Synthetic restart response was lost.", 503);
        error.ambiguous = true;
        throw error;
      }
      return Object.freeze({ accepted: true, invocation_attempt: count });
    },
    invocationCount(fixtureId) {
      return invocationCounts.get(String(fixtureId ?? "")) ?? 0;
    },
    mutateFixture(fixtureId, patch = {}) {
      const current = fixtureMap.get(String(fixtureId ?? ""));
      if (!current) {
        return false;
      }
      fixtureMap.set(String(fixtureId), { ...current, ...structuredClone(patch) });
      return true;
    },
  });
}

function requireFixture(descriptor, fixtureMap) {
  if (descriptor.domain !== "testing" || descriptor.synthetic !== true) {
    throw hostServiceError(
      "service_testing_live_fallthrough_denied",
      "Synthetic service provider accepts testing descriptors only.",
      403,
    );
  }
  const fixture = fixtureMap.get(String(descriptor.fixture_id ?? ""));
  if (!fixture) {
    throw hostServiceError("service_status_unavailable", "Synthetic service fixture is unavailable.", 503);
  }
  return fixture;
}

function internalObservation({ descriptor, fixture, now }) {
  const status = normalizeHostServiceStatus(fixture.status, {
    serviceHandle: descriptor.service_handle,
    observationGeneration: createHash("sha256")
      .update(`${descriptor.descriptor_digest}:${fixture.generation ?? "0"}:${fixture.invocation_id ?? "initial"}:${now()}`)
      .digest("hex"),
  });
  return Object.freeze({
    ...status,
    runtime_state_digest: createHash("sha256").update(JSON.stringify({
      load_state: status.load_state,
      active_state: status.active_state,
      sub_state: status.sub_state,
      invocation_id: fixture.invocation_id ?? "initial",
      activation_timestamp: fixture.activation_timestamp ?? 0,
    })).digest("hex"),
    unit_definition_digest: createHash("sha256").update(JSON.stringify(fixture.effective_definition ?? {})).digest("hex"),
    definition_digest_schema: "soma.systemd.effective-definition.v1",
    target_binding_digest: createHash("sha256").update(`${descriptor.descriptor_digest}:${descriptor.fixture_id}`).digest("hex"),
    affected_closure: fixture.affected_closure ?? "target_only",
    invocation_id: String(fixture.invocation_id ?? "initial"),
    activation_timestamp: Number(fixture.activation_timestamp ?? 0),
  });
}

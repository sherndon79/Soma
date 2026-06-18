import { HOST_SERVICE_REFUSAL_CODES, hostServiceError } from "./hostServiceContracts.js";

const RECOVERY_COMPONENTS = [
  "inventory",
  "grant",
  "handle",
  "plan",
  "confirmation",
  "lock",
  "provenance",
];

export function createHostServiceOperationState() {
  const tasks = new Map();
  const recovery = new Map(RECOVERY_COMPONENTS.map((component) => [component, "healthy"]));
  const locks = new Set();
  const provenance = [];
  let provenanceAppendFailure = false;

  return Object.freeze({
    registerTask(task) {
      tasks.set(String(task?.task_id ?? ""), true);
    },
    closeTask(taskId) {
      tasks.set(String(taskId ?? ""), false);
    },
    assertTaskActive(taskId) {
      if (tasks.get(String(taskId ?? "")) !== true) {
        throw hostServiceError("service_task_not_active", "Service task lifecycle is closed.", 403);
      }
    },
    setRecovery(component, state) {
      if (!RECOVERY_COMPONENTS.includes(component) || !["healthy", "missing", "corrupt"].includes(state)) {
        throw new TypeError("Unknown service recovery component or state.");
      }
      recovery.set(component, state);
    },
    assertRecoveryHealthy() {
      const degraded = RECOVERY_COMPONENTS.find((component) => recovery.get(component) !== "healthy");
      if (degraded) {
        throw hostServiceError(
          "service_recovery_degraded",
          "Service recovery state is non-authorizing.",
          503,
          { component: degraded },
        );
      }
    },
    acquireLock(planId) {
      this.assertRecoveryHealthy();
      const key = String(planId ?? "");
      if (!key || locks.has(key)) {
        throw hostServiceError("service_restart_concurrent_operation", "Service restart lock is unavailable.", 409);
      }
      locks.add(key);
      return key;
    },
    releaseLock(lockId) {
      locks.delete(String(lockId ?? ""));
    },
    activeLockCount() {
      return locks.size;
    },
    appendProvenance(event = {}) {
      if (recovery.get("provenance") !== "healthy" || provenanceAppendFailure) {
        throw hostServiceError("service_recovery_degraded", "Service provenance append failed.", 503);
      }
      provenance.push(sanitizeProvenanceEvent(event));
    },
    setProvenanceAppendFailure(enabled) {
      provenanceAppendFailure = enabled === true;
    },
    provenanceEvents() {
      return provenance.map((event) => ({ ...event }));
    },
    teardownTask(taskId) {
      this.closeTask(taskId);
      for (const lock of [...locks]) {
        if (lock.startsWith(`${taskId}:`)) {
          locks.delete(lock);
        }
      }
    },
  });
}

function sanitizeProvenanceEvent(event) {
  return Object.freeze({
    event_type: enumValue(event.event_type, [
      "host.service.restart.provider_invoked",
      "host.service.restart.verification_result",
    ], "host.service.restart.verification_result"),
    capability: event.capability === "host.service.restart" ? "host.service.restart" : "",
    provider: bounded(event.provider),
    domain: bounded(event.domain),
    task_id: bounded(event.task_id),
    grant_id: bounded(event.grant_id),
    plan_digest: bounded(event.plan_digest),
    outcome: enumValue(event.outcome, [
      "invoked",
      "verified_success",
      "verified_failure",
      "outcome_unknown",
    ], "outcome_unknown"),
    code: HOST_SERVICE_REFUSAL_CODES.includes(String(event.code ?? ""))
      ? String(event.code)
      : "",
    possibly_applied: event.possibly_applied === true,
    reconciliation_required: event.reconciliation_required === true,
    content_included: false,
    identifiers_included: false,
  });
}

function enumValue(value, allowed, fallback) {
  const normalized = String(value ?? "");
  return allowed.includes(normalized) ? normalized : fallback;
}

function bounded(value) {
  return String(value ?? "").slice(0, 256);
}

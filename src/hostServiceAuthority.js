import {
  HOST_SERVICE_RESTART_CAPABILITY,
  HOST_SERVICE_STATUS_CAPABILITY,
  hostServiceError,
} from "./hostServiceContracts.js";

const CONSEQUENCE_ORDER = new Map([["C0", 0], ["C1", 1], ["C2", 2], ["C3", 3], ["C4", 4]]);

export function validateHostServiceTaskEnvelope(input = {}, { now = () => Date.now() } = {}) {
  const taskId = requiredString(input.task_id, "task_id");
  const expiresAt = timestamp(input.expires_at, "expires_at");
  if (expiresAt <= now()) {
    throw hostServiceError("service_task_not_active", "Service task envelope is expired.", 403);
  }
  const allowedCapabilities = uniqueStrings(input.allowed_capabilities);
  if (!allowedCapabilities.includes(HOST_SERVICE_STATUS_CAPABILITY)) {
    throw hostServiceError("service_task_scope_denied", "Service task must explicitly allow status read.", 403);
  }
  for (const capability of allowedCapabilities) {
    if (![HOST_SERVICE_STATUS_CAPABILITY, HOST_SERVICE_RESTART_CAPABILITY].includes(capability)) {
      throw hostServiceError("service_task_scope_denied", "Service task contains an unsupported capability.", 403);
    }
  }
  const consequenceCeiling = requiredConsequenceClass(input.consequence_ceiling);
  if (consequenceCeiling === "C4") {
    throw hostServiceError("service_task_scope_denied", "C4 is prohibited and cannot be a task ceiling.", 403);
  }
  return Object.freeze({
    task_id: taskId,
    objective: requiredString(input.objective, "objective"),
    host_id: requiredString(input.host_id, "host_id"),
    allowed_service_inventory_ids: Object.freeze(uniqueStrings(input.allowed_service_inventory_ids)),
    allowed_capabilities: Object.freeze(allowedCapabilities),
    consequence_ceiling: consequenceCeiling,
    expires_at: expiresAt,
    max_status_reads: positiveInteger(input.max_status_reads, "max_status_reads"),
    max_restart_plans: nonNegativeInteger(input.max_restart_plans ?? 0, "max_restart_plans"),
    max_successful_restarts: boundedRestartCount(input.max_successful_restarts ?? 0),
    route: input.route === "local" ? "local" : fail("service_task_scope_denied", "Service task route must be local."),
    model_egress: input.model_egress === "none" ? "none" : fail("service_task_scope_denied", "Service task model egress must be none."),
    teardown: "destroy_task_authority",
  });
}

export function authorizeHostServiceRequest({
  capability,
  task,
  grant,
  inventory_id,
  provider_id,
  domain,
  now = () => Date.now(),
} = {}) {
  if (!task || task.expires_at <= now()) {
    throw hostServiceError("service_task_not_active", "Service task envelope is not active.", 403);
  }
  if (!task.allowed_capabilities.includes(capability)) {
    throw hostServiceError("service_task_scope_denied", "Capability is outside the service task envelope.", 403);
  }
  if (!task.allowed_service_inventory_ids.includes(String(inventory_id ?? ""))) {
    throw hostServiceError("service_task_scope_denied", "Service is outside the task envelope.", 403);
  }
  validateGrant({ capability, task, grant, inventory_id, provider_id, domain, now });
  const requiredClass = capability === HOST_SERVICE_RESTART_CAPABILITY ? "C3" : "C0";
  if ((CONSEQUENCE_ORDER.get(task.consequence_ceiling) ?? -1) < CONSEQUENCE_ORDER.get(requiredClass)) {
    if (capability === HOST_SERVICE_RESTART_CAPABILITY) {
      throw hostServiceError(
        "service_restart_classification_c3",
        "Service restart is C3 and requires exact local confirmation in addition to the task envelope.",
        403,
      );
    }
    throw hostServiceError("service_task_scope_denied", "Task consequence ceiling is too low.", 403);
  }
  return Object.freeze({
    capability,
    task_id: task.task_id,
    grant_id: grant.id,
    provider_id,
    domain,
    inventory_id,
    consequence_class: requiredClass,
  });
}

export function createHostServiceTaskLedger() {
  const counters = new Map();
  return Object.freeze({
    recordStatusRead(task) {
      return increment(task, "status_reads", task.max_status_reads);
    },
    recordRestartPlan(task) {
      return increment(task, "restart_plans", task.max_restart_plans);
    },
    recordRestartAcceptance(task) {
      return increment(task, "restart_acceptances", task.max_successful_restarts);
    },
    clearTask(taskId) {
      counters.delete(String(taskId ?? ""));
    },
    snapshot(taskId) {
      return Object.freeze({ ...(counters.get(String(taskId ?? "")) ?? emptyCounters()) });
    },
  });

  function increment(task, field, limit) {
    const taskId = String(task?.task_id ?? "");
    if (!taskId) {
      throw hostServiceError("service_task_not_active", "Task usage requires an active task.", 403);
    }
    const current = counters.get(taskId) ?? emptyCounters();
    if (current[field] >= limit) {
      throw hostServiceError("service_task_scope_denied", `Service task ${field} limit is exhausted.`, 403);
    }
    const next = { ...current, [field]: current[field] + 1 };
    counters.set(taskId, next);
    return next[field];
  }
}

function validateGrant({ capability, task, grant, inventory_id, provider_id, domain, now }) {
  if (!grant || grant.status !== "active" || grant.capability !== capability || grant.provider !== provider_id) {
    throw hostServiceError(
      capability === HOST_SERVICE_RESTART_CAPABILITY
        ? "service_restart_grant_required"
        : "service_task_scope_denied",
      "An active exact capability and provider grant is required.",
      403,
    );
  }
  if (capability === HOST_SERVICE_RESTART_CAPABILITY && grant.scope !== "once") {
    throw hostServiceError("service_restart_grant_required", "Service restart requires a once-scoped grant.", 403);
  }
  const constraints = grant.constraints && typeof grant.constraints === "object" ? grant.constraints : {};
  const expected = {
    task_id: task.task_id,
    host_id: task.host_id,
    service_inventory_id: String(inventory_id ?? ""),
    domain: String(domain ?? ""),
  };
  for (const [key, value] of Object.entries(expected)) {
    if (String(constraints[key] ?? "") !== value) {
      throw hostServiceError("service_task_scope_denied", "Service grant constraints do not match the request.", 403);
    }
  }
  if (constraints.expires_at !== undefined && timestamp(constraints.expires_at, "grant.constraints.expires_at") <= now()) {
    throw hostServiceError("service_task_not_active", "Service grant constraints are expired.", 403);
  }
}

function requiredConsequenceClass(value) {
  const normalized = String(value ?? "").trim();
  if (!CONSEQUENCE_ORDER.has(normalized)) {
    throw hostServiceError("service_task_scope_denied", "Service task consequence ceiling is invalid.", 403);
  }
  return normalized;
}

function timestamp(value, field) {
  const result = typeof value === "number" ? value : Date.parse(String(value ?? ""));
  if (!Number.isFinite(result)) {
    throw hostServiceError("service_task_scope_denied", `Service task ${field} is invalid.`, 403);
  }
  return result;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw hostServiceError("service_task_scope_denied", `Service task ${field} must be a positive integer.`, 403);
  }
  return number;
}

function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw hostServiceError("service_task_scope_denied", `Service task ${field} must be a non-negative integer.`, 403);
  }
  return number;
}

function boundedRestartCount(value) {
  const number = nonNegativeInteger(value, "max_successful_restarts");
  if (number > 1) {
    throw hostServiceError("service_task_scope_denied", "Service task permits at most one successful restart.", 403);
  }
  return number;
}

function requiredString(value, field) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 512) {
    throw hostServiceError("service_task_scope_denied", `Service task requires a bounded ${field}.`, 403);
  }
  return text;
}

function fail(code, message) {
  throw hostServiceError(code, message, 403);
}

function emptyCounters() {
  return {
    status_reads: 0,
    restart_plans: 0,
    restart_acceptances: 0,
  };
}

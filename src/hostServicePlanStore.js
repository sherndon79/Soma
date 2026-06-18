import { createHash, randomBytes } from "node:crypto";

import { hostServiceError } from "./hostServiceContracts.js";

export function createHostServicePlanStore({
  now = () => Date.now(),
  random = () => randomBytes(24).toString("hex"),
  ttlMs = 2 * 60_000,
} = {}) {
  const plans = new Map();

  return Object.freeze({
    create({ authorization, descriptor, observation, task, taskLedger, timeout_ms = 15_000 } = {}) {
      assertPlanInput({ authorization, descriptor, observation });
      if (!taskLedger || task?.task_id !== authorization.task_id) {
        throw hostServiceError("service_task_not_active", "Restart planning requires the active task ledger.", 403);
      }
      taskLedger.recordRestartPlan(task);
      const createdAt = now();
      const planId = `plan_${random()}`;
      const artifact = {
        schema_version: 1,
        plan_id: planId,
        task_id: authorization.task_id,
        grant_id: authorization.grant_id,
        provider_id: authorization.provider_id,
        domain: authorization.domain,
        service_handle: descriptor.service_handle,
        descriptor_digest: descriptor.descriptor_digest,
        observation_generation: observation.observation_generation,
        runtime_state_digest: observation.runtime_state_digest,
        unit_definition_digest: observation.unit_definition_digest,
        definition_digest_schema: observation.definition_digest_schema,
        target_binding_digest: observation.target_binding_digest,
        operation: "restart",
        consequence_class: "C3",
        consequence_reason: "Restart interruption and external effects have no rollback artifact.",
        expected_final_state: Object.freeze({ active_state: "active", sub_state: "running" }),
        timeout_ms: boundedTimeout(timeout_ms),
        requested_target_count: 1,
        affected_closure: "target_only",
        rollback_posture: "not_reversible",
        recovery_posture: "observe_report_never_retry_automatically",
        confirmation_required: true,
        created_at: createdAt,
        expires_at: createdAt + ttlMs,
      };
      const planDigest = digest(artifact);
      const stored = Object.freeze({
        ...artifact,
        plan_digest: planDigest,
        consumed: false,
        invalidated: false,
        invalidation_code: "",
      });
      plans.set(planId, stored);
      return stored;
    },
    requireActive({ plan_id, plan_digest, task_id, grant_id, now_ms = now() } = {}) {
      const plan = plans.get(String(plan_id ?? ""));
      if (
        !plan
        || plan.plan_digest !== String(plan_digest ?? "")
        || plan.task_id !== String(task_id ?? "")
        || plan.grant_id !== String(grant_id ?? "")
      ) {
        throw hostServiceError("service_restart_plan_stale", "Restart plan is invalid.", 409);
      }
      if (plan.invalidated || plan.consumed || plan.expires_at <= now_ms) {
        throw hostServiceError("service_restart_plan_stale", "Restart plan is no longer active.", 409);
      }
      return plan;
    },
    consume(planId) {
      const plan = plans.get(String(planId ?? ""));
      if (!plan || plan.invalidated || plan.consumed) {
        throw hostServiceError("service_restart_plan_stale", "Restart plan cannot be consumed.", 409);
      }
      plans.set(plan.plan_id, Object.freeze({ ...plan, consumed: true }));
    },
    invalidate(planId, code = "service_restart_plan_stale") {
      const plan = plans.get(String(planId ?? ""));
      if (!plan || plan.consumed) {
        return false;
      }
      plans.set(plan.plan_id, Object.freeze({
        ...plan,
        invalidated: true,
        invalidation_code: String(code ?? "service_restart_plan_stale"),
      }));
      return true;
    },
    clearTask(taskId) {
      for (const [planId, plan] of plans) {
        if (plan.task_id === taskId) {
          plans.delete(planId);
        }
      }
    },
    snapshot(planId) {
      return plans.get(String(planId ?? "")) ?? null;
    },
  });
}

export function renderLocalHostServicePlanPreview(plan = {}, { target_label = "" } = {}) {
  if (!target_label) {
    throw hostServiceError("service_restart_confirmation_required", "Local preview requires an exact target label.");
  }
  return Object.freeze({
    preview_schema: 1,
    plan_id: plan.plan_id,
    plan_digest: plan.plan_digest,
    exact_target: String(target_label),
    current_state: "active/running",
    definition_fingerprint: plan.unit_definition_digest,
    definition_matches_reviewed_inventory: true,
    expected_interruption: true,
    affected_set: "exact target only",
    timeout_ms: plan.timeout_ms,
    rollback: "none",
    verification: "new InvocationID and active/running postcondition",
    consequence_class: "C3",
    expires_at: plan.expires_at,
  });
}

export function renderLocalHostServicePlanPreviewFromHandle({
  plan,
  handles,
  inventory,
  task_id,
  grant_id,
  provider_id,
  domain,
} = {}) {
  const entry = handles.resolve({
    handle: plan?.service_handle,
    inventory,
    task_id,
    grant_id,
    provider_id,
    domain,
  });
  return renderLocalHostServicePlanPreview(plan, { target_label: entry.unit_name });
}

function assertPlanInput({ authorization, descriptor, observation }) {
  const syntheticTesting = descriptor?.domain === "testing" && descriptor?.synthetic === true;
  const controlledRealTesting = descriptor?.domain === "testing"
    && descriptor?.synthetic === false
    && descriptor?.provider_mode === "real_systemd_controlled_test";
  if (authorization?.capability !== "host.service.restart" || authorization?.consequence_class !== "C3") {
    throw hostServiceError("service_restart_classification_c3", "Restart planning requires C3 authorization context.", 403);
  }
  if (
    (!syntheticTesting && !controlledRealTesting)
    || descriptor?.provider_id !== authorization.provider_id
    || descriptor?.task_id !== authorization.task_id
    || descriptor?.grant_id !== authorization.grant_id
  ) {
    throw hostServiceError("service_restart_plan_stale", "Restart descriptor does not match authorization.", 409);
  }
  if (
    observation?.load_state !== "loaded"
    || observation?.active_state !== "active"
    || observation?.sub_state !== "running"
    || observation?.can_restart !== true
  ) {
    throw hostServiceError("service_restart_prestate_unsupported", "Restart pre-state is unsupported.", 409);
  }
  for (const field of [
    "observation_generation",
    "runtime_state_digest",
    "unit_definition_digest",
    "definition_digest_schema",
    "target_binding_digest",
  ]) {
    if (!String(observation?.[field] ?? "")) {
      throw hostServiceError("service_restart_plan_stale", `Restart observation lacks ${field}.`, 409);
    }
  }
  if (observation.affected_closure !== "target_only") {
    throw hostServiceError("service_unit_dependency_closure_unsafe", "Restart affected closure is not target-only.", 403);
  }
}

function boundedTimeout(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1_000 || number > 60_000) {
    throw hostServiceError("service_restart_plan_stale", "Restart timeout is outside allowed bounds.", 400);
  }
  return number;
}

function digest(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

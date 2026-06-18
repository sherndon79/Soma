import { authorizeHostServiceRequest } from "./hostServiceAuthority.js";
import { hostServiceError } from "./hostServiceContracts.js";

export function createHostServiceRestartRuntime({
  planStore,
  confirmationAuthority,
  provider,
  taskLedger,
  now = () => Date.now(),
} = {}) {
  const consumedGrantIds = new Set();
  const applyAttempts = new Map();

  return Object.freeze({
    applyAndVerify({ plan_id, plan_digest, task, grant, descriptor, confirmation_receipt_id } = {}) {
      const plan = planStore.requireActive({
        plan_id,
        plan_digest,
        task_id: task?.task_id,
        grant_id: grant?.id,
      });
      authorizeHostServiceRequest({
        capability: "host.service.restart",
        task,
        grant,
        inventory_id: descriptor?.unit_inventory_id,
        provider_id: descriptor?.provider_id,
        domain: descriptor?.domain,
        now,
      });
      assertApplyBindings({ plan, task, grant, descriptor, consumedGrantIds, now });
      const receipt = confirmationAuthority.requireMatching({
        receipt_id: confirmation_receipt_id,
        plan,
      });

      const finalObservation = provider.inspectForPlan(descriptor);
      if (finalObservation.unit_definition_digest !== plan.unit_definition_digest) {
        planStore.invalidate(plan.plan_id, "service_unit_definition_drift");
        throw hostServiceError("service_unit_definition_drift", "Service definition changed after confirmation.", 409);
      }
      if (finalObservation.affected_closure !== "target_only") {
        planStore.invalidate(plan.plan_id, "service_unit_dependency_closure_unsafe");
        throw hostServiceError("service_unit_dependency_closure_unsafe", "Service affected closure changed after confirmation.", 409);
      }
      if (finalObservation.runtime_state_digest !== plan.runtime_state_digest) {
        planStore.invalidate(plan.plan_id, "service_restart_plan_stale");
        throw hostServiceError("service_restart_plan_stale", "Service runtime state changed after planning.", 409);
      }

      // Acceptance consumes the outer restart budget even when the outcome is unknown.
      taskLedger.recordRestartAcceptance(task);
      consumedGrantIds.add(grant.id);
      planStore.consume(plan.plan_id);
      confirmationAuthority.consume(receipt.receipt_id);
      applyAttempts.set(plan.plan_id, (applyAttempts.get(plan.plan_id) ?? 0) + 1);

      let applyError = null;
      try {
        provider.restart(descriptor);
      } catch (error) {
        applyError = error;
        if (!error?.ambiguous) {
          return outcome("verified_failure", error.code ?? "service_restart_provider_refused", plan);
        }
      }

      const verification = provider.inspectForPlan(descriptor);
      const invocationChanged = verification.invocation_id !== finalObservation.invocation_id;
      const healthy = verification.load_state === "loaded"
        && verification.active_state === "active"
        && verification.sub_state === "running"
        && verification.healthy === true;
      if (invocationChanged && healthy) {
        return outcome("verified_success", "", plan, verification);
      }
      if (verification.active_state === "failed" || verification.sub_state === "failed") {
        return outcome("verified_failure", "service_restart_verify_failed", plan, verification);
      }
      return outcome(
        "outcome_unknown",
        applyError?.code ?? "service_restart_outcome_unknown",
        plan,
        verification,
      );
    },
    applyAttemptCount(planId) {
      return applyAttempts.get(String(planId ?? "")) ?? 0;
    },
    grantConsumed(grantId) {
      return consumedGrantIds.has(String(grantId ?? ""));
    },
  });
}

function assertApplyBindings({ plan, task, grant, descriptor, consumedGrantIds, now }) {
  if (
    !task
    || task.expires_at <= now()
    || task.consequence_ceiling !== "C3"
    || !task.allowed_capabilities.includes("host.service.restart")
  ) {
    throw hostServiceError("service_task_not_active", "C3 service task is not active.", 403);
  }
  if (
    !grant
    || grant.status !== "active"
    || grant.scope !== "once"
    || grant.capability !== "host.service.restart"
    || grant.provider !== plan.provider_id
    || consumedGrantIds.has(grant.id)
  ) {
    throw hostServiceError("service_restart_grant_required", "Active unconsumed once restart grant is required.", 403);
  }
  if (
    descriptor.domain !== "testing"
    || descriptor.synthetic !== true
    || descriptor.descriptor_digest !== plan.descriptor_digest
    || descriptor.service_handle !== plan.service_handle
    || descriptor.task_id !== plan.task_id
    || descriptor.grant_id !== plan.grant_id
  ) {
    throw hostServiceError("service_restart_plan_stale", "Apply descriptor does not match the exact plan.", 409);
  }
}

function outcome(status, code, plan, verification = {}) {
  return Object.freeze({
    outcome: status,
    code,
    plan_id: plan.plan_id,
    plan_digest: plan.plan_digest,
    provider: plan.provider_id,
    domain: plan.domain,
    invocation_evidence_changed: status === "verified_success",
    healthy: verification.healthy === true,
    content_included: false,
    identifiers_included: false,
    automatic_retry_performed: false,
  });
}

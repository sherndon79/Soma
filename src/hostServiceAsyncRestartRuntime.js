import { authorizeHostServiceRequest } from "./hostServiceAuthority.js";
import { HOST_SERVICE_REFUSAL_CODES, hostServiceError } from "./hostServiceContracts.js";

export function createAsyncHostServiceRestartRuntime({
  planStore,
  confirmationAuthority,
  provider,
  taskLedger,
  operationState,
  hostServiceAuthority,
  finalBoundary = async () => {},
  now = () => Date.now(),
} = {}) {
  const consumedGrantIds = new Set();
  const applyAttempts = new Map();

  return Object.freeze({
    async applyAndVerify({
      plan_id,
      plan_digest,
      task,
      grant,
      descriptor,
      confirmation_receipt_id,
    } = {}) {
      operationState.assertRecoveryHealthy();
      operationState.assertTaskActive(task?.task_id);
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
      const lockId = operationState.acquireLock(`${task.task_id}:${plan.plan_id}`);
      try {
        await finalBoundary();
        operationState.assertRecoveryHealthy();
        operationState.assertTaskActive(task.task_id);
        planStore.requireActive({
          plan_id,
          plan_digest,
          task_id: task.task_id,
          grant_id: grant.id,
        });
        authorizeHostServiceRequest({
          capability: "host.service.restart",
          task,
          grant,
          inventory_id: descriptor.unit_inventory_id,
          provider_id: descriptor.provider_id,
          domain: descriptor.domain,
          now,
        });
        confirmationAuthority.requireMatching({ receipt_id: confirmation_receipt_id, plan });
        hostServiceAuthority.handles.resolve({
          handle: descriptor.service_handle,
          inventory: hostServiceAuthority.currentInventory(),
          task_id: task.task_id,
          grant_id: grant.id,
          provider_id: descriptor.provider_id,
          domain: descriptor.domain,
        });

        const finalObservation = await provider.inspectForPlan(descriptor);
        assertFinalObservation({ finalObservation, plan, planStore });

        taskLedger.recordRestartAcceptance(task);
        consumedGrantIds.add(grant.id);
        planStore.consume(plan.plan_id);
        confirmationAuthority.consume(receipt.receipt_id);
        applyAttempts.set(plan.plan_id, (applyAttempts.get(plan.plan_id) ?? 0) + 1);

        let applyError = null;
        try {
          await provider.restart(descriptor);
        } catch (error) {
          applyError = normalizedProviderError(error);
          if (!error?.ambiguous) {
            return verificationOutcome({
              operationState,
              status: "verified_failure",
              code: applyError.code,
              plan,
              possiblyApplied: false,
            });
          }
        }

        try {
          operationState.appendProvenance({
            event_type: "host.service.restart.provider_invoked",
            capability: "host.service.restart",
            provider: plan.provider_id,
            domain: plan.domain,
            task_id: plan.task_id,
            grant_id: plan.grant_id,
            plan_digest: plan.plan_digest,
            outcome: applyError ? "outcome_unknown" : "invoked",
            code: applyError?.code ?? "",
            possibly_applied: true,
          });
        } catch {
          return outcome("outcome_unknown", "service_recovery_degraded", plan, {}, {
            possibly_applied: true,
            reconciliation_required: true,
          });
        }

        const verification = await provider.inspectForPlan(descriptor);
        const invocationChanged = String(finalObservation.invocation_id ?? "").length > 0
          && String(verification.invocation_id ?? "").length > 0
          && verification.invocation_id !== finalObservation.invocation_id;
        const healthy = verification.load_state === "loaded"
          && verification.active_state === "active"
          && verification.sub_state === "running"
          && verification.healthy === true;
        if (invocationChanged && healthy) {
          return verificationOutcome({
            operationState,
            status: "verified_success",
            code: "",
            plan,
            verification,
          });
        }
        if (verification.active_state === "failed" || verification.sub_state === "failed") {
          return verificationOutcome({
            operationState,
            status: "verified_failure",
            code: "service_restart_verify_failed",
            plan,
            verification,
          });
        }
        return verificationOutcome({
          operationState,
          status: "outcome_unknown",
          code: applyError?.code ?? "service_restart_outcome_unknown",
          plan,
          verification,
        });
      } finally {
        operationState.releaseLock(lockId);
      }
    },
    applyAttemptCount(planId) {
      return applyAttempts.get(String(planId ?? "")) ?? 0;
    },
    grantConsumed(grantId) {
      return consumedGrantIds.has(String(grantId ?? ""));
    },
  });
}

function assertFinalObservation({ finalObservation, plan, planStore }) {
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
}

function verificationOutcome({
  operationState,
  status,
  code,
  plan,
  verification = {},
  possiblyApplied = true,
}) {
  try {
    operationState.appendProvenance({
      event_type: "host.service.restart.verification_result",
      capability: "host.service.restart",
      provider: plan.provider_id,
      domain: plan.domain,
      task_id: plan.task_id,
      grant_id: plan.grant_id,
      plan_digest: plan.plan_digest,
      outcome: status,
      code,
      possibly_applied: possiblyApplied,
      reconciliation_required: status === "outcome_unknown",
    });
  } catch {
    return outcome("outcome_unknown", "service_recovery_degraded", plan, {}, {
      possibly_applied: true,
      reconciliation_required: true,
    });
  }
  return outcome(status, code, plan, verification, {
    possibly_applied: possiblyApplied,
    reconciliation_required: status === "outcome_unknown",
  });
}

function normalizedProviderError(error) {
  const ambiguous = error?.ambiguous === true;
  const rawCode = String(error?.code ?? "");
  return {
    ambiguous,
    code: HOST_SERVICE_REFUSAL_CODES.includes(rawCode)
      ? rawCode
      : ambiguous
        ? "service_restart_outcome_unknown"
        : "service_restart_provider_refused",
  };
}

function assertApplyBindings({ plan, task, grant, descriptor, consumedGrantIds, now }) {
  const attendedRealHost = descriptor?.domain === "operational"
    && descriptor?.synthetic === false
    && descriptor?.provider_mode === "real_systemd_attended_host";
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
    !attendedRealHost
    || descriptor.descriptor_digest !== plan.descriptor_digest
    || descriptor.service_handle !== plan.service_handle
    || descriptor.task_id !== plan.task_id
    || descriptor.grant_id !== plan.grant_id
  ) {
    throw hostServiceError("service_restart_plan_stale", "Apply descriptor does not match the exact plan.", 409);
  }
}

function outcome(status, code, plan, verification = {}, posture = {}) {
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
    possibly_applied: posture.possibly_applied === true,
    reconciliation_required: posture.reconciliation_required === true,
  });
}

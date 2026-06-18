import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeHostServiceRequest,
  createHostServiceTaskLedger,
  validateHostServiceTaskEnvelope,
} from "../src/hostServiceAuthority.js";
import {
  HOST_SERVICE_RESTART_CAPABILITY,
  HOST_SERVICE_STATUS_CAPABILITY,
  HOST_SERVICE_SYNTHETIC_PROVIDER_ID,
} from "../src/hostServiceContracts.js";
import { createHostServiceHandleTable, createHostServiceInventory } from "../src/hostServiceInventory.js";
import { createHostServiceOperationState } from "../src/hostServiceOperationState.js";
import { createHostServicePlanStore, renderLocalHostServicePlanPreview } from "../src/hostServicePlanStore.js";
import { createHostServiceRestartRuntime } from "../src/hostServiceRestartRuntime.js";
import { createSyntheticHostServiceProvider } from "../src/hostServiceSyntheticProvider.js";
import {
  createLocalConfirmationAuthority,
  createTrustedLocalConfirmationAdapter,
} from "../src/localConfirmationAuthority.js";
import { resolveResourceDescriptor } from "../src/resourceRouter.js";

async function setup({
  applyMode = "success",
  postRestartStatus = {},
  postRestartInvocationId = "invocation-2",
  onFinalBoundary = () => {},
  confirmationTtlMs = 30_000,
} = {}) {
  let clock = 1_000;
  const now = () => clock;
  let currentInventory = createHostServiceInventory({
    domain: "testing",
    host_id: "host-fixture",
    inventory_generation: "host-gen-1",
    identity_generation: "boot-1",
    units: [{
      inventory_id: "service-fixture",
      inventory_generation: "unit-gen-1",
      unit_name: "soma-lab-fixture.service",
      fixture_id: "restart-fixture",
      allowlisted: true,
      affected_closure: ["service-fixture"],
    }],
  });
  const inventory = currentInventory;
  const handles = createHostServiceHandleTable({ now, random: () => "b".repeat(48) });
  const task = validateHostServiceTaskEnvelope({
    task_id: "task-restart",
    objective: "Restart the expendable synthetic fixture.",
    host_id: "host-fixture",
    allowed_service_inventory_ids: ["service-fixture"],
    allowed_capabilities: [HOST_SERVICE_STATUS_CAPABILITY, HOST_SERVICE_RESTART_CAPABILITY],
    consequence_ceiling: "C3",
    expires_at: 20_000,
    max_status_reads: 5,
    max_restart_plans: 1,
    max_successful_restarts: 1,
    route: "local",
    model_egress: "none",
  }, { now });
  const grant = {
    id: "grant-restart",
    status: "active",
    capability: HOST_SERVICE_RESTART_CAPABILITY,
    provider: HOST_SERVICE_SYNTHETIC_PROVIDER_ID,
    scope: "once",
    constraints: {
      task_id: task.task_id,
      host_id: task.host_id,
      service_inventory_id: "service-fixture",
      domain: "testing",
      expires_at: 20_000,
    },
  };
  const authorization = authorizeHostServiceRequest({
    capability: HOST_SERVICE_RESTART_CAPABILITY,
    task,
    grant,
    inventory_id: "service-fixture",
    provider_id: grant.provider,
    domain: "testing",
    now,
  });
  const serviceHandle = handles.mint({
    inventory,
    inventory_id: "service-fixture",
    task_id: task.task_id,
    grant_id: grant.id,
    provider_id: grant.provider,
    domain: "testing",
  });
  const descriptor = await resolveResourceDescriptor({
    domain: "testing",
    capability: HOST_SERVICE_RESTART_CAPABILITY,
    ref: { service_handle: serviceHandle, task_id: task.task_id },
    grant,
    hostServiceAuthority: { inventory, handles },
    hostServiceAuthorization: authorization,
  });
  const provider = createSyntheticHostServiceProvider({
    now,
    fixtures: {
      "restart-fixture": {
        generation: "1",
        status: {
          load_state: "loaded",
          active_state: "active",
          sub_state: "running",
          unit_file_state_class: "enabled",
          can_restart: true,
          restart_policy_class: "allowed_with_confirmation",
          state_changed_at_bucket: "recent",
          healthy: true,
        },
        effective_definition: {
          fragment_digest: "fixture-fragment",
          exec_start_digest: "fixture-exec",
          type: "simple",
          restart: "no",
          dependencies: [],
          activation: "direct",
        },
        affected_closure: "target_only",
        invocation_id: "invocation-1",
        activation_timestamp: 1,
        apply_mode: applyMode,
        post_restart_invocation_id: postRestartInvocationId,
        post_restart_status: postRestartStatus,
      },
    },
  });
  const planStore = createHostServicePlanStore({ now, random: () => "c".repeat(48) });
  const taskLedger = createHostServiceTaskLedger();
  const observation = provider.inspectForPlan(descriptor);
  const plan = planStore.create({ authorization, descriptor, observation, task, taskLedger });
  const confirmationAdapter = createTrustedLocalConfirmationAdapter({ now, secret: Buffer.alloc(32, 7) });
  const confirmationAuthority = createLocalConfirmationAuthority({
    now,
    random: (() => {
      let count = 0;
      return () => `${++count}`.padStart(48, "d");
    })(),
    ttlMs: confirmationTtlMs,
    verifyTrustedAttestation: confirmationAdapter.verifier,
  });
  const operationState = createHostServiceOperationState();
  operationState.registerTask(task);
  const hostServiceAuthority = {
    handles,
    currentInventory: () => currentInventory,
  };
  let finalBoundaryAction = onFinalBoundary;
  const runtime = createHostServiceRestartRuntime({
    planStore,
    confirmationAuthority,
    provider,
    taskLedger,
    operationState,
    hostServiceAuthority,
    finalBoundary: () => finalBoundaryAction(),
    now,
  });
  return {
    advance(ms) {
      clock += ms;
    },
    inventory,
    handles,
    task,
    grant,
    authorization,
    descriptor,
    provider,
    planStore,
    taskLedger,
    observation,
    plan,
    confirmationAuthority,
    confirmationAdapter,
    operationState,
    hostServiceAuthority,
    runtime,
    replaceInventory(next) {
      currentInventory = next;
    },
    setFinalBoundary(action) {
      finalBoundaryAction = action;
    },
  };
}

function trustedAttestation(overrides = {}) {
  return {
    channel: "trusted_local_ui",
    os_peer_authenticated: true,
    independent_user_presence: true,
    preview_acknowledged: true,
    same_user_endpoint: true,
    input_origin: "trusted_local_hardware",
    ...overrides,
  };
}

function attest(context) {
  return context.confirmationAdapter.attest({
    plan: context.plan,
    local_signal: trustedAttestation(),
  });
}

test("restart plan is immutable, C3, target-only, and locally renderable", async () => {
  const { plan } = await setup();
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(plan.consequence_class, "C3");
  assert.equal(plan.rollback_posture, "not_reversible");
  assert.equal(plan.affected_closure, "target_only");
  assert.equal(plan.confirmation_required, true);
  const preview = renderLocalHostServicePlanPreview(plan, { target_label: "lab fixture service" });
  assert.equal(preview.exact_target, "lab fixture service");
  assert.equal(preview.rollback, "none");
});

test("local confirmation rejects occupant, computer-use, synthetic, remote, API, and stdin origins", async () => {
  const context = await setup();
  for (const input_origin of ["occupant", "computer_use", "synthetic_input", "remote_input", "api", "stdin"]) {
    assert.throws(
      () => context.confirmationAdapter.attest({
        plan: context.plan,
        local_signal: trustedAttestation({ input_origin }),
      }),
      (error) => error.code === "service_restart_confirmation_required",
    );
  }
  assert.throws(
    () => context.confirmationAuthority.confirm({
      plan: context.plan,
      attestation: trustedAttestation(),
    }),
    (error) => error.code === "service_restart_confirmation_required",
  );
  const receipt = context.confirmationAuthority.confirm({
    plan: context.plan,
    attestation: attest(context),
  });
  assert.equal(receipt.authority_channel, "trusted_local_human_presence");
  assert.equal(receipt.plan_digest, context.plan.plan_digest);
  assert.equal(receipt.target_binding_digest, context.plan.target_binding_digest);
});

test("local confirmation rejects cross-plan replay and reused signed nonces", async () => {
  const context = await setup();
  const attestation = attest(context);
  const otherPlan = Object.freeze({
    ...context.plan,
    plan_id: "plan-other",
    plan_digest: "e".repeat(64),
  });
  assert.throws(
    () => context.confirmationAuthority.confirm({
      plan: otherPlan,
      attestation,
    }),
    (error) => error.code === "service_restart_confirmation_required",
  );
  context.confirmationAuthority.confirm({
    plan: context.plan,
    attestation,
  });
  assert.throws(
    () => context.confirmationAuthority.confirm({
      plan: context.plan,
      attestation,
    }),
    (error) => error.code === "service_restart_confirmation_required",
  );
});

test("synthetic apply consumes exact plan, confirmation, and once grant then verifies InvocationID", async () => {
  const context = await setup();
  const receipt = context.confirmationAuthority.confirm({
    plan: context.plan,
    attestation: attest(context),
  });
  const result = context.runtime.applyAndVerify({
    plan_id: context.plan.plan_id,
    plan_digest: context.plan.plan_digest,
    task: context.task,
    grant: context.grant,
    descriptor: context.descriptor,
    confirmation_receipt_id: receipt.receipt_id,
  });
  assert.equal(result.outcome, "verified_success");
  assert.equal(result.invocation_evidence_changed, true);
  assert.equal(result.automatic_retry_performed, false);
  assert.equal(context.runtime.grantConsumed(context.grant.id), true);
  assert.equal(context.planStore.snapshot(context.plan.plan_id).consumed, true);
  assert.equal(context.confirmationAuthority.snapshot(receipt.receipt_id).consumed, true);
  assert.equal(context.provider.invocationCount("restart-fixture"), 1);
  assert.throws(
    () => context.runtime.applyAndVerify({
      plan_id: context.plan.plan_id,
      plan_digest: context.plan.plan_digest,
      task: context.task,
      grant: context.grant,
      descriptor: context.descriptor,
      confirmation_receipt_id: receipt.receipt_id,
    }),
    (error) => error.code === "service_restart_plan_stale",
  );
  assert.equal(context.provider.invocationCount("restart-fixture"), 1);
});

test("definition drift at the final boundary invalidates plan before provider invocation", async () => {
  const context = await setup();
  const receipt = context.confirmationAuthority.confirm({
    plan: context.plan,
    attestation: attest(context),
  });
  context.provider.mutateFixture("restart-fixture", {
    effective_definition: { exec_start_digest: "changed-after-confirmation" },
  });
  assert.throws(
    () => context.runtime.applyAndVerify({
      plan_id: context.plan.plan_id,
      plan_digest: context.plan.plan_digest,
      task: context.task,
      grant: context.grant,
      descriptor: context.descriptor,
      confirmation_receipt_id: receipt.receipt_id,
    }),
    (error) => error.code === "service_unit_definition_drift",
  );
  assert.equal(context.provider.invocationCount("restart-fixture"), 0);
  assert.equal(context.runtime.grantConsumed(context.grant.id), false);
});

test("ambiguous synthetic completion is never retried and unchanged InvocationID stays unknown", async () => {
  const context = await setup({ applyMode: "ambiguous_without_apply" });
  const receipt = context.confirmationAuthority.confirm({
    plan: context.plan,
    attestation: attest(context),
  });
  const result = context.runtime.applyAndVerify({
    plan_id: context.plan.plan_id,
    plan_digest: context.plan.plan_digest,
    task: context.task,
    grant: context.grant,
    descriptor: context.descriptor,
    confirmation_receipt_id: receipt.receipt_id,
  });
  assert.equal(result.outcome, "outcome_unknown");
  assert.equal(result.automatic_retry_performed, false);
  assert.equal(context.provider.invocationCount("restart-fixture"), 1);
  assert.equal(context.runtime.applyAttemptCount(context.plan.plan_id), 1);
});

test("healthy-looking state with unchanged InvocationID cannot verify success", async () => {
  const context = await setup({ postRestartInvocationId: "invocation-1" });
  const receipt = context.confirmationAuthority.confirm({
    plan: context.plan,
    attestation: attest(context),
  });
  const result = context.runtime.applyAndVerify({
    plan_id: context.plan.plan_id,
    plan_digest: context.plan.plan_digest,
    task: context.task,
    grant: context.grant,
    descriptor: context.descriptor,
    confirmation_receipt_id: receipt.receipt_id,
  });
  assert.equal(result.outcome, "outcome_unknown");
  assert.equal(result.healthy, true);
});

test("confirmation recovery degradation clears receipts and fails closed", async () => {
  const context = await setup();
  const receipt = context.confirmationAuthority.confirm({
    plan: context.plan,
    attestation: attest(context),
  });
  context.confirmationAuthority.setRecoveryHealthy(false);
  assert.equal(context.confirmationAuthority.snapshot(receipt.receipt_id), null);
  assert.throws(
    () => context.confirmationAuthority.confirm({
      plan: context.plan,
      attestation: attest(context),
    }),
    (error) => error.code === "service_recovery_degraded",
  );
});

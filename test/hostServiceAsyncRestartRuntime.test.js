import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeHostServiceRequest,
  createHostServiceTaskLedger,
  validateHostServiceTaskEnvelope,
} from "../src/hostServiceAuthority.js";
import {
  HOST_SERVICE_OPERATIONAL_PROVIDER_ID,
  HOST_SERVICE_RESTART_CAPABILITY,
  HOST_SERVICE_STATUS_CAPABILITY,
} from "../src/hostServiceContracts.js";
import {
  createHostServiceHandleTable,
  createHostServiceInventory,
  hostServiceDescriptorDigest,
} from "../src/hostServiceInventory.js";
import { createHostServiceOperationState } from "../src/hostServiceOperationState.js";
import { createHostServicePlanStore } from "../src/hostServicePlanStore.js";
import { createAsyncHostServiceRestartRuntime } from "../src/hostServiceAsyncRestartRuntime.js";
import {
  createLocalConfirmationAuthority,
  createTrustedLocalConfirmationAdapter,
} from "../src/localConfirmationAuthority.js";

test("async attended-host runtime performs one verified provider restart", async () => {
  const now = () => Date.now();
  const inventory = createHostServiceInventory({
    domain: "operational",
    provider_id: HOST_SERVICE_OPERATIONAL_PROVIDER_ID,
    host_id: "host-1",
    inventory_generation: "inventory-1",
    identity_generation: "boot-1",
    units: [{
      inventory_id: "lab-proof",
      inventory_generation: "unit-1",
      unit_name: "soma-lab-proof.service",
      allowlisted: true,
      affected_closure: ["lab-proof"],
    }],
  });
  const task = validateHostServiceTaskEnvelope({
    task_id: "task-1",
    objective: "Attended host restart.",
    host_id: "host-1",
    allowed_service_inventory_ids: ["lab-proof"],
    allowed_capabilities: [HOST_SERVICE_STATUS_CAPABILITY, HOST_SERVICE_RESTART_CAPABILITY],
    consequence_ceiling: "C3",
    expires_at: now() + 60_000,
    max_status_reads: 5,
    max_restart_plans: 1,
    max_successful_restarts: 1,
    route: "local",
    model_egress: "none",
  }, { now });
  const grant = {
    id: "grant-1",
    status: "active",
    capability: HOST_SERVICE_RESTART_CAPABILITY,
    provider: HOST_SERVICE_OPERATIONAL_PROVIDER_ID,
    scope: "once",
    constraints: {
      task_id: task.task_id,
      host_id: task.host_id,
      service_inventory_id: "lab-proof",
      domain: "operational",
      expires_at: task.expires_at,
    },
  };
  const authorization = authorizeHostServiceRequest({
    capability: HOST_SERVICE_RESTART_CAPABILITY,
    task,
    grant,
    inventory_id: "lab-proof",
    provider_id: grant.provider,
    domain: "operational",
    now,
  });
  const handles = createHostServiceHandleTable({ now });
  const serviceHandle = handles.mint({
    inventory,
    inventory_id: "lab-proof",
    task_id: task.task_id,
    grant_id: grant.id,
    provider_id: grant.provider,
    domain: "operational",
  });
  const descriptorBase = {
    domain: "operational",
    capability: HOST_SERVICE_RESTART_CAPABILITY,
    provider_id: HOST_SERVICE_OPERATIONAL_PROVIDER_ID,
    provider_mode: "real_systemd_attended_host",
    resource_class: "systemd_service",
    synthetic: false,
    host_id: task.host_id,
    service_handle: serviceHandle,
    inventory_generation: inventory.host.inventory_generation,
    unit_inventory_generation: inventory.getUnit("lab-proof").inventory_generation,
    unit_inventory_id: "lab-proof",
    task_id: task.task_id,
    grant_id: grant.id,
    limits: { max_properties: 12, timeout_ms: 5000 },
  };
  const descriptor = Object.freeze({
    ...descriptorBase,
    descriptor_digest: hostServiceDescriptorDigest(descriptorBase),
  });
  let restarted = false;
  let restartCalls = 0;
  const observation = () => Object.freeze({
    load_state: "loaded",
    active_state: "active",
    sub_state: "running",
    healthy: true,
    can_restart: true,
    affected_closure: "target_only",
    unit_definition_digest: "definition-1",
    definition_digest_schema: "schema-1",
    observation_generation: restarted ? "observation-2" : "observation-1",
    runtime_state_digest: restarted ? "runtime-2" : "runtime-1",
    target_binding_digest: "target-1",
    invocation_id: restarted ? "invocation-2" : "invocation-1",
  });
  const provider = {
    async inspectForPlan() {
      return observation();
    },
    async restart() {
      restartCalls += 1;
      restarted = true;
    },
  };
  const taskLedger = createHostServiceTaskLedger();
  const planStore = createHostServicePlanStore({ now, random: () => "fixed" });
  const plan = planStore.create({
    authorization,
    descriptor,
    observation: await provider.inspectForPlan(),
    task,
    taskLedger,
  });
  const adapter = createTrustedLocalConfirmationAdapter({ now, secret: Buffer.alloc(32, 4) });
  const confirmationAuthority = createLocalConfirmationAuthority({
    now,
    verifyTrustedAttestation: adapter.verifier,
  });
  const receipt = confirmationAuthority.confirm({
    plan,
    attestation: adapter.attest({
      plan,
      local_signal: {
        channel: "trusted_local_ui",
        os_peer_authenticated: true,
        independent_user_presence: true,
        preview_acknowledged: true,
        same_user_endpoint: true,
        input_origin: "trusted_local_hardware",
      },
    }),
  });
  const operationState = createHostServiceOperationState();
  operationState.registerTask(task);
  const runtime = createAsyncHostServiceRestartRuntime({
    planStore,
    confirmationAuthority,
    provider,
    taskLedger,
    operationState,
    hostServiceAuthority: {
      handles,
      currentInventory: () => inventory,
    },
    now,
  });
  const result = await runtime.applyAndVerify({
    plan_id: plan.plan_id,
    plan_digest: plan.plan_digest,
    task,
    grant,
    descriptor,
    confirmation_receipt_id: receipt.receipt_id,
  });
  assert.equal(result.outcome, "verified_success");
  assert.equal(result.invocation_evidence_changed, true);
  assert.equal(restartCalls, 1);
});

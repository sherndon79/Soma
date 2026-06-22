import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import {
  authorizeHostServiceRequest,
  createHostServiceTaskLedger,
  validateHostServiceTaskEnvelope,
} from "../src/hostServiceAuthority.js";
import {
  HOST_SERVICE_OPERATIONAL_PROVIDER_ID,
  HOST_SERVICE_RESTART_CAPABILITY,
  HOST_SERVICE_STATUS_CAPABILITY,
  normalizeHostServiceStatus,
} from "../src/hostServiceContracts.js";
import {
  createHostServiceHandleTable,
  createHostServiceInventory,
  hostServiceDescriptorDigest,
} from "../src/hostServiceInventory.js";
import { createHostServiceOperationState } from "../src/hostServiceOperationState.js";
import { createHostServicePlanStore } from "../src/hostServicePlanStore.js";
import { createHostServiceRestartRuntime } from "../src/hostServiceRestartRuntime.js";
import { createSystemdProviderAdapter } from "../src/hostServiceSystemdProvider.js";
import {
  createLocalConfirmationAuthority,
  createTrustedLocalConfirmationAdapter,
} from "../src/localConfirmationAuthority.js";

const composeArgs = [
  "compose",
  "-f",
  "docker-compose.systemd-provider-test.yml",
  "exec",
  "-T",
  "systemd-provider-test",
  "runuser",
  "-u",
  "soma-systemd-provider",
  "--",
  "env",
  "SOMA_SYSTEMD_PROVIDER_INVENTORY=/etc/soma/systemd-provider-inventory.json",
  "/usr/libexec/soma/soma-systemd-provider",
];

const provider = createSystemdProviderAdapter({
  command: "docker",
  args: composeArgs,
  inventoryPath: "/etc/soma/systemd-provider-inventory.json",
  enabled: true,
});

const rawStatus = provider.readStatusRaw({ unit_inventory_id: "lab-restart-proof" });
const normalizedStatus = normalizeHostServiceStatus(rawStatus, {
  serviceHandle: "controlled-opaque-handle",
  observationGeneration: "controlled-observation",
});
assert.doesNotMatch(JSON.stringify(normalizedStatus), /soma-lab-restart-proof|\/usr\/bin\/sleep/);

const context = buildContext(provider);
const result = context.apply();
assert.equal(result.outcome, "verified_success");
assert.equal(result.invocation_evidence_changed, true);
assert.equal(provider.restartCallCount(), 1);

let evidenceLostAfterRestart = false;
const evidenceLostProvider = {
  inspectForPlan(descriptor) {
    const observation = provider.inspectForPlan(descriptor);
    return evidenceLostAfterRestart
      ? Object.freeze({ ...observation, invocation_id: "" })
      : observation;
  },
  restart(descriptor) {
    const response = provider.restart(descriptor);
    evidenceLostAfterRestart = true;
    return response;
  },
};
const unknownContext = buildContext(evidenceLostProvider);
const unknownResult = unknownContext.apply();
assert.equal(unknownResult.outcome, "outcome_unknown");
assert.equal(unknownResult.invocation_evidence_changed, false);

for (const mutate of [
  (candidate) => {
    candidate.grant.status = "revoked";
  },
  (candidate) => {
    candidate.operationState.closeTask(candidate.task.task_id);
  },
  (candidate) => {
    candidate.handles.revokeHandle(candidate.descriptor.service_handle);
  },
  (candidate) => {
    candidate.expireConfirmation();
  },
  (candidate) => {
    candidate.driftHostIdentity();
  },
]) {
  const candidate = buildContext(provider);
  const before = provider.restartCallCount();
  candidate.setBoundary(() => mutate(candidate));
  assert.throws(() => candidate.apply());
  assert.equal(provider.restartCallCount(), before);
}

for (const recoveryComponent of [
  "inventory",
  "grant",
  "handle",
  "plan",
  "confirmation",
  "lock",
  "provenance",
]) {
  for (const state of ["missing", "corrupt"]) {
    const candidate = buildContext(provider);
    const before = provider.restartCallCount();
    candidate.operationState.setRecovery(recoveryComponent, state);
    assert.throws(() => candidate.apply(), (error) => error.code === "service_recovery_degraded");
    assert.equal(provider.restartCallCount(), before);
  }
}

const drift = buildContext(provider);
const restartCountBeforeDrift = provider.restartCallCount();
drift.setBoundary(() => {
  containerShell(
    "printf '[Service]\\nCapabilityBoundingSet=CAP_CHOWN\\n' > "
      + "/etc/systemd/system/soma-lab-restart-proof.service.d/privilege.conf && "
      + "systemctl daemon-reload",
  );
});
assert.throws(
  () => drift.apply(),
  (error) => error.code === "service_unit_definition_drift",
);
assert.equal(provider.restartCallCount(), restartCountBeforeDrift);
containerShell(
  "printf '[Service]\\nCapabilityBoundingSet=\\n' > "
    + "/etc/systemd/system/soma-lab-restart-proof.service.d/privilege.conf && "
    + "systemctl daemon-reload",
);

console.log("systemd provider controlled runtime: PASS");

function buildContext(realProvider) {
  let boundary = () => {};
  let currentInventory;
  const now = () => Date.now();
  currentInventory = createHostServiceInventory({
    domain: "testing",
    provider_id: HOST_SERVICE_OPERATIONAL_PROVIDER_ID,
    host_id: "controlled-systemd-container",
    inventory_generation: "container-generation-1",
    identity_generation: "container-boot-1",
    units: [{
      inventory_id: "lab-restart-proof",
      inventory_generation: "unit-generation-1",
      unit_name: "soma-lab-restart-proof.service",
      allowlisted: true,
      affected_closure: ["lab-restart-proof"],
    }],
  });
  const inventory = currentInventory;
  const task = validateHostServiceTaskEnvelope({
    task_id: `controlled-${Math.random().toString(16).slice(2)}`,
    objective: "Controlled real systemd provider drill.",
    host_id: inventory.host.host_id,
    allowed_service_inventory_ids: ["lab-restart-proof"],
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
    id: `grant-${task.task_id}`,
    status: "active",
    capability: HOST_SERVICE_RESTART_CAPABILITY,
    provider: HOST_SERVICE_OPERATIONAL_PROVIDER_ID,
    scope: "once",
    constraints: {
      task_id: task.task_id,
      host_id: task.host_id,
      service_inventory_id: "lab-restart-proof",
      domain: "testing",
      expires_at: task.expires_at,
    },
  };
  const authorization = authorizeHostServiceRequest({
    capability: HOST_SERVICE_RESTART_CAPABILITY,
    task,
    grant,
    inventory_id: "lab-restart-proof",
    provider_id: grant.provider,
    domain: "testing",
    now,
  });
  const handles = createHostServiceHandleTable({ now });
  const serviceHandle = handles.mint({
    inventory,
    inventory_id: "lab-restart-proof",
    task_id: task.task_id,
    grant_id: grant.id,
    provider_id: grant.provider,
    domain: "testing",
  });
  const descriptorBase = {
    domain: "testing",
    capability: HOST_SERVICE_RESTART_CAPABILITY,
    provider_id: HOST_SERVICE_OPERATIONAL_PROVIDER_ID,
    provider_mode: "real_systemd_controlled_test",
    resource_class: "systemd_service",
    synthetic: false,
    host_id: inventory.host.host_id,
    service_handle: serviceHandle,
    inventory_generation: inventory.host.inventory_generation,
    unit_inventory_generation: "unit-generation-1",
    unit_inventory_id: "lab-restart-proof",
    task_id: task.task_id,
    grant_id: grant.id,
    limits: { max_properties: 12, timeout_ms: 5000 },
  };
  const descriptor = Object.freeze({
    ...descriptorBase,
    descriptor_digest: hostServiceDescriptorDigest(descriptorBase),
  });
  const taskLedger = createHostServiceTaskLedger();
  const planStore = createHostServicePlanStore({ now });
  const plan = planStore.create({
    authorization,
    descriptor,
    observation: realProvider.inspectForPlan(descriptor),
    task,
    taskLedger,
  });
  const adapter = createTrustedLocalConfirmationAdapter({ now, secret: Buffer.alloc(32, 11) });
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
  const runtime = createHostServiceRestartRuntime({
    planStore,
    confirmationAuthority,
    provider: realProvider,
    taskLedger,
    operationState,
    hostServiceAuthority: {
      handles,
      currentInventory: () => currentInventory,
    },
    finalBoundary: () => boundary(),
    now,
  });
  return {
    task,
    grant,
    handles,
    descriptor,
    operationState,
    expireConfirmation() {
      confirmationAuthority.expireTask(task.task_id);
    },
    driftHostIdentity() {
      currentInventory = createHostServiceInventory({
        domain: "testing",
        provider_id: HOST_SERVICE_OPERATIONAL_PROVIDER_ID,
        host_id: inventory.host.host_id,
        inventory_generation: inventory.host.inventory_generation,
        identity_generation: "container-boot-drifted",
        units: [{
          inventory_id: "lab-restart-proof",
          inventory_generation: "unit-generation-1",
          unit_name: "soma-lab-restart-proof.service",
          allowlisted: true,
          affected_closure: ["lab-restart-proof"],
        }],
      });
    },
    setBoundary(next) {
      boundary = next;
    },
    apply() {
      return runtime.applyAndVerify({
        plan_id: plan.plan_id,
        plan_digest: plan.plan_digest,
        task,
        grant,
        descriptor,
        confirmation_receipt_id: receipt.receipt_id,
      });
    },
  };
}

function containerShell(command) {
  execFileSync("docker", [
    "compose",
    "-f",
    "docker-compose.systemd-provider-test.yml",
    "exec",
    "-T",
    "systemd-provider-test",
    "sh",
    "-c",
    command,
  ], { stdio: "pipe" });
}

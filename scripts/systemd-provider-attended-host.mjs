#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";

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
import { createHostServicePlanStore, renderLocalHostServicePlanPreview } from "../src/hostServicePlanStore.js";
import { createAsyncHostServiceRestartRuntime } from "../src/hostServiceAsyncRestartRuntime.js";
import { createSystemdProviderSocketAdapter } from "../src/hostServiceSystemdProvider.js";
import { createLocalConfirmationAuthority } from "../src/localConfirmationAuthority.js";
import { createLocalConfirmationSocketClient } from "../src/localConfirmationSocketClient.js";

if (process.env.SOMA_SYSTEMD_ATTENDED_HOST_DRIVER !== "1") {
  fail("Refusing: SOMA_SYSTEMD_ATTENDED_HOST_DRIVER=1 is required.", 2);
}

const hostId = required("SOMA_SYSTEMD_HOST_ID");
const inventoryId = required("SOMA_SYSTEMD_UNIT_INVENTORY_ID");
const unitName = required("SOMA_SYSTEMD_UNIT_NAME");
const requestPath = required("SOMA_SYSTEMD_LCA_REQUEST_PATH");
const runId = requiredToken("SOMA_SYSTEMD_ATTENDED_RUN_ID");
const planCreatedAt = requiredTimestamp("SOMA_SYSTEMD_PLAN_CREATED_AT_MS");
const socketPath = process.env.SOMA_SYSTEMD_SOCKET_PATH ?? "/run/soma/systemd-provider.sock";
const lcaSocketPath = process.env.SOMA_LCA_SOCKET_PATH ?? "/run/soma-lca/issuer.sock";
const now = () => Date.now();

const provider = createSystemdProviderSocketAdapter({ socketPath, enabled: true });
try {
  const context = await buildContext();
  if (
    process.env.SOMA_SYSTEMD_ATTENDED_HOST_RESTART === "1"
    && process.env.SOMA_SYSTEMD_ATTENDED_CONFIRM_ONLY !== "1"
    && context.plan.plan_digest !== required("SOMA_SYSTEMD_EXPECTED_PLAN_DIGEST")
  ) {
    fail("Refusing: live plan does not match the reviewed plan digest.", 2);
  }
  const preview = renderLocalHostServicePlanPreview(context.plan, { target_label: unitName });
  await writeJsonAtomic(requestPath, {
    schema_version: 1,
    request_type: "soma.local-confirmation.request.v1",
    plan_digest: context.plan.plan_digest,
    target_binding_digest: context.plan.target_binding_digest,
    task_id: context.task.task_id,
    provider_id: context.plan.provider_id,
    exact_target: unitName,
    consequence_class: "C3",
    rollback_posture: "not_reversible",
    preview,
    expires_at: context.plan.expires_at,
  });

  if (process.env.SOMA_SYSTEMD_ATTENDED_HOST_RESTART !== "1") {
    console.log(JSON.stringify({
      outcome: "confirmation_required",
      request_path: requestPath,
      restart_dispatched: false,
    }));
    process.exitCode = 3;
  } else {
    const lcaServerUid = Number(required("SOMA_LCA_EXPECTED_SERVER_UID"));
    const requestNonce = randomBytes(24).toString("hex");
    const issuedAt = now();
    const lcaClient = createLocalConfirmationSocketClient({
      socketPath: lcaSocketPath,
      expectedServerUid: lcaServerUid,
    });
    const expected = {
      plan_digest: context.plan.plan_digest,
      target_binding_digest: context.plan.target_binding_digest,
      task_id: context.plan.task_id,
      provider_id: context.plan.provider_id,
      exact_target: unitName,
    };
    const attestation = lcaClient.confirm({
      request: {
        schema_version: 1,
        request_type: "soma.local-confirmation.request.v1",
        ...expected,
        inventory_id: inventoryId,
        consequence_class: "C3",
        rollback_posture: "not_reversible",
        request_nonce: requestNonce,
        issued_at: issuedAt,
        expires_at: Math.min(context.plan.expires_at, issuedAt + 30_000),
      },
      expected,
    });
    if (process.env.SOMA_SYSTEMD_ATTENDED_CONFIRM_ONLY === "1") {
      console.log(JSON.stringify({
        outcome: "confirmation_verified",
        restart_dispatched: false,
      }));
      process.exitCode = 5;
    } else {
      const confirmationAuthority = createLocalConfirmationAuthority({
        now,
        verifyTrustedAttestation: (candidate, plan) => candidate === attestation
          && candidate.plan_digest === plan.plan_digest
          && candidate.target_binding_digest === plan.target_binding_digest
          && candidate.task_id === plan.task_id
          && candidate.provider_id === plan.provider_id,
      });
      const receipt = confirmationAuthority.confirm({ plan: context.plan, attestation });
      const runtime = createAsyncHostServiceRestartRuntime({
        planStore: context.planStore,
        confirmationAuthority,
        provider,
        taskLedger: context.taskLedger,
        operationState: context.operationState,
        hostServiceAuthority: {
          handles: context.handles,
          currentInventory: () => context.inventory,
        },
        now,
      });
      const result = await runtime.applyAndVerify({
        plan_id: context.plan.plan_id,
        plan_digest: context.plan.plan_digest,
        task: context.task,
        grant: context.grant,
        descriptor: context.descriptor,
        confirmation_receipt_id: receipt.receipt_id,
      });
      assert.equal(provider.restartCallCount(), 1);
      console.log(JSON.stringify(result));
      if (result.outcome !== "verified_success") {
        process.exitCode = 4;
      }
    }
  }
} finally {
  provider.stop();
}

async function buildContext() {
  const inventory = createHostServiceInventory({
    domain: "operational",
    provider_id: HOST_SERVICE_OPERATIONAL_PROVIDER_ID,
    host_id: hostId,
    inventory_generation: `attended-${runId}`,
    identity_generation: required("SOMA_SYSTEMD_HOST_IDENTITY_GENERATION"),
    units: [{
      inventory_id: inventoryId,
      inventory_generation: required("SOMA_SYSTEMD_UNIT_INVENTORY_GENERATION"),
      unit_name: unitName,
      allowlisted: true,
      affected_closure: [inventoryId],
    }],
  });
  const task = validateHostServiceTaskEnvelope({
    task_id: `attended-${runId}`,
    objective: "One attended exact-host systemd restart proof.",
    host_id: hostId,
    allowed_service_inventory_ids: [inventoryId],
    allowed_capabilities: [HOST_SERVICE_STATUS_CAPABILITY, HOST_SERVICE_RESTART_CAPABILITY],
    consequence_ceiling: "C3",
    expires_at: planCreatedAt + 120_000,
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
      host_id: hostId,
      service_inventory_id: inventoryId,
      domain: "operational",
      expires_at: task.expires_at,
    },
  };
  const authorization = authorizeHostServiceRequest({
    capability: HOST_SERVICE_RESTART_CAPABILITY,
    task,
    grant,
    inventory_id: inventoryId,
    provider_id: grant.provider,
    domain: "operational",
    now,
  });
  const handles = createHostServiceHandleTable({
    now,
    random: () => runId,
  });
  const serviceHandle = handles.mint({
    inventory,
    inventory_id: inventoryId,
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
    host_id: hostId,
    service_handle: serviceHandle,
    inventory_generation: inventory.host.inventory_generation,
    unit_inventory_generation: inventory.getUnit(inventoryId).inventory_generation,
    unit_inventory_id: inventoryId,
    task_id: task.task_id,
    grant_id: grant.id,
    limits: { max_properties: 12, timeout_ms: 5000 },
  };
  const descriptor = Object.freeze({
    ...descriptorBase,
    descriptor_digest: hostServiceDescriptorDigest(descriptorBase),
  });
  const taskLedger = createHostServiceTaskLedger();
  const planStore = createHostServicePlanStore({
    now: () => planCreatedAt,
    random: () => runId,
  });
  const observation = await provider.inspectForPlan(descriptor);
  const plan = planStore.create({ authorization, descriptor, observation, task, taskLedger });
  const operationState = createHostServiceOperationState();
  operationState.registerTask(task);
  return {
    inventory,
    task,
    grant,
    handles,
    descriptor,
    taskLedger,
    planStore,
    plan,
    operationState,
  };
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function required(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    fail(`Refusing: ${name} is required.`, 2);
  }
  return value;
}

function requiredToken(name) {
  const value = required(name);
  if (!/^[a-z0-9][a-z0-9-]{7,63}$/.test(value)) {
    fail(`Refusing: ${name} must be a reviewed lowercase token.`, 2);
  }
  return value;
}

function requiredTimestamp(name) {
  const value = Number(required(name));
  const current = Date.now();
  if (!Number.isSafeInteger(value) || value > current || current - value > 120_000) {
    fail(`Refusing: ${name} is outside the attended window.`, 2);
  }
  return value;
}

function fail(message, code) {
  console.error(message);
  process.exit(code);
}

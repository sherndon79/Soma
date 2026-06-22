#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, rename, stat, writeFile } from "node:fs/promises";

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
import { createEd25519LocalConfirmationVerifier } from "../src/localConfirmationEd25519.js";

if (process.env.SOMA_SYSTEMD_ATTENDED_HOST_DRIVER !== "1") {
  fail("Refusing: SOMA_SYSTEMD_ATTENDED_HOST_DRIVER=1 is required.", 2);
}

const hostId = required("SOMA_SYSTEMD_HOST_ID");
const inventoryId = required("SOMA_SYSTEMD_UNIT_INVENTORY_ID");
const unitName = required("SOMA_SYSTEMD_UNIT_NAME");
const requestPath = required("SOMA_SYSTEMD_LCA_REQUEST_PATH");
const attestationPath = required("SOMA_SYSTEMD_LCA_ATTESTATION_PATH");
const publicKeyPath = required("SOMA_SYSTEMD_LCA_PUBLIC_KEY_PATH");
const socketPath = process.env.SOMA_SYSTEMD_SOCKET_PATH ?? "/run/soma/systemd-provider.sock";
const now = () => Date.now();

const provider = createSystemdProviderSocketAdapter({ socketPath, enabled: true });
try {
  await assertTrustedPublicKey(publicKeyPath);
  const context = await buildContext();
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
    const attestation = await waitForJson(attestationPath, 30_000);
    const publicKeyPem = await readFile(publicKeyPath, "utf8");
    const externalVerifier = createEd25519LocalConfirmationVerifier({ publicKeyPem });
    const confirmationAuthority = createLocalConfirmationAuthority({
      now,
      verifyTrustedAttestation: (attestation, plan) => externalVerifier(
        attestation,
        { ...plan, exact_target: unitName },
      ),
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
} finally {
  provider.stop();
}

async function buildContext() {
  const inventory = createHostServiceInventory({
    domain: "operational",
    provider_id: HOST_SERVICE_OPERATIONAL_PROVIDER_ID,
    host_id: hostId,
    inventory_generation: `attended-${randomBytes(8).toString("hex")}`,
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
    task_id: `attended-${randomBytes(12).toString("hex")}`,
    objective: "One attended exact-host systemd restart proof.",
    host_id: hostId,
    allowed_service_inventory_ids: [inventoryId],
    allowed_capabilities: [HOST_SERVICE_STATUS_CAPABILITY, HOST_SERVICE_RESTART_CAPABILITY],
    consequence_ceiling: "C3",
    expires_at: now() + 120_000,
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
  const handles = createHostServiceHandleTable({ now });
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
  const planStore = createHostServicePlanStore({ now });
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

async function waitForJson(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail("Timed out waiting for external trusted-local attestation.", 3);
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function assertTrustedPublicKey(path) {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.uid !== 0 || (metadata.mode & 0o022) !== 0) {
    fail("Refusing: LCA public key must be a root-owned file not writable by group or others.", 2);
  }
}

function required(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    fail(`Refusing: ${name} is required.`, 2);
  }
  return value;
}

function fail(message, code) {
  console.error(message);
  process.exit(code);
}

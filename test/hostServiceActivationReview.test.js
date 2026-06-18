import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  authorizeHostServiceRequest,
  createHostServiceTaskLedger,
  validateHostServiceTaskEnvelope,
} from "../src/hostServiceAuthority.js";
import {
  HOST_SERVICE_REFUSAL_CODES,
  HOST_SERVICE_RESTART_CAPABILITY,
  HOST_SERVICE_STATUS_CAPABILITY,
  HOST_SERVICE_SYNTHETIC_PROVIDER_ID,
} from "../src/hostServiceContracts.js";
import { createHostServiceEvidenceSinks } from "../src/hostServiceEvidenceSinks.js";
import { createHostServiceHandleTable, createHostServiceInventory } from "../src/hostServiceInventory.js";
import { createHostServiceOperationState } from "../src/hostServiceOperationState.js";
import {
  createHostServicePlanStore,
  renderLocalHostServicePlanPreviewFromHandle,
} from "../src/hostServicePlanStore.js";
import { readHostServiceStatus } from "../src/hostServiceReadRuntime.js";
import { createHostServiceRestartRuntime } from "../src/hostServiceRestartRuntime.js";
import { createSyntheticHostServiceProvider } from "../src/hostServiceSyntheticProvider.js";
import {
  createLocalConfirmationAuthority,
  createTrustedLocalConfirmationAdapter,
} from "../src/localConfirmationAuthority.js";
import { resolveResourceDescriptor } from "../src/resourceRouter.js";

const CANARIES = [
  "CANARY_SECRET_TOKEN_7f3a",
  "canary-hostname.internal",
  "canary-private.service",
  "/opt/private/canary-service",
  "/usr/bin/canary-command --secret",
  "CANARY_STATUS_TEXT",
  "424242",
];
const CANARY_PATTERN = new RegExp(CANARIES.map(escapeRegExp).join("|"));

async function restartFixture({
  applyMode = "success",
  postRestartInvocationId = "invocation-2",
  confirmationTtlMs = 30_000,
} = {}) {
  let clock = 1_000;
  let currentInventory = inventoryFixture();
  let boundaryAction = () => {};
  const now = () => clock;
  const handles = createHostServiceHandleTable({ now, random: () => "a".repeat(48) });
  const task = validateHostServiceTaskEnvelope({
    task_id: "task-activation-review",
    objective: "Synthetic activation review.",
    host_id: "host-fixture",
    allowed_service_inventory_ids: ["service-fixture"],
    allowed_capabilities: [HOST_SERVICE_STATUS_CAPABILITY, HOST_SERVICE_RESTART_CAPABILITY],
    consequence_ceiling: "C3",
    expires_at: 100_000,
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
      expires_at: 100_000,
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
    inventory: currentInventory,
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
    hostServiceAuthority: { inventory: currentInventory, handles },
    hostServiceAuthorization: authorization,
  });
  const provider = createSyntheticHostServiceProvider({
    now,
    fixtures: {
      "restart-fixture": {
        generation: "1",
        status: safeStatus(),
        effective_definition: {
          fragment_digest: "fragment",
          exec_start_digest: "exec",
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
      },
    },
  });
  const taskLedger = createHostServiceTaskLedger();
  const planStore = createHostServicePlanStore({ now, random: () => "b".repeat(48) });
  const plan = planStore.create({
    authorization,
    descriptor,
    observation: provider.inspectForPlan(descriptor),
    task,
    taskLedger,
  });
  const adapter = createTrustedLocalConfirmationAdapter({ now, secret: Buffer.alloc(32, 9) });
  const confirmationAuthority = createLocalConfirmationAuthority({
    now,
    ttlMs: confirmationTtlMs,
    verifyTrustedAttestation: adapter.verifier,
  });
  const operationState = createHostServiceOperationState();
  operationState.registerTask(task);
  const authority = {
    handles,
    currentInventory: () => currentInventory,
  };
  const runtime = createHostServiceRestartRuntime({
    planStore,
    confirmationAuthority,
    provider,
    taskLedger,
    operationState,
    hostServiceAuthority: authority,
    finalBoundary: () => boundaryAction(),
    now,
  });
  const attestation = adapter.attest({
    plan,
    local_signal: trustedLocalSignal(),
  });
  const receipt = confirmationAuthority.confirm({ plan, attestation });
  return {
    now,
    advance(ms) {
      clock += ms;
    },
    replaceInventory(inventory) {
      currentInventory = inventory;
    },
    setBoundary(action) {
      boundaryAction = action;
    },
    task,
    grant,
    handles,
    descriptor,
    provider,
    taskLedger,
    planStore,
    plan,
    receipt,
    confirmationAuthority,
    operationState,
    runtime,
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

test("activation canary corpus proves forbidden data crosses no result provenance error cache or log sink", async () => {
  const inventory = inventoryFixture({
    unit_name: "canary-private.service",
    host_id: "canary-hostname.internal",
  });
  const handles = createHostServiceHandleTable({ now: () => 1_000, random: () => "c".repeat(48) });
  const task = validateHostServiceTaskEnvelope({
    task_id: "task-canary",
    objective: "Canary sink review.",
    host_id: "canary-hostname.internal",
    allowed_service_inventory_ids: ["service-fixture"],
    allowed_capabilities: [HOST_SERVICE_STATUS_CAPABILITY],
    consequence_ceiling: "C0",
    expires_at: 10_000,
    max_status_reads: 1,
    route: "local",
    model_egress: "none",
  }, { now: () => 1_000 });
  const grant = {
    id: "grant-canary",
    status: "active",
    capability: HOST_SERVICE_STATUS_CAPABILITY,
    provider: HOST_SERVICE_SYNTHETIC_PROVIDER_ID,
    scope: "session",
    constraints: {
      task_id: task.task_id,
      host_id: task.host_id,
      service_inventory_id: "service-fixture",
      domain: "testing",
      expires_at: 10_000,
    },
  };
  const serviceHandle = handles.mint({
    inventory,
    inventory_id: "service-fixture",
    task_id: task.task_id,
    grant_id: grant.id,
    provider_id: grant.provider,
    domain: "testing",
  });
  const authorization = authorizeHostServiceRequest({
    capability: HOST_SERVICE_STATUS_CAPABILITY,
    task,
    grant,
    inventory_id: "service-fixture",
    provider_id: grant.provider,
    domain: "testing",
    now: () => 1_000,
  });
  const spoofedDescriptor = await resolveResourceDescriptor({
    domain: "testing",
    capability: HOST_SERVICE_STATUS_CAPABILITY,
    ref: {
      service_handle: serviceHandle,
      task_id: task.task_id,
      unit_name: "attacker-spoof.service",
      hostname: "attacker-spoof.invalid",
    },
    grant,
    hostServiceAuthority: { inventory, handles },
    hostServiceAuthorization: authorization,
  });
  const provider = createSyntheticHostServiceProvider({
    fixtures: {
      "restart-fixture": {
        status: {
          ...safeStatus(),
          secret: CANARIES[0],
          hostname: CANARIES[1],
          unit_name: CANARIES[2],
          fragment_path: CANARIES[3],
          exec_start: CANARIES[4],
          status_text: CANARIES[5],
          pid: 424242,
          malicious_extra: { instructions: CANARIES[0] },
        },
      },
    },
  });
  const read = await readHostServiceStatus({
    task,
    grant,
    inventory_id: "service-fixture",
    service_handle: serviceHandle,
    hostServiceAuthority: { inventory, handles },
    taskLedger: createHostServiceTaskLedger(),
    provider,
    now: () => 1_000,
  });
  const sinks = createHostServiceEvidenceSinks();
  sinks.recordResult(read.result);
  sinks.recordProvenance(read.provenance);
  sinks.cacheResult({ ...read.result, secret: CANARIES[0], unit_name: CANARIES[2] });
  sinks.log({ event_type: "host.service.status.read", code: "allowed", detail: CANARIES[5] });
  const rawError = new Error(`${CANARIES[0]} ${CANARIES[1]} ${CANARIES[3]}`);
  rawError.code = "service_status_unavailable";
  rawError.statusCode = 503;
  sinks.recordError(rawError);
  const snapshot = sinks.snapshot();

  for (const [sink, records] of Object.entries(snapshot)) {
    assert.doesNotMatch(JSON.stringify(records), CANARY_PATTERN, `${sink} leaked a canary`);
  }
  assert.equal(Object.hasOwn(read.descriptor, "unit_name"), false);
  assert.equal(Object.hasOwn(spoofedDescriptor, "unit_name"), false);
  assert.equal(Object.hasOwn(spoofedDescriptor, "hostname"), false);
  assert.equal(Object.hasOwn(read.result, "malicious_extra"), false);
});

test("recovery drills make every corrupt or missing authority component non-authorizing", async () => {
  for (const component of ["inventory", "grant", "handle", "plan", "confirmation", "lock", "provenance"]) {
    for (const state of ["missing", "corrupt"]) {
      const context = await restartFixture();
      context.operationState.setRecovery(component, state);
      assert.throws(
        () => context.apply(),
        (error) => error.code === "service_recovery_degraded",
        `${component}:${state} should fail closed`,
      );
      assert.equal(context.provider.invocationCount("restart-fixture"), 0);
    }
  }
});

test("committed provider call with failed provenance append reports degraded possibly-applied and never retries", async () => {
  const context = await restartFixture();
  context.operationState.setProvenanceAppendFailure(true);
  const result = context.apply();
  assert.deepEqual(
    {
      outcome: result.outcome,
      code: result.code,
      possibly_applied: result.possibly_applied,
      reconciliation_required: result.reconciliation_required,
      automatic_retry_performed: result.automatic_retry_performed,
    },
    {
      outcome: "outcome_unknown",
      code: "service_recovery_degraded",
      possibly_applied: true,
      reconciliation_required: true,
      automatic_retry_performed: false,
    },
  );
  assert.equal(context.provider.invocationCount("restart-fixture"), 1);
  assert.throws(() => context.apply(), (error) => error.code === "service_restart_plan_stale");
  assert.equal(context.provider.invocationCount("restart-fixture"), 1);
});

test("restart provenance records invocation and verification without accepting provider canaries", async () => {
  const context = await restartFixture();
  const result = context.apply();
  assert.equal(result.outcome, "verified_success");
  assert.deepEqual(
    context.operationState.provenanceEvents().map((event) => event.event_type),
    [
      "host.service.restart.provider_invoked",
      "host.service.restart.verification_result",
    ],
  );
  assert.deepEqual(
    context.operationState.provenanceEvents().map((event) => event.outcome),
    ["invoked", "verified_success"],
  );
  context.operationState.appendProvenance({
    event_type: CANARIES[5],
    capability: "host.service.restart",
    provider: HOST_SERVICE_SYNTHETIC_PROVIDER_ID,
    outcome: CANARIES[0],
    code: CANARIES[2],
    raw_unit: CANARIES[2],
    raw_command: CANARIES[4],
  });
  assert.doesNotMatch(JSON.stringify(context.operationState.provenanceEvents()), CANARY_PATTERN);
});

test("revocation and final-boundary races invoke the provider zero times", async (t) => {
  const cases = [
    ["grant revoked", (context) => {
      context.grant.status = "revoked";
    }, "service_restart_grant_required"],
    ["confirmation expired", (context) => {
      context.advance(11);
    }, "service_restart_confirmation_mismatch", { confirmationTtlMs: 10 }],
    ["handle revoked", (context) => {
      context.handles.revokeHandle(context.descriptor.service_handle);
    }, "service_handle_invalid"],
    ["task closed", (context) => {
      context.operationState.closeTask(context.task.task_id);
    }, "service_task_not_active"],
    ["host identity drift", (context) => {
      context.replaceInventory(inventoryFixture({ identity_generation: "boot-drifted" }));
    }, "service_inventory_drift"],
  ];
  for (const [name, mutate, code, options = {}] of cases) {
    await t.test(name, async () => {
      const context = await restartFixture(options);
      context.setBoundary(() => mutate(context));
      assert.throws(() => context.apply(), (error) => error.code === code);
      assert.equal(context.provider.invocationCount("restart-fixture"), 0);
      assert.equal(context.operationState.activeLockCount(), 0);
    });
  }
});

test("operator preview resolves exact target locally and is display-only", async () => {
  const context = await restartFixture();
  const before = {
    invocations: context.provider.invocationCount("restart-fixture"),
    plan: context.planStore.snapshot(context.plan.plan_id),
    receipt: context.confirmationAuthority.snapshot(context.receipt.receipt_id),
  };
  const preview = renderLocalHostServicePlanPreviewFromHandle({
    plan: context.plan,
    handles: context.handles,
    inventory: inventoryFixture(),
    task_id: context.task.task_id,
    grant_id: context.grant.id,
    provider_id: context.grant.provider,
    domain: "testing",
  });
  assert.deepEqual({
    exact_target: preview.exact_target,
    current_state: preview.current_state,
    expected_interruption: preview.expected_interruption,
    affected_set: preview.affected_set,
    timeout_ms: preview.timeout_ms,
    rollback: preview.rollback,
    verification: preview.verification,
    plan_digest: preview.plan_digest,
    expires_at: preview.expires_at,
  }, {
    exact_target: "soma-lab-fixture.service",
    current_state: "active/running",
    expected_interruption: true,
    affected_set: "exact target only",
    timeout_ms: 15_000,
    rollback: "none",
    verification: "new InvocationID and active/running postcondition",
    plan_digest: context.plan.plan_digest,
    expires_at: context.plan.expires_at,
  });
  assert.equal(context.provider.invocationCount("restart-fixture"), before.invocations);
  assert.deepEqual(context.planStore.snapshot(context.plan.plan_id), before.plan);
  assert.deepEqual(context.confirmationAuthority.snapshot(context.receipt.receipt_id), before.receipt);
});

test("task teardown removes handles plans receipts locks and task-local counters", async () => {
  const context = await restartFixture();
  context.operationState.acquireLock(`${context.task.task_id}:teardown-proof`);
  context.handles.revokeTask(context.task.task_id);
  context.planStore.clearTask(context.task.task_id);
  context.confirmationAuthority.expireTask(context.task.task_id);
  context.taskLedger.clearTask(context.task.task_id);
  context.operationState.teardownTask(context.task.task_id);

  assert.equal(context.handles.size(), 0);
  assert.equal(context.planStore.snapshot(context.plan.plan_id), null);
  assert.equal(context.confirmationAuthority.snapshot(context.receipt.receipt_id), null);
  assert.deepEqual(context.taskLedger.snapshot(context.task.task_id), {
    status_reads: 0,
    restart_plans: 0,
    restart_acceptances: 0,
  });
  assert.equal(context.operationState.activeLockCount(), 0);
  assert.throws(
    () => context.operationState.assertTaskActive(context.task.task_id),
    (error) => error.code === "service_task_not_active",
  );
});

test("activation evidence demonstrates verified success and honest outcome_unknown", async () => {
  const success = await restartFixture();
  assert.equal(success.apply().outcome, "verified_success");
  const unknown = await restartFixture({
    applyMode: "ambiguous_without_apply",
    postRestartInvocationId: "invocation-1",
  });
  const result = unknown.apply();
  assert.equal(result.outcome, "outcome_unknown");
  assert.equal(result.automatic_retry_performed, false);
  assert.equal(unknown.provider.invocationCount("restart-fixture"), 1);
});

test("implementation and build-spec parity holds for capabilities classes refusals and conjuncts", async () => {
  const [catalogText, providerText, spec] = await Promise.all([
    readFile(new URL("../config/capability-catalog.json", import.meta.url), "utf8"),
    readFile(new URL("../config/provider-registry.json", import.meta.url), "utf8"),
    readFile(new URL("../docs/reviews/2026-06-18_systemd_service_first_slice_build_spec.md", import.meta.url), "utf8"),
  ]);
  const catalog = JSON.parse(catalogText);
  const providers = JSON.parse(providerText);
  const status = catalog.capabilities.find((entry) => entry.key === HOST_SERVICE_STATUS_CAPABILITY);
  const restart = catalog.capabilities.find((entry) => entry.key === HOST_SERVICE_RESTART_CAPABILITY);
  assert.equal(status.consequence_class, "C0");
  assert.equal(restart.consequence_class, "C3");
  assert.equal(status.default_status, "disabled");
  assert.equal(restart.default_status, "disabled");
  const operational = providers.providers.find((entry) => entry.id === "soma.provider.systemd-local");
  assert.equal(operational.activation_status, "disabled");
  for (const code of HOST_SERVICE_REFUSAL_CODES) {
    assert.match(spec, new RegExp(`\\\`${escapeRegExp(code)}\\\``), `spec missing ${code}`);
  }
  for (const phrase of [
    "active exact once restart grant",
    "unexpired, unconsumed matching confirmation receipt",
    "recomputed effective unit-definition digest matching the plan",
    "affected closure still exactly `{target}`",
    "No implementation or activation may begin before that approval",
  ]) {
    assert.ok(spec.includes(phrase), `spec missing conjunct: ${phrase}`);
  }
});

function inventoryFixture(overrides = {}) {
  return createHostServiceInventory({
    domain: "testing",
    host_id: overrides.host_id ?? "host-fixture",
    inventory_generation: overrides.inventory_generation ?? "host-gen-1",
    identity_generation: overrides.identity_generation ?? "boot-1",
    units: [{
      inventory_id: "service-fixture",
      inventory_generation: overrides.unit_inventory_generation ?? "unit-gen-1",
      unit_name: overrides.unit_name ?? "soma-lab-fixture.service",
      fixture_id: "restart-fixture",
      allowlisted: true,
      affected_closure: ["service-fixture"],
    }],
  });
}

function safeStatus() {
  return {
    load_state: "loaded",
    active_state: "active",
    sub_state: "running",
    unit_file_state_class: "enabled",
    can_restart: true,
    restart_policy_class: "allowed_with_confirmation",
    state_changed_at_bucket: "recent",
    healthy: true,
  };
}

function trustedLocalSignal() {
  return {
    channel: "trusted_local_ui",
    os_peer_authenticated: true,
    independent_user_presence: true,
    preview_acknowledged: true,
    same_user_endpoint: true,
    input_origin: "trusted_local_hardware",
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
import { createDisabledOperationalHostServiceProvider } from "../src/hostServiceOperationalProvider.js";
import { readHostServiceStatus } from "../src/hostServiceReadRuntime.js";
import { createSyntheticHostServiceProvider } from "../src/hostServiceSyntheticProvider.js";
import { resolveResourceDescriptor } from "../src/resourceRouter.js";

function fixture() {
  const inventory = createHostServiceInventory({
    domain: "testing",
    host_id: "host-fixture",
    inventory_generation: "host-gen-1",
    identity_generation: "boot-fixture-1",
    units: [{
      inventory_id: "service-fixture",
      inventory_generation: "unit-gen-1",
      unit_name: "soma-lab-fixture.service",
      fixture_id: "active-running",
      allowlisted: true,
      affected_closure: ["service-fixture"],
    }],
  });
  const handles = createHostServiceHandleTable({
    now: () => 1_000,
    random: () => "a".repeat(48),
  });
  const task = validateHostServiceTaskEnvelope({
    task_id: "task-1",
    objective: "Inspect the lab fixture.",
    host_id: "host-fixture",
    allowed_service_inventory_ids: ["service-fixture"],
    allowed_capabilities: [HOST_SERVICE_STATUS_CAPABILITY],
    consequence_ceiling: "C2",
    expires_at: 10_000,
    max_status_reads: 3,
    max_restart_plans: 0,
    max_successful_restarts: 0,
    route: "local",
    model_egress: "none",
  }, { now: () => 1_000 });
  const grant = {
    id: "grant-status",
    status: "active",
    capability: HOST_SERVICE_STATUS_CAPABILITY,
    provider: HOST_SERVICE_SYNTHETIC_PROVIDER_ID,
    scope: "session",
    constraints: {
      task_id: "task-1",
      host_id: "host-fixture",
      service_inventory_id: "service-fixture",
      domain: "testing",
      expires_at: 10_000,
    },
  };
  return { inventory, handles, task, grant };
}

test("host service capabilities are disabled-first and classify restart as C3", async () => {
  const catalog = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(
    new URL("../config/capability-catalog.json", import.meta.url),
    "utf8",
  )));
  const status = catalog.capabilities.find((entry) => entry.key === HOST_SERVICE_STATUS_CAPABILITY);
  const restart = catalog.capabilities.find((entry) => entry.key === HOST_SERVICE_RESTART_CAPABILITY);
  assert.equal(status.default_status, "disabled");
  assert.equal(status.consequence_class, "C0");
  assert.equal(restart.default_status, "disabled");
  assert.equal(restart.consequence_class, "C3");
  assert.equal(restart.allowed_scopes[0], "once");
  assert.equal(restart.reversible, false);
});

test("inventory mints task and grant bound opaque handles and rejects drift", () => {
  const { inventory, handles, grant } = fixture();
  const handle = handles.mint({
    inventory,
    inventory_id: "service-fixture",
    task_id: "task-1",
    grant_id: grant.id,
    provider_id: grant.provider,
    domain: "testing",
  });
  assert.match(handle, /^svc_[a-f0-9]{48}$/);
  assert.throws(
    () => handles.resolve({
      handle,
      inventory,
      task_id: "task-other",
      grant_id: grant.id,
      provider_id: grant.provider,
      domain: "testing",
    }),
    (error) => error.code === "service_handle_invalid",
  );

  const drifted = createHostServiceInventory({
    domain: "testing",
    host_id: "host-fixture",
    inventory_generation: "host-gen-2",
    identity_generation: "boot-fixture-1",
    units: [{
      inventory_id: "service-fixture",
      inventory_generation: "unit-gen-1",
      unit_name: "soma-lab-fixture.service",
      fixture_id: "active-running",
      allowlisted: true,
      affected_closure: ["service-fixture"],
    }],
  });
  assert.throws(
    () => handles.resolve({
      handle,
      inventory: drifted,
      task_id: "task-1",
      grant_id: grant.id,
      provider_id: grant.provider,
      domain: "testing",
    }),
    (error) => error.code === "service_inventory_drift",
  );
});

test("testing descriptor and synthetic status stay minimized with no live fallback", async () => {
  const { inventory, handles, task, grant } = fixture();
  const authorization = authorizeHostServiceRequest({
    capability: HOST_SERVICE_STATUS_CAPABILITY,
    task,
    grant,
    inventory_id: "service-fixture",
    provider_id: grant.provider,
    domain: "testing",
    now: () => 1_000,
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
    capability: HOST_SERVICE_STATUS_CAPABILITY,
    ref: { service_handle: serviceHandle, task_id: task.task_id },
    grant,
    hostServiceAuthority: { inventory, handles },
    hostServiceAuthorization: authorization,
  });
  assert.equal(descriptor.synthetic, true);
  assert.equal(descriptor.fixture_id, "active-running");
  assert.equal(Object.hasOwn(descriptor, "unit_name"), false);

  const provider = createSyntheticHostServiceProvider({
    now: () => 1_100,
    fixtures: {
      "active-running": {
        generation: "fixture-1",
        status: {
          load_state: "loaded",
          active_state: "active",
          sub_state: "running",
          unit_file_state_class: "enabled",
          can_restart: true,
          restart_policy_class: "allowed_with_confirmation",
          state_changed_at_bucket: "recent",
          healthy: true,
          status_text: "SECRET_CANARY",
          pid: 4242,
        },
      },
    },
  });
  const composedRead = await readHostServiceStatus({
    task,
    grant,
    inventory_id: "service-fixture",
    service_handle: serviceHandle,
    hostServiceAuthority: { inventory, handles },
    taskLedger: createHostServiceTaskLedger(),
    provider,
    now: () => 1_000,
  });
  const result = composedRead.result;
  assert.deepEqual(Object.keys(result), [
    "service_handle",
    "observation_generation",
    "load_state",
    "active_state",
    "sub_state",
    "unit_file_state_class",
    "can_restart",
    "restart_policy_class",
    "state_changed_at_bucket",
    "healthy",
    "content_included",
    "identifiers_included",
  ]);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_CANARY|4242|soma-lab-fixture/);
  assert.doesNotMatch(JSON.stringify(composedRead.provenance), /SECRET_CANARY|soma-lab-fixture/);

  await assert.rejects(
    resolveResourceDescriptor({
      domain: "operational",
      capability: HOST_SERVICE_STATUS_CAPABILITY,
      ref: { service_handle: serviceHandle, task_id: task.task_id },
      grant,
      hostServiceAuthority: { inventory, handles },
      hostServiceAuthorization: authorization,
    }),
    (error) => error.code === "service_status_unavailable",
  );

  await assert.rejects(
    resolveResourceDescriptor({
      domain: "testing",
      capability: HOST_SERVICE_STATUS_CAPABILITY,
      ref: { service_handle: serviceHandle, task_id: task.task_id },
      grant,
      hostServiceAuthority: { inventory, handles },
    }),
    (error) => error.code === "service_task_scope_denied",
  );
});

test("task ledger enforces the status read count", async () => {
  const { inventory, handles, task, grant } = fixture();
  const serviceHandle = handles.mint({
    inventory,
    inventory_id: "service-fixture",
    task_id: task.task_id,
    grant_id: grant.id,
    provider_id: grant.provider,
    domain: "testing",
  });
  const provider = createSyntheticHostServiceProvider({
    fixtures: {
      "active-running": {
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
      },
    },
  });
  const taskLedger = createHostServiceTaskLedger();
  for (let index = 0; index < task.max_status_reads; index += 1) {
    await readHostServiceStatus({
      task,
      grant,
      inventory_id: "service-fixture",
      service_handle: serviceHandle,
      hostServiceAuthority: { inventory, handles },
      taskLedger,
      provider,
      now: () => 1_000,
    });
  }
  await assert.rejects(
    readHostServiceStatus({
      task,
      grant,
      inventory_id: "service-fixture",
      service_handle: serviceHandle,
      hostServiceAuthority: { inventory, handles },
      taskLedger,
      provider,
      now: () => 1_000,
    }),
    (error) => error.code === "service_task_scope_denied",
  );
});

test("disabled operational provider refuses without touching its transport", () => {
  let calls = 0;
  const provider = createDisabledOperationalHostServiceProvider({
    transport: {
      call() {
        calls += 1;
      },
    },
  });
  for (const method of ["readStatusRaw", "inspectForPlan", "restart"]) {
    assert.throws(
      () => provider[method]({}),
      (error) => error.code === "service_status_unavailable",
    );
  }
  assert.equal(calls, 0);
});

test("task and grant constraints reject scope widening and C2 restart", () => {
  const { task, grant } = fixture();
  assert.throws(
    () => authorizeHostServiceRequest({
      capability: HOST_SERVICE_STATUS_CAPABILITY,
      task,
      grant: {
        ...grant,
        constraints: { ...grant.constraints, service_inventory_id: "other-service" },
      },
      inventory_id: "service-fixture",
      provider_id: grant.provider,
      domain: "testing",
      now: () => 1_000,
    }),
    (error) => error.code === "service_task_scope_denied",
  );

  const restartTask = Object.freeze({
    ...task,
    allowed_capabilities: Object.freeze([HOST_SERVICE_STATUS_CAPABILITY, HOST_SERVICE_RESTART_CAPABILITY]),
  });
  assert.throws(
    () => authorizeHostServiceRequest({
      capability: HOST_SERVICE_RESTART_CAPABILITY,
      task: restartTask,
      grant: {
        ...grant,
        id: "grant-restart",
        capability: HOST_SERVICE_RESTART_CAPABILITY,
        scope: "once",
      },
      inventory_id: "service-fixture",
      provider_id: grant.provider,
      domain: "testing",
      now: () => 1_000,
    }),
    (error) => error.code === "service_restart_classification_c3",
  );
});

test("task envelopes reject C4 as a consequence ceiling", () => {
  assert.throws(
    () => validateHostServiceTaskEnvelope({
      task_id: "task-c4",
      objective: "Invalid prohibited ceiling.",
      host_id: "host-fixture",
      allowed_service_inventory_ids: ["service-fixture"],
      allowed_capabilities: [HOST_SERVICE_STATUS_CAPABILITY],
      consequence_ceiling: "C4",
      expires_at: 10_000,
      max_status_reads: 1,
      route: "local",
      model_egress: "none",
    }, { now: () => 1_000 }),
    (error) => error.code === "service_task_scope_denied",
  );
});

test("categorically excluded and propagation-coupled services cannot mint handles", () => {
  for (const unit of [
    {
      inventory_id: "confirmation",
      inventory_generation: "1",
      unit_name: "confirmation.service",
      allowlisted: true,
      exclusion_classes: ["confirmation_path"],
      affected_closure: ["confirmation"],
    },
    {
      inventory_id: "coupled",
      inventory_generation: "1",
      unit_name: "coupled.service",
      allowlisted: true,
      affected_closure: ["coupled", "other"],
    },
  ]) {
    const inventory = createHostServiceInventory({
      domain: "testing",
      host_id: "host-fixture",
      inventory_generation: "1",
      identity_generation: "1",
      units: [unit],
    });
    const handles = createHostServiceHandleTable();
    assert.throws(
      () => handles.mint({
        inventory,
        inventory_id: unit.inventory_id,
        task_id: "task",
        grant_id: "grant",
        provider_id: HOST_SERVICE_SYNTHETIC_PROVIDER_ID,
        domain: "testing",
      }),
      (error) => error.code === "service_unit_dependency_closure_unsafe",
    );
  }
});

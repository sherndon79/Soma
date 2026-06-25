import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleContextBundle,
  createCompositeSourceState,
  createOccupantMemorySnapshot,
  projectFrontierFacingManifest,
  validateContextRecipe,
} from "../src/contextAssembly.js";

const NOW = "2026-06-25T03:30:00.000Z";

function ids() {
  let next = 0;
  return () => {
    next += 1;
    return String(next).padStart(4, "0");
  };
}

function baseRecipe(overrides = {}) {
  return {
    schema_version: 1,
    recipe_id: "recipe-multi-1",
    origin: "fixture",
    objective_class: "prepare_successor_context",
    source_selectors: [
      memorySelector(),
      activitySelector(),
    ],
    capability_classes: ["memory_context", "activity_context"],
    required_receipt_types: ["source_receipt", "selection_receipt", "memory_snapshot", "activity_snapshot"],
    context_budget: {
      max_items: 8,
      max_chars: 4_000,
      overflow_policy: "evict_oldest",
    },
    ordering: "newest_first",
    source_class_order: ["local_activity_fixture", "occupant_memory"],
    abstention_criteria: ["missing_required_receipt", "source_degraded", "replay_state_unpinned"],
    abstract_slots: ["current_domain", "current_task_class"],
    ...overrides,
  };
}

function memorySelector(overrides = {}) {
  return {
    source_class: "occupant_memory",
    required: true,
    constraints: {
      domain: "testing",
      memory_classes: ["self_note"],
      include_tombstones: false,
      recency_window: "all",
      consent_scope: "successor_inheritance",
    },
    minimization: "excerpt_for_reasoner",
    budget: {
      max_items: 4,
      max_chars: 2_000,
      overflow_policy: "evict_oldest",
    },
    ...overrides,
  };
}

function activitySelector(overrides = {}) {
  return {
    source_class: "local_activity_fixture",
    required: false,
    constraints: {
      domain: "testing",
      activity_classes: ["capability_use", "control", "status"],
      event_types: ["model.chat.completed", "capability.invoked", "capability.refused", "occupant_ejected"],
      capability_classes: ["model", "memory", "desktop", "system"],
      summary_classes: ["completed", "refused", "control", "status"],
    },
    minimization: "activity_summary",
    budget: {
      max_items: 4,
      max_chars: 2_000,
      overflow_policy: "evict_oldest",
    },
    ...overrides,
  };
}

function memoryStore() {
  return {
    schema_version: 1,
    entries: [
      memoryEntry({
        id: "mem-old",
        content: "Older note about pacing and checking capability boundaries.",
        created_at: "2026-06-20T12:00:00.000Z",
      }),
      memoryEntry({
        id: "mem-new",
        content: "Newest note: preserve the channel distinction and verify before claiming completion.",
        created_at: "2026-06-24T12:00:00.000Z",
      }),
      memoryEntry({
        id: "mem-other-domain",
        content: "Operational note outside testing domain.",
        domain: "general",
        created_at: "2026-06-23T12:00:00.000Z",
      }),
      memoryEntry({
        id: "mem-long",
        content: "Long note ".repeat(90),
        created_at: "2026-06-22T12:00:00.000Z",
      }),
    ],
    tombstones: [
      {
        entry_id: "mem-removed",
        memory_class: "self_note",
        model_id: "claude-fable-5",
        episode_id: "drawer-a",
        domain: "testing",
        created_at: "2026-06-19T12:00:00.000Z",
        removed_at: "2026-06-21T12:00:00.000Z",
        removed_by: "occupant",
        reason_class: "occupant_revoke",
        grant_id: "grant-memory",
        provider: "soma.provider.occupant-memory",
        scope: "session",
      },
    ],
  };
}

function memoryEntry(overrides = {}) {
  return {
    id: "mem-entry",
    memory_class: "self_note",
    content: "Memory content.",
    tags: ["private-tag"],
    model_id: "claude-fable-5",
    episode_id: "drawer-a",
    domain: "testing",
    created_at: "2026-06-20T12:00:00.000Z",
    created_by: "occupant",
    grant_id: "grant-memory",
    provider: "soma.provider.occupant-memory",
    scope: "session",
    status: "active",
    ...overrides,
  };
}

function activityStore() {
  return {
    schema_version: 1,
    events: [
      activityEvent({
        id: "act-chat",
        timestamp: "2026-06-25T03:00:00.000Z",
        activity_class: "capability_use",
        event_type: "model.chat.completed",
        capability_class: "model",
        summary_class: "completed",
      }),
      activityEvent({
        id: "act-memory",
        timestamp: "2026-06-25T02:00:00.000Z",
        activity_class: "capability_use",
        event_type: "capability.invoked",
        capability_class: "memory",
        summary_class: "completed",
      }),
      activityEvent({
        id: "act-control",
        timestamp: "2026-06-24T22:00:00.000Z",
        activity_class: "control",
        event_type: "occupant_ejected",
        capability_class: "system",
        summary_class: "control",
      }),
      activityEvent({
        id: "act-other-domain",
        timestamp: "2026-06-25T01:00:00.000Z",
        domain: "general",
      }),
    ],
  };
}

function activityEvent(overrides = {}) {
  return {
    id: "act-event",
    timestamp: "2026-06-25T00:00:00.000Z",
    activity_class: "status",
    event_type: "capability.refused",
    capability_class: "desktop",
    domain: "testing",
    summary_class: "refused",
    ...overrides,
  };
}

function assemble(recipe = baseRecipe(), extra = {}) {
  return assembleContextBundle({
    recipe,
    occupantMemoryStore: memoryStore(),
    activityStore: activityStore(),
    now: () => new Date(NOW),
    idFactory: ids(),
    ...extra,
  });
}

test("ContextRecipe validator accepts per-adapter source selectors", () => {
  const recipe = validateContextRecipe(baseRecipe());

  assert.equal(recipe.source_selectors.length, 2);
  assert.equal(recipe.source_selectors[0].source_class, "occupant_memory");
  assert.equal(recipe.source_selectors[1].source_class, "local_activity_fixture");
  assert.equal(recipe.source_selectors[1].constraints.activity_classes.includes("capability_use"), true);
});

test("per-adapter validation rejects payload-vector and arbitrary unknown keys without value echo", () => {
  const payloadVector = assemble(baseRecipe({
    source_selectors: [
      memorySelector({
        constraints: {
          ...memorySelector().constraints,
          tags: ["Seth-private-event"],
        },
      }),
    ],
  }));
  assert.equal(payloadVector.status, "refused");
  assert.equal(payloadVector.local_audit_manifest.reason_class, "selector_payload_bearing");
  assert.equal(payloadVector.frontier_facing_manifest.violated_field_class, "source_selectors.constraints.tags");
  assert.equal(JSON.stringify(payloadVector.frontier_facing_manifest).includes("Seth-private-event"), false);
  assert.equal(JSON.stringify(payloadVector.frontier_facing_manifest).includes("recipe_digest"), false);

  const arbitrary = assemble(baseRecipe({
    source_selectors: [
      activitySelector({
        constraints: {
          ...activitySelector().constraints,
          "private-event-name": true,
        },
      }),
    ],
  }));
  assert.equal(arbitrary.status, "refused");
  assert.equal(arbitrary.local_audit_manifest.reason_class, "recipe_schema_invalid");
  assert.equal(arbitrary.frontier_facing_manifest.violated_field_class, "source_selectors.constraints.unknown_field");
  assert.equal(JSON.stringify(arbitrary.frontier_facing_manifest).includes("private-event-name"), false);
});

test("composite source state is deterministic over reordered multi-source state", () => {
  const memory = createOccupantMemorySnapshot(memoryStore());
  const result = assemble();
  const sourceState = result.local_audit_manifest.source_state;
  const reversed = createCompositeSourceState({
    local_activity_fixture: sourceState.sources.local_activity_fixture,
    occupant_memory: memory,
  });

  assert.equal(sourceState.composite_snapshot_digest, reversed.composite_snapshot_digest);
  assert.equal(sourceState.sources.occupant_memory.snapshot_digest, memory.snapshot_digest);
  assert.equal(sourceState.sources.local_activity_fixture.snapshot_digest.length, 64);
});

test("assembler creates deterministic multi-source bundle and content-free local receipts", () => {
  const first = assemble();
  const second = assemble();

  assert.equal(first.status, "assembled");
  assert.equal(first.bundle_body.includes("Local activity fixture"), true);
  assert.equal(first.bundle_body.includes("Newest note"), true);
  assert.equal(first.local_audit_manifest.bundle_digest, second.local_audit_manifest.bundle_digest);
  assert.equal(
    first.local_audit_manifest.source_state.composite_snapshot_digest,
    second.local_audit_manifest.source_state.composite_snapshot_digest,
  );
  assert.equal(first.local_audit_manifest.source_receipts.every((receipt) => receipt.content_included === false), true);
  assert.equal(first.local_audit_manifest.selection_receipts.every((receipt) => receipt.content_included === false), true);
  assert.equal(JSON.stringify(first.local_audit_manifest).includes("Newest note"), false);
});

test("cross-source ordering supports newest_first class_priority and receipt_priority", () => {
  const newest = assemble(baseRecipe({ ordering: "newest_first" }));
  assert.match(newest.bundle_body.split("\n")[0], /Local activity fixture/);

  const classPriority = assemble(baseRecipe({
    ordering: "class_priority",
    source_class_order: ["occupant_memory", "local_activity_fixture"],
  }));
  assert.match(classPriority.bundle_body.split("\n")[0], /Memory class/);

  const receiptPriority = assemble(baseRecipe({ ordering: "receipt_priority" }));
  assert.match(receiptPriority.bundle_body.split("\n")[0], /Memory class/);
});

test("per-source sub-budgets and global cap record deterministic evictions", () => {
  const result = assemble(baseRecipe({
    source_selectors: [
      memorySelector({ budget: { max_items: 1, max_chars: 1_500, overflow_policy: "evict_oldest" } }),
      activitySelector({ budget: { max_items: 1, max_chars: 1_500, overflow_policy: "evict_oldest" } }),
    ],
    context_budget: { max_items: 1, max_chars: 1_500, overflow_policy: "evict_oldest" },
  }));

  assert.equal(result.status, "assembled");
  assert.equal(result.local_audit_manifest.budget.included_count, 1);
  assert.equal(result.local_audit_manifest.budget.excluded_count > 0, true);
  assert.equal(
    result.local_audit_manifest.selection_receipts.some((receipt) => receipt.reason_class === "budget_evicted"),
    true,
  );
  assert.equal(result.frontier_facing_manifest.included_count_class, "some");
  assert.equal(["some", "many"].includes(result.frontier_facing_manifest.excluded_count_class), true);
});

test("per-source budgets are maximums not final bundle reservations", () => {
  const result = assemble(baseRecipe({
    ordering: "newest_first",
    source_selectors: [
      memorySelector({ budget: { max_items: 2, max_chars: 4_000, overflow_policy: "evict_oldest" } }),
      activitySelector({ budget: { max_items: 3, max_chars: 4_000, overflow_policy: "evict_oldest" } }),
    ],
    context_budget: { max_items: 2, max_chars: 4_000, overflow_policy: "evict_oldest" },
  }));

  assert.equal(result.status, "assembled");
  assert.equal(result.bundle_body.includes("Local activity fixture"), true);
  assert.equal(result.bundle_body.includes("Memory class"), false);
  assert.equal(
    result.local_audit_manifest.selection_receipts.some((receipt) => (
      receipt.source_class === "occupant_memory"
        && receipt.decision === "excluded"
        && receipt.reason_class === "budget_evicted"
    )),
    true,
  );
});

test("required degraded source abstains and optional degraded source skips with coarse frontier signal", () => {
  const required = assemble(baseRecipe(), {
    sourceRecoveryReports: { occupant_memory: { degraded: true } },
  });
  assert.equal(required.status, "refused");
  assert.equal(required.local_audit_manifest.reason_class, "source_degraded");
  assert.equal(required.frontier_facing_manifest.reason_class, "source_degraded");
  assert.deepEqual(required.frontier_facing_manifest.source_omissions, [
    {
      source_class: "occupant_memory",
      required: true,
      reason_class: "source_degraded",
      count_class: "many",
    },
  ]);

  const optional = assemble(baseRecipe(), {
    sourceRecoveryReports: { local_activity_fixture: { degraded: true } },
  });
  assert.equal(optional.status, "assembled");
  assert.equal(optional.bundle_body.includes("Newest note"), true);
  assert.equal(optional.bundle_body.includes("Local activity fixture"), false);
  assert.deepEqual(optional.frontier_facing_manifest.source_omissions, [
    {
      source_class: "local_activity_fixture",
      required: false,
      reason_class: "source_degraded",
      count_class: "many",
    },
  ]);
});

test("frontier-facing manifest carries only coarse counts and no ids digests or timestamps", () => {
  const result = assemble();
  const projected = projectFrontierFacingManifest(result.local_audit_manifest);
  const projectedJson = JSON.stringify(projected);

  assert.equal(projected.status, "assembled");
  assert.equal(Object.hasOwn(projected, "included_count"), false);
  assert.equal(Object.hasOwn(projected, "excluded_count"), false);
  assert.equal(["some", "many"].includes(projected.included_count_class), true);
  assert.equal(["none", "some", "many"].includes(projected.excluded_count_class), true);
  assert.equal(projectedJson.includes("snapshot_digest"), false);
  assert.equal(projectedJson.includes("composite_snapshot_digest"), false);
  assert.equal(projectedJson.includes("bundle_digest"), false);
  assert.equal(projectedJson.includes("content_digest"), false);
  assert.equal(projectedJson.includes("mem-new"), false);
  assert.equal(projectedJson.includes("act-chat"), false);
  assert.equal(projectedJson.includes("2026-06-25T03:00:00.000Z"), false);
});

test("missing optional source state skips and missing required source state abstains", () => {
  const optional = assemble(baseRecipe(), { activityStore: null });
  assert.equal(optional.status, "assembled");
  assert.equal(optional.frontier_facing_manifest.source_omissions[0].reason_class, "replay_state_unpinned");
  assert.equal(optional.frontier_facing_manifest.source_omissions[0].count_class, "none");

  const required = assemble(baseRecipe(), { occupantMemoryStore: null });
  assert.equal(required.status, "refused");
  assert.equal(required.local_audit_manifest.reason_class, "replay_state_unpinned");
  assert.equal(required.bundle_body, "");
});

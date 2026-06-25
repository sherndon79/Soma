import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleContextBundle,
  createOccupantMemorySnapshot,
  projectFrontierFacingManifest,
  validateContextRecipe,
} from "../src/contextAssembly.js";

const NOW = "2026-06-25T02:30:00.000Z";

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
    recipe_id: "recipe-memory-1",
    origin: "fixture",
    objective_class: "prepare_successor_context",
    source_classes: ["occupant_memory"],
    capability_classes: ["memory_context"],
    constraints: {
      domain: "testing",
      memory_classes: ["self_note"],
      max_items: 8,
      max_chars: 4_000,
      include_tombstones: false,
      recency_window: "all",
      consent_scope: "successor_inheritance",
    },
    required_receipt_types: ["source_receipt", "selection_receipt", "memory_snapshot"],
    context_budget: {
      max_items: 8,
      max_chars: 4_000,
      reserve_chars: 0,
      overflow_policy: "evict_oldest",
    },
    ordering: ["newest_first"],
    minimization: "excerpt_for_reasoner",
    abstention_criteria: ["missing_required_receipt", "source_degraded", "replay_state_unpinned"],
    abstract_slots: ["current_domain", "current_task_class"],
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

test("ContextRecipe validator accepts only the closed positive slot-bearing schema", () => {
  const recipe = validateContextRecipe(baseRecipe());

  assert.equal(recipe.recipe_id, "recipe-memory-1");
  assert.equal(recipe.source_classes[0], "occupant_memory");
  assert.equal(recipe.constraints.domain, "testing");
  assert.equal(Object.hasOwn(recipe.constraints, "tags"), false);
});

test("ContextRecipe rejects tag selector payload smuggling without echoing private value", () => {
  const result = assembleContextBundle({
    recipe: baseRecipe({
      constraints: {
        ...baseRecipe().constraints,
        tags: ["Seth-private-event"],
      },
    }),
    occupantMemoryStore: memoryStore(),
    now: () => new Date(NOW),
    idFactory: ids(),
  });

  assert.equal(result.status, "refused");
  assert.equal(result.bundle_body, "");
  assert.equal(result.local_audit_manifest.reason_class, "selector_payload_bearing");
  assert.equal(result.local_audit_manifest.recipe_digest, "");
  assert.equal(result.frontier_facing_manifest.reason_class, "selector_payload_bearing");
  assert.equal(result.frontier_facing_manifest.violated_field_class, "constraints.tags");
  assert.equal(JSON.stringify(result.frontier_facing_manifest).includes("Seth-private-event"), false);
  assert.equal(JSON.stringify(result.frontier_facing_manifest).includes("recipe_digest"), false);
});

test("ContextRecipe refuses arbitrary unknown keys without echoing key residue", () => {
  const result = assembleContextBundle({
    recipe: baseRecipe({
      constraints: {
        ...baseRecipe().constraints,
        "private-event-name": true,
      },
    }),
    occupantMemoryStore: memoryStore(),
    now: () => new Date(NOW),
    idFactory: ids(),
  });

  assert.equal(result.status, "refused");
  assert.equal(result.local_audit_manifest.reason_class, "recipe_schema_invalid");
  assert.equal(result.frontier_facing_manifest.violated_field_class, "constraints.unknown_field");
  assert.equal(JSON.stringify(result.frontier_facing_manifest).includes("private-event-name"), false);
  assert.equal(JSON.stringify(result.frontier_facing_manifest).includes("recipe_digest"), false);
});

test("memory snapshot digest is deterministic over normalized source state", () => {
  const left = createOccupantMemorySnapshot(memoryStore());
  const reordered = memoryStore();
  reordered.entries = [...reordered.entries].reverse();
  reordered.tombstones = [...reordered.tombstones].reverse();
  const right = createOccupantMemorySnapshot(reordered);

  assert.equal(left.snapshot_digest, right.snapshot_digest);
  assert.equal(left.active_entry_count, 4);
  assert.equal(left.tombstone_count, 1);
  assert.equal(left.newest_timestamp, "2026-06-24T12:00:00.000Z");
});

test("assembler creates deterministic bundle with source state and content-free receipts", () => {
  const recipe = baseRecipe();
  const options = {
    recipe,
    occupantMemoryStore: memoryStore(),
    now: () => new Date(NOW),
  };
  const first = assembleContextBundle({ ...options, idFactory: ids() });
  const second = assembleContextBundle({ ...options, idFactory: ids() });

  assert.equal(first.status, "assembled");
  assert.equal(first.bundle_body.includes("Newest note"), true);
  assert.equal(first.bundle_body.includes("Operational note outside testing domain"), false);
  assert.equal(
    first.local_audit_manifest.bundle_digest,
    second.local_audit_manifest.bundle_digest,
  );
  assert.equal(
    first.local_audit_manifest.source_state.snapshot_digest,
    second.local_audit_manifest.source_state.snapshot_digest,
  );
  assert.equal(first.local_audit_manifest.source_receipts.length > 0, true);
  assert.equal(first.local_audit_manifest.selection_receipts.length > 0, true);
  assert.equal(first.local_audit_manifest.source_receipts[0].content_included, false);
  assert.equal(first.local_audit_manifest.selection_receipts[0].content_included, false);
  assert.equal(JSON.stringify(first.local_audit_manifest).includes("Newest note"), false);
});

test("budget enforcement evicts deterministically and records content-free selection receipts", () => {
  const result = assembleContextBundle({
    recipe: baseRecipe({
      context_budget: {
        max_items: 1,
        max_chars: 600,
        reserve_chars: 0,
        overflow_policy: "evict_oldest",
      },
    }),
    occupantMemoryStore: memoryStore(),
    now: () => new Date(NOW),
    idFactory: ids(),
  });

  assert.equal(result.status, "assembled");
  assert.equal(result.local_audit_manifest.budget.included_count, 1);
  assert.equal(result.local_audit_manifest.budget.excluded_count > 0, true);
  assert.equal(
    result.local_audit_manifest.selection_receipts.some((receipt) => receipt.reason_class === "budget_evicted"),
    true,
  );
  assert.equal(result.frontier_facing_manifest.included_count, 1);
  assert.equal(result.frontier_facing_manifest.excluded_count > 0, true);
});

test("abstain overflow policy returns manifestable refusal", () => {
  const result = assembleContextBundle({
    recipe: baseRecipe({
      context_budget: {
        max_items: 1,
        max_chars: 600,
        reserve_chars: 0,
        overflow_policy: "abstain",
      },
    }),
    occupantMemoryStore: memoryStore(),
    now: () => new Date(NOW),
    idFactory: ids(),
  });

  assert.equal(result.status, "refused");
  assert.equal(result.bundle_body, "");
  assert.equal(result.content_included, false);
  assert.equal(result.local_audit_manifest.reason_class, "budget_insufficient");
  assert.equal(result.local_audit_manifest.source_receipts.length > 0, true);
  assert.equal(result.frontier_facing_manifest.reason_class, "budget_insufficient");
  assert.equal(result.frontier_facing_manifest.abstention_record.reason_class, "budget_insufficient");
});

test("missing source state and degraded memory abstain without assembling content", () => {
  const missing = assembleContextBundle({
    recipe: baseRecipe(),
    now: () => new Date(NOW),
    idFactory: ids(),
  });
  assert.equal(missing.status, "refused");
  assert.equal(missing.local_audit_manifest.reason_class, "replay_state_unpinned");
  assert.equal(missing.bundle_body, "");

  const degraded = assembleContextBundle({
    recipe: baseRecipe(),
    occupantMemoryStore: memoryStore(),
    occupantMemoryRecoveryReport: { degraded: true },
    now: () => new Date(NOW),
    idFactory: ids(),
  });
  assert.equal(degraded.status, "refused");
  assert.equal(degraded.local_audit_manifest.reason_class, "source_degraded");
  assert.equal(degraded.bundle_body, "");
  assert.equal(degraded.local_audit_manifest.source_state.snapshot_digest.length, 64);
});

test("frontier-facing manifest projector strips local audit digests and item identifiers", () => {
  const result = assembleContextBundle({
    recipe: baseRecipe(),
    occupantMemoryStore: memoryStore(),
    now: () => new Date(NOW),
    idFactory: ids(),
  });
  const projected = projectFrontierFacingManifest(result.local_audit_manifest);
  const projectedJson = JSON.stringify(projected);

  assert.equal(projected.status, "assembled");
  assert.equal(projectedJson.includes("snapshot_digest"), false);
  assert.equal(projectedJson.includes("bundle_digest"), false);
  assert.equal(projectedJson.includes("content_digest"), false);
  assert.equal(projectedJson.includes("mem-new"), false);
  assert.equal(projectedJson.includes("2026-06-24T12:00:00.000Z"), false);
});

test("tombstone minimization counts rendered body against character budget", () => {
  const result = assembleContextBundle({
    recipe: baseRecipe({
      constraints: {
        ...baseRecipe().constraints,
        include_tombstones: true,
      },
      context_budget: {
        max_items: 8,
        max_chars: 50,
        reserve_chars: 0,
        overflow_policy: "abstain",
      },
    }),
    occupantMemoryStore: {
      schema_version: 1,
      entries: [],
      tombstones: memoryStore().tombstones,
    },
    now: () => new Date(NOW),
    idFactory: ids(),
  });

  assert.equal(result.status, "refused");
  assert.equal(result.local_audit_manifest.reason_class, "budget_insufficient");
  assert.equal(
    result.local_audit_manifest.selection_receipts.some((receipt) => receipt.reason_class === "budget_evicted"),
    true,
  );
});

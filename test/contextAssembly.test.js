import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
    source_class_order: ["durable_provenance_activity", "occupant_memory"],
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
    source_class: "durable_provenance_activity",
    required: false,
    constraints: {
      domain: "testing",
      activity_classes: ["capability_use", "control"],
      event_types: ["memory.provenance.written", "memory.provenance.revoked"],
      capability_classes: ["memory"],
      summary_classes: ["completed", "control"],
      coarse_time_buckets: ["recent", "older", "unknown"],
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

function ringSelector(overrides = {}) {
  return {
    source_class: "ephemeral_provenance_ring",
    required: true,
    constraints: {
      activity_classes: ["capability_use", "observation", "status", "control"],
      event_types: [
        "ring.model.chat.completed",
        "ring.model.chat.denied",
        "ring.model.chat.requested",
        "ring.model.tool_call_intent",
        "ring.desktop.inspected",
        "ring.memory.read",
        "ring.memory.session_written",
        "ring.memory.session_removed",
      ],
      capability_classes: ["model", "desktop", "memory"],
      summary_classes: ["completed", "refused", "status", "observed", "control"],
      coarse_time_buckets: ["recent", "older", "unknown"],
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

function ringRecipe(overrides = {}) {
  return baseRecipe({
    source_selectors: [
      memorySelector(),
      activitySelector(),
      ringSelector(),
    ],
    source_class_order: ["ephemeral_provenance_ring", "durable_provenance_activity", "occupant_memory"],
    context_budget: {
      max_items: 10,
      max_chars: 6_000,
      overflow_policy: "evict_oldest",
    },
    ...overrides,
  });
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
    records: [
      provenanceRecord({
        entry_id: "prov-new",
        timestamp: "2026-06-25T03:00:00.000Z",
        event_type: "occupant.memory.written",
        actor: "claude-private-actor",
        model_id: "provenance-private-model",
        episode_id: "episode-private-alpha",
        grant_id: "grant-secret-new",
        provider: "soma.provider.occupant-memory",
      }),
      provenanceRecord({
        entry_id: "prov-revoked",
        timestamp: "2026-06-25T02:00:00.000Z",
        event_type: "occupant.memory.revoked",
        reason_class: "occupant_revoke",
        grant_id: "grant-secret-revoked",
      }),
      provenanceRecord({
        entry_id: "prov-old",
        timestamp: "2026-06-24T22:00:00.000Z",
        event_type: "occupant.memory.written",
      }),
      provenanceRecord({
        entry_id: "prov-other-domain",
        timestamp: "2026-06-25T01:00:00.000Z",
        domain: "general",
      }),
    ],
  };
}

function ringStore() {
  return {
    schema_version: 1,
    entries: [
      ringEvent({
        id: "ring-model-complete",
        event_type: "model.chat.completed",
        timestamp: "2026-06-25T03:20:00.000Z",
        capability: "model.local.chat",
        caller_identity: "frontier-private-caller",
        episode_id: "episode-ring-private",
      }),
      ringEvent({
        id: "ring-desktop",
        event_type: "desktop.inspect.focus",
        timestamp: "2026-06-25T03:10:00.000Z",
        capability: "desktop.inspect.focus",
        grant_id: "grant-ring-desktop",
        provider: "soma.provider.desktop",
      }),
      ringEvent({
        id: "ring-self",
        event_type: "context.assembly.started",
        timestamp: "2026-06-25T03:30:00.000Z",
      }),
      ringEvent({
        id: "ring-unmapped",
        event_type: "provenance.summary.read",
        timestamp: "2026-06-25T03:25:00.000Z",
      }),
    ],
  };
}

function ringEvent(overrides = {}) {
  return {
    id: "ring-event",
    event_type: "model.chat.requested",
    timestamp: "2026-06-25T03:00:00.000Z",
    capability: "model.local.chat",
    caller_identity: "ring-caller",
    grant_id: "ring-grant",
    provider: "ring-provider",
    scope: "session",
    episode_id: "ring-episode",
    allowed: true,
    memory_written: false,
    memory_read: false,
    remote_service_used: false,
    activation_performed: false,
    ...overrides,
  };
}

function provenanceRecord(overrides = {}) {
  return {
    event_type: "occupant.memory.written",
    entry_id: "prov-entry",
    memory_class: "self_note",
    actor: "occupant",
    reason_class: "",
    timestamp: "2026-06-25T00:00:00.000Z",
    model_id: "claude-fable-5",
    episode_id: "drawer-a",
    domain: "testing",
    grant_id: "grant-memory",
    provider: "soma.provider.occupant-memory",
    scope: "session",
    activation_performed: false,
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

function canonicalJson(value) {
  return JSON.stringify(sortObject(value));
}

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function legacyBudgetDigestProjection(budget) {
  return {
    max_items: budget.max_items,
    max_chars: budget.max_chars,
    used_chars: budget.used_chars,
    included_count: budget.included_count,
    excluded_count: budget.excluded_count,
    overflow_policy: budget.overflow_policy,
    budget_exhausted: budget.budget_exhausted,
    source_omission_count: budget.source_omission_count,
    per_source: Object.fromEntries(Object.entries(budget.per_source).map(([sourceClass, sourceBudget]) => [sourceClass, {
      max_items: sourceBudget.max_items,
      max_chars: sourceBudget.max_chars,
      included_count: sourceBudget.included_count,
      excluded_count: sourceBudget.excluded_count,
    }])),
  };
}

function expectedLegacyBundleDigest(result) {
  return digest(canonicalJson({
    recipe_digest: result.local_audit_manifest.recipe_digest,
    composite_snapshot_digest: result.local_audit_manifest.source_state.composite_snapshot_digest,
    bundle_body: result.bundle_body,
    budget: legacyBudgetDigestProjection(result.local_audit_manifest.budget),
    source_omissions: result.local_audit_manifest.source_omissions,
  }));
}

test("ContextRecipe validator accepts per-adapter source selectors", () => {
  const recipe = validateContextRecipe(baseRecipe());

  assert.equal(recipe.source_selectors.length, 2);
  assert.equal(recipe.source_selectors[0].source_class, "occupant_memory");
  assert.equal(recipe.source_selectors[1].source_class, "durable_provenance_activity");
  assert.equal(recipe.source_selectors[1].constraints.activity_classes.includes("capability_use"), true);
});

test("default source registry no longer accepts the synthetic activity fixture", () => {
  const result = assemble(baseRecipe({
    source_selectors: [
      memorySelector(),
      activitySelector({ source_class: "local_activity_fixture" }),
    ],
    source_class_order: ["local_activity_fixture", "occupant_memory"],
  }));

  assert.equal(result.status, "refused");
  assert.equal(result.local_audit_manifest.reason_class, "recipe_schema_invalid");
  assert.equal(result.frontier_facing_manifest.violated_field_class, "source_selectors.source_class");
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
    durable_provenance_activity: sourceState.sources.durable_provenance_activity,
    occupant_memory: memory,
  });

  assert.equal(sourceState.composite_snapshot_digest, reversed.composite_snapshot_digest);
  assert.equal(sourceState.sources.occupant_memory.snapshot_digest, memory.snapshot_digest);
  assert.equal(sourceState.sources.durable_provenance_activity.snapshot_digest.length, 64);
});

test("assembler creates deterministic multi-source bundle and content-free local receipts", () => {
  const first = assemble();
  const second = assemble();

  assert.equal(first.status, "assembled");
  assert.equal(first.bundle_body.includes("Durable provenance activity"), true);
  assert.equal(first.bundle_body.includes("Newest note"), true);
  assert.equal(first.local_audit_manifest.source_state.sources.durable_provenance_activity.trust_tier, "local_provenance");
  assert.equal(first.local_audit_manifest.bundle_digest, second.local_audit_manifest.bundle_digest);
  assert.equal(
    first.local_audit_manifest.source_state.composite_snapshot_digest,
    second.local_audit_manifest.source_state.composite_snapshot_digest,
  );
  assert.equal(first.local_audit_manifest.source_receipts.every((receipt) => receipt.content_included === false), true);
  assert.equal(first.local_audit_manifest.selection_receipts.every((receipt) => receipt.content_included === false), true);
  assert.equal(JSON.stringify(first.local_audit_manifest).includes("Newest note"), false);
});

test("durable provenance projection drops linkable raw identifiers from bundle body", () => {
  const result = assemble();
  const body = result.bundle_body;
  const audit = JSON.stringify(result.local_audit_manifest.source_receipts);

  assert.equal(body.includes("Durable provenance activity"), true);
  for (const forbidden of [
    "prov-new",
    "grant-secret-new",
    "soma.provider.occupant-memory",
    "claude-private-actor",
    "provenance-private-model",
    "episode-private-alpha",
    "2026-06-25T03:00:00.000Z",
    "content_digest",
    "tombstone_digest",
    "approval_provenance_id",
    "source_proposal_id",
    "replacement_grant_id",
  ]) {
    assert.equal(body.includes(forbidden), false, `${forbidden} leaked into bundle_body`);
  }
  assert.equal(audit.includes("prov-new"), true);
  assert.equal(audit.includes("grant-secret-new"), true);
  assert.equal(audit.includes("episode-private-alpha"), true);
});

test("durable provenance snapshot covers raw records while projection stays minimized", () => {
  const first = assemble();
  const changed = activityStore();
  changed.records[0] = {
    ...changed.records[0],
    actor: "different-linkable-actor",
    grant_id: "different-grant-id",
  };
  const second = assemble(baseRecipe(), { activityStore: changed });

  assert.equal(second.status, "assembled");
  assert.equal(first.bundle_body, second.bundle_body);
  assert.notEqual(
    first.local_audit_manifest.source_state.sources.durable_provenance_activity.snapshot_digest,
    second.local_audit_manifest.source_state.sources.durable_provenance_activity.snapshot_digest,
  );
  assert.notEqual(first.local_audit_manifest.bundle_digest, second.local_audit_manifest.bundle_digest);
});

test("durable provenance skips unknown event types without raw pass-through", () => {
  const store = activityStore();
  store.records.unshift({
    ...provenanceRecord({
      event_type: "occupant.memory.renamed",
      entry_id: "private-rename-event",
      timestamp: "2026-06-25T04:00:00.000Z",
    }),
  });
  const result = assemble(baseRecipe(), { activityStore: store });

  assert.equal(result.status, "assembled");
  assert.equal(result.bundle_body.includes("occupant.memory.renamed"), false);
  assert.equal(result.bundle_body.includes("private-rename-event"), false);
  assert.equal(JSON.stringify(result.local_audit_manifest.source_receipts).includes("private-rename-event"), false);
  assert.equal(result.bundle_body.includes("Durable provenance activity"), true);
});

test("fresh ephemeral ring assembly freezes and returns replay artifact", () => {
  const result = assemble(ringRecipe(), {
    sourceStores: { ephemeral_provenance_ring: ringStore() },
  });

  assert.equal(result.status, "assembled");
  assert.equal(result.bundle_body.includes("Ephemeral provenance ring activity"), true);
  assert.equal(result.local_audit_manifest.source_state.sources.ephemeral_provenance_ring.freshness_class, "ephemeral");
  assert.equal(result.local_audit_manifest.source_state.sources.ephemeral_provenance_ring.replay_artifact_ref.length > 0, true);
  assert.equal(result.replay_artifacts.ephemeral_provenance_ring.source_class, "ephemeral_provenance_ring");
  assert.equal(
    result.replay_artifacts.ephemeral_provenance_ring.snapshot_digest,
    result.local_audit_manifest.source_state.sources.ephemeral_provenance_ring.snapshot_digest,
  );
  assert.equal(Array.isArray(result.replay_artifacts.ephemeral_provenance_ring.frozen_records), true);
});

test("ephemeral ring replay uses supplied frozen artifact and ignores live drift", () => {
  const recipe = ringRecipe();
  const first = assemble(recipe, {
    sourceStores: { ephemeral_provenance_ring: ringStore() },
  });
  const expected = first.replay_artifacts.ephemeral_provenance_ring.snapshot_digest;
  const drifted = ringStore();
  drifted.entries.unshift(ringEvent({
    id: "ring-newer-drift",
    event_type: "model.chat.denied",
    timestamp: "2026-06-25T04:00:00.000Z",
  }));

  const replayed = assemble(recipe, {
    sourceStores: { ephemeral_provenance_ring: drifted },
    replay: { ephemeral_provenance_ring: { expected_snapshot_digest: expected } },
    replayArtifacts: { ephemeral_provenance_ring: first.replay_artifacts.ephemeral_provenance_ring },
  });

  assert.equal(replayed.status, "assembled");
  assert.equal(replayed.bundle_body, first.bundle_body);
  assert.equal(replayed.local_audit_manifest.bundle_digest, first.local_audit_manifest.bundle_digest);
});

test("ephemeral ring replay without frozen artifact refuses instead of reading live ring", () => {
  const first = assemble(ringRecipe(), {
    sourceStores: { ephemeral_provenance_ring: ringStore() },
  });
  const drifted = ringStore();
  drifted.entries.unshift(ringEvent({
    id: "ring-newer-drift",
    event_type: "model.chat.denied",
    timestamp: "2026-06-25T04:00:00.000Z",
  }));

  const replayed = assemble(ringRecipe(), {
    sourceStores: { ephemeral_provenance_ring: drifted },
    replay: { ephemeral_provenance_ring: { expected_snapshot_digest: first.replay_artifacts.ephemeral_provenance_ring.snapshot_digest } },
  });

  assert.equal(replayed.status, "refused");
  assert.equal(replayed.local_audit_manifest.reason_class, "replay_state_unpinned");
  assert.equal(replayed.bundle_body, "");
});

test("ephemeral ring filters self and unmapped events without raw pass-through", () => {
  const result = assemble(ringRecipe(), {
    sourceStores: { ephemeral_provenance_ring: ringStore() },
  });

  assert.equal(result.status, "assembled");
  assert.equal(result.bundle_body.includes("context.assembly.started"), false);
  assert.equal(result.bundle_body.includes("provenance.summary.read"), false);
  assert.equal(result.bundle_body.includes("ring-self"), false);
  assert.equal(result.bundle_body.includes("ring-unmapped"), false);
  assert.equal(JSON.stringify(result.local_audit_manifest.source_receipts).includes("ring-self"), false);
  assert.equal(JSON.stringify(result.local_audit_manifest.source_receipts).includes("ring-unmapped"), false);
});

test("ephemeral ring projection keeps raw identifiers local-audit-only", () => {
  const result = assemble(ringRecipe(), {
    sourceStores: { ephemeral_provenance_ring: ringStore() },
  });
  const body = result.bundle_body;
  const audit = JSON.stringify(result.local_audit_manifest.source_receipts);

  for (const forbidden of [
    "ring-model-complete",
    "frontier-private-caller",
    "episode-ring-private",
    "grant-ring-desktop",
    "soma.provider.desktop",
    "2026-06-25T03:20:00.000Z",
  ]) {
    assert.equal(body.includes(forbidden), false, `${forbidden} leaked into bundle_body`);
  }
  assert.equal(audit.includes("ring-model-complete"), true);
  assert.equal(audit.includes("grant-ring-desktop"), true);
});

test("cross-source ordering supports newest_first class_priority and receipt_priority", () => {
  const newest = assemble(baseRecipe({ ordering: "newest_first" }));
  assert.match(newest.bundle_body.split("\n")[0], /Durable provenance activity/);

  const classPriority = assemble(baseRecipe({
    ordering: "class_priority",
    source_class_order: ["occupant_memory", "durable_provenance_activity"],
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
  assert.equal(result.bundle_body.includes("Durable provenance activity"), true);
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

test("reserve-share fixes starvation when a source reserves an item", () => {
  const result = assemble(baseRecipe({
    ordering: "newest_first",
    source_selectors: [
      memorySelector({ budget: { max_items: 2, max_chars: 4_000, overflow_policy: "evict_oldest", reserve: { min_items: 1, min_chars: 0 } } }),
      activitySelector({ budget: { max_items: 3, max_chars: 4_000, overflow_policy: "evict_oldest" } }),
    ],
    context_budget: { max_items: 2, max_chars: 4_000, overflow_policy: "evict_oldest" },
  }));

  assert.equal(result.status, "assembled");
  assert.equal(result.local_audit_manifest.budget.budget_mode, "reserve_share");
  assert.equal(result.bundle_body.includes("Durable provenance activity"), true);
  assert.equal(result.bundle_body.includes("Memory class"), true);
  assert.equal(
    result.local_audit_manifest.selection_receipts.some((receipt) => (
      receipt.source_class === "occupant_memory"
        && receipt.decision === "included"
        && receipt.budget_phase === "reserve"
    )),
    true,
  );
});

test("reserve-share rejects nominal reserves that exceed the global budget", () => {
  const result = assemble(baseRecipe({
    source_selectors: [
      memorySelector({ budget: { max_items: 4, max_chars: 4_000, overflow_policy: "evict_oldest", reserve: { min_items: 2, min_chars: 0 } } }),
      activitySelector({ budget: { max_items: 4, max_chars: 4_000, overflow_policy: "evict_oldest", reserve: { min_items: 2, min_chars: 0 } } }),
    ],
    context_budget: { max_items: 3, max_chars: 4_000, overflow_policy: "evict_oldest" },
  }));

  assert.equal(result.status, "refused");
  assert.equal(result.local_audit_manifest.reason_class, "reserves_exceed_budget");
  assert.equal(result.frontier_facing_manifest.reason_class, "reserves_exceed_budget");
});

test("unused actual reserve returns to the share pool", () => {
  const result = assemble(baseRecipe({
    source_class_order: ["durable_provenance_activity", "occupant_memory"],
    source_selectors: [
      activitySelector({
        constraints: {
          ...activitySelector().constraints,
          event_types: ["memory.provenance.revoked"],
        },
        budget: { max_items: 4, max_chars: 4_000, overflow_policy: "evict_oldest", reserve: { min_items: 3, min_chars: 0 }, share: 0 },
      }),
      memorySelector({ budget: { max_items: 4, max_chars: 4_000, overflow_policy: "evict_oldest", share: 1 } }),
    ],
    context_budget: { max_items: 3, max_chars: 4_000, overflow_policy: "evict_oldest" },
  }));

  assert.equal(result.status, "assembled");
  assert.equal(result.local_audit_manifest.budget.included_count, 3);
  assert.equal(result.local_audit_manifest.budget.per_source.durable_provenance_activity.included_count, 1);
  assert.equal(result.local_audit_manifest.budget.per_source.occupant_memory.included_count, 2);
});

test("reserve-share rounding allocates leftovers by source_class_order", () => {
  const result = assemble(baseRecipe({
    source_class_order: ["durable_provenance_activity", "occupant_memory"],
    source_selectors: [
      activitySelector({ budget: { max_items: 4, max_chars: 4_000, overflow_policy: "evict_oldest", share: 1 } }),
      memorySelector({ budget: { max_items: 4, max_chars: 4_000, overflow_policy: "evict_oldest", share: 1 } }),
    ],
    context_budget: { max_items: 3, max_chars: 4_000, overflow_policy: "evict_oldest" },
  }));

  assert.equal(result.status, "assembled");
  assert.equal(result.local_audit_manifest.budget.per_source.durable_provenance_activity.included_count, 2);
  assert.equal(result.local_audit_manifest.budget.per_source.occupant_memory.included_count, 1);
});

test("omitted reserve-share fields preserve legacy global competition", () => {
  const first = assemble(baseRecipe());
  const second = assemble(baseRecipe({
    source_selectors: [
      memorySelector({ budget: { max_items: 4, max_chars: 2_000, overflow_policy: "evict_oldest" } }),
      activitySelector({ budget: { max_items: 4, max_chars: 2_000, overflow_policy: "evict_oldest" } }),
    ],
  }));

  assert.equal(first.local_audit_manifest.budget.budget_mode, "legacy_global");
  assert.equal(second.local_audit_manifest.budget.budget_mode, "legacy_global");
  assert.equal(Object.hasOwn(first.local_audit_manifest.budget.per_source.occupant_memory, "reserve"), true);
  assert.equal(Object.hasOwn(first.local_audit_manifest.budget.per_source.occupant_memory, "share"), true);
  assert.equal(first.bundle_body, second.bundle_body);
  assert.equal(first.local_audit_manifest.bundle_digest, expectedLegacyBundleDigest(first));
  assert.equal(first.local_audit_manifest.bundle_digest, second.local_audit_manifest.bundle_digest);
});

test("reserved items that exceed global chars abstain instead of oversubscribing", () => {
  const result = assemble(baseRecipe({
    source_selectors: [
      memorySelector({ budget: { max_items: 2, max_chars: 4_000, overflow_policy: "evict_oldest", reserve: { min_items: 1, min_chars: 0 } } }),
      activitySelector({ budget: { max_items: 2, max_chars: 4_000, overflow_policy: "evict_oldest" } }),
    ],
    context_budget: { max_items: 2, max_chars: 80, overflow_policy: "evict_oldest" },
  }));

  assert.equal(result.status, "refused");
  assert.equal(result.local_audit_manifest.reason_class, "budget_insufficient");
  assert.equal(result.frontier_facing_manifest.reason_class, "budget_insufficient");
});

test("budget phases are local-audit-only", () => {
  const result = assemble(baseRecipe({
    source_selectors: [
      memorySelector({ budget: { max_items: 2, max_chars: 4_000, overflow_policy: "evict_oldest", reserve: { min_items: 1, min_chars: 0 } } }),
      activitySelector({ budget: { max_items: 3, max_chars: 4_000, overflow_policy: "evict_oldest" } }),
    ],
    context_budget: { max_items: 2, max_chars: 4_000, overflow_policy: "evict_oldest" },
  }));

  assert.equal(result.local_audit_manifest.selection_receipts.some((receipt) => receipt.budget_phase), true);
  assert.equal(JSON.stringify(result.frontier_facing_manifest).includes("budget_phase"), false);
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
    sourceRecoveryReports: { durable_provenance_activity: { degraded: true } },
  });
  assert.equal(optional.status, "assembled");
  assert.equal(optional.bundle_body.includes("Newest note"), true);
  assert.equal(optional.bundle_body.includes("Durable provenance activity"), false);
  assert.deepEqual(optional.frontier_facing_manifest.source_omissions, [
    {
      source_class: "durable_provenance_activity",
      required: false,
      reason_class: "source_degraded",
      count_class: "many",
    },
  ]);

  const requiredProvenance = assemble(baseRecipe({
    source_selectors: [
      memorySelector(),
      activitySelector({ required: true }),
    ],
  }), {
    sourceRecoveryReports: { durable_provenance_activity: { degraded: true } },
  });
  assert.equal(requiredProvenance.status, "refused");
  assert.equal(requiredProvenance.local_audit_manifest.reason_class, "source_degraded");
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
  assert.equal(projectedJson.includes("prov-new"), false);
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

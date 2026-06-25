import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assembleContextFromLiveSources } from "../src/contextAssemblyLive.js";
import { ProvenanceLog } from "../src/provenanceLog.js";

const NOW = "2026-06-25T04:30:00.000Z";

function ids() {
  let next = 0;
  return () => {
    next += 1;
    return String(next).padStart(4, "0");
  };
}

function liveRecipe(overrides = {}) {
  return {
    schema_version: 1,
    recipe_id: "recipe-live-1",
    origin: "local",
    objective_class: "prepare_successor_context",
    source_selectors: [
      memorySelector(),
      durableSelector(),
      ringSelector(),
    ],
    capability_classes: ["memory_context", "activity_context"],
    required_receipt_types: ["source_receipt", "selection_receipt", "memory_snapshot", "activity_snapshot"],
    context_budget: { max_items: 10, max_chars: 6_000, overflow_policy: "evict_oldest" },
    ordering: "newest_first",
    source_class_order: ["ephemeral_provenance_ring", "durable_provenance_activity", "occupant_memory"],
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
    budget: { max_items: 4, max_chars: 2_000, overflow_policy: "evict_oldest" },
    ...overrides,
  };
}

function durableSelector(overrides = {}) {
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
    budget: { max_items: 4, max_chars: 2_000, overflow_policy: "evict_oldest" },
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
    budget: { max_items: 4, max_chars: 2_000, overflow_policy: "evict_oldest" },
    ...overrides,
  };
}

test("live context assembly reads real local files and freezes the ring", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "soma-context-live-"));
  try {
    const paths = await writeLiveFiles(workspace);
    const result = await assembleContextFromLiveSources({
      recipe: liveRecipe(),
      provenanceLog: liveRing(),
      occupantMemoryStorePath: paths.memoryPath,
      occupantMemoryProvenancePath: paths.provenancePath,
      now: () => new Date(NOW),
      idFactory: ids(),
    });

    assert.equal(result.status, "assembled");
    assert.equal(result.bundle_body.includes("Newest live note"), true);
    assert.equal(result.bundle_body.includes("Durable provenance activity"), true);
    assert.equal(result.bundle_body.includes("Ephemeral provenance ring activity"), true);
    assert.equal(result.replay_artifacts.ephemeral_provenance_ring.frozen_records.length > 0, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("live context replay round-trips with returned frozen artifact despite ring drift", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "soma-context-live-replay-"));
  try {
    const paths = await writeLiveFiles(workspace);
    const recipe = liveRecipe();
    const ring = liveRing();
    const first = await assembleContextFromLiveSources({
      recipe,
      provenanceLog: ring,
      occupantMemoryStorePath: paths.memoryPath,
      occupantMemoryProvenancePath: paths.provenancePath,
      now: () => new Date(NOW),
      idFactory: ids(),
    });
    ring.append(ringEvent({ id: "ring-drift", event_type: "model.chat.denied", timestamp: "2026-06-25T05:00:00.000Z" }));

    const replayed = await assembleContextFromLiveSources({
      recipe,
      provenanceLog: ring,
      occupantMemoryStorePath: paths.memoryPath,
      occupantMemoryProvenancePath: paths.provenancePath,
      replay: { ephemeral_provenance_ring: { expected_snapshot_digest: first.replay_artifacts.ephemeral_provenance_ring.snapshot_digest } },
      replayArtifacts: { ephemeral_provenance_ring: first.replay_artifacts.ephemeral_provenance_ring },
      now: () => new Date(NOW),
      idFactory: ids(),
    });

    assert.equal(replayed.status, "assembled");
    assert.equal(replayed.local_audit_manifest.bundle_digest, first.local_audit_manifest.bundle_digest);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("live corrupt durable provenance omits optional source and refuses when required", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "soma-context-live-corrupt-prov-"));
  try {
    const paths = await writeLiveFiles(workspace);
    const corruptProvenancePath = path.join(workspace, "corrupt-durable-provenance.ndjson");
    await writeFile(corruptProvenancePath, "{\"event_type\":\"occupant.memory.written\",\"entry_id\":\"broken\"\n", "utf8");

    const optional = await assembleContextFromLiveSources({
      recipe: liveRecipe(),
      provenanceLog: liveRing(),
      occupantMemoryStorePath: paths.memoryPath,
      occupantMemoryProvenancePath: paths.provenancePath,
      durableProvenancePath: corruptProvenancePath,
      now: () => new Date(NOW),
      idFactory: ids(),
    });
    assert.equal(optional.status, "assembled");
    assert.equal(optional.frontier_facing_manifest.source_omissions[0].source_class, "durable_provenance_activity");
    assert.equal(optional.frontier_facing_manifest.source_omissions[0].reason_class, "source_degraded");

    const required = await assembleContextFromLiveSources({
      recipe: liveRecipe({
        source_selectors: [memorySelector(), durableSelector({ required: true }), ringSelector()],
      }),
      provenanceLog: liveRing(),
      occupantMemoryStorePath: paths.memoryPath,
      occupantMemoryProvenancePath: paths.provenancePath,
      durableProvenancePath: corruptProvenancePath,
      now: () => new Date(NOW),
      idFactory: ids(),
    });
    assert.equal(required.status, "refused");
    assert.equal(required.local_audit_manifest.reason_class, "source_degraded");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("live unreadable memory authority degrades required memory without uncaught throw", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "soma-context-live-corrupt-memory-"));
  try {
    const paths = await writeLiveFiles(workspace);
    await writeFile(paths.memoryPath, "{not json", "utf8");

    const result = await assembleContextFromLiveSources({
      recipe: liveRecipe(),
      provenanceLog: liveRing(),
      occupantMemoryStorePath: paths.memoryPath,
      occupantMemoryProvenancePath: paths.provenancePath,
      now: () => new Date(NOW),
      idFactory: ids(),
    });

    assert.equal(result.status, "refused");
    assert.equal(result.local_audit_manifest.reason_class, "source_degraded");
    assert.equal(result.frontier_facing_manifest.source_omissions[0].source_class, "occupant_memory");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("live readable malformed memory store degrades instead of throwing", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "soma-context-live-malformed-memory-"));
  try {
    const paths = await writeLiveFiles(workspace);
    await writeFile(paths.memoryPath, `${JSON.stringify({
      schema_version: 1,
      entries: [
        {
          id: "bad-memory",
          memory_class: {},
          content: "Readable JSON but malformed memory shape.",
          domain: "testing",
          status: "active",
        },
      ],
      tombstones: [],
    })}\n`, "utf8");

    const result = await assembleContextFromLiveSources({
      recipe: liveRecipe(),
      provenanceLog: liveRing(),
      occupantMemoryStorePath: paths.memoryPath,
      occupantMemoryProvenancePath: paths.provenancePath,
      now: () => new Date(NOW),
      idFactory: ids(),
    });

    assert.equal(result.status, "refused");
    assert.equal(result.local_audit_manifest.reason_class, "source_degraded");
    assert.equal(result.frontier_facing_manifest.source_omissions[0].source_class, "occupant_memory");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("live ring real-shape extras are tolerated and filtered", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "soma-context-live-ring-"));
  try {
    const paths = await writeLiveFiles(workspace);
    const ring = liveRing();
    ring.append({
      id: "ring-extra",
      event_type: "model.chat.completed",
      timestamp: "2026-06-25T04:10:00.000Z",
      capability: "model.local.chat",
      caller_identity: "private-ring-caller",
      arbitrary_extra: { nested: "ignored" },
    });
    ring.append({ id: "ring-self", event_type: "context.assembly.started", timestamp: "2026-06-25T04:20:00.000Z" });

    const result = await assembleContextFromLiveSources({
      recipe: liveRecipe(),
      provenanceLog: ring,
      occupantMemoryStorePath: paths.memoryPath,
      occupantMemoryProvenancePath: paths.provenancePath,
      now: () => new Date(NOW),
      idFactory: ids(),
    });

    assert.equal(result.status, "assembled");
    assert.equal(result.bundle_body.includes("private-ring-caller"), false);
    assert.equal(result.bundle_body.includes("arbitrary_extra"), false);
    assert.equal(result.bundle_body.includes("context.assembly.started"), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("live edge substitutes safe-empty store for degraded unsnapshotable source", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "soma-context-live-unsnapshotable-"));
  try {
    const paths = await writeLiveFiles(workspace);
    const corruptProvenancePath = path.join(workspace, "corrupt-durable-provenance.ndjson");
    await writeFile(corruptProvenancePath, "{\"event_type\":\"occupant.memory.written\",\"entry_id\":\"broken\"\n", "utf8");
    const result = await assembleContextFromLiveSources({
      recipe: liveRecipe({
        source_selectors: [memorySelector(), durableSelector({ required: true }), ringSelector()],
      }),
      provenanceLog: liveRing(),
      occupantMemoryStorePath: paths.memoryPath,
      occupantMemoryProvenancePath: paths.provenancePath,
      durableProvenancePath: corruptProvenancePath,
      adapters: {
        occupant_memory: passthroughAdapter("occupant_memory"),
        ephemeral_provenance_ring: passthroughAdapter("ephemeral_provenance_ring"),
        durable_provenance_activity: {
          source_class: "durable_provenance_activity",
          freshness_class: "persistent",
          minimization_modes: new Set(["activity_summary", "metadata_only"]),
          validateSelector(selector) {
            return selector.constraints ?? {};
          },
          snapshot() {
            return {
              source_class: "durable_provenance_activity",
              snapshot_digest: "safe-empty-durable-digest",
              schema_version: 1,
              freshness_class: "persistent",
              trust_tier: "local_provenance",
              item_count: 0,
              newest_timestamp_ms: 0,
            };
          },
          select() {
            return [];
          },
        },
      },
      now: () => new Date(NOW),
      idFactory: ids(),
    });

    assert.equal(result.status, "refused");
    assert.equal(result.local_audit_manifest.reason_class, "source_degraded");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

async function writeLiveFiles(workspace) {
  const memoryPath = path.join(workspace, "occupant-memory.json");
  const provenancePath = path.join(workspace, "occupant-memory-mutations.ndjson");
  await writeFile(memoryPath, `${JSON.stringify(liveMemoryStore())}\n`, "utf8");
  await writeFile(provenancePath, `${JSON.stringify(liveProvenanceEvent())}\n`, "utf8");
  return { memoryPath, provenancePath };
}

function liveMemoryStore() {
  return {
    schema_version: 1,
    entries: [
      {
        id: "live-memory-new",
        memory_class: "self_note",
        content: "Newest live note for real context assembly.",
        model_id: "claude-live",
        episode_id: "episode-live",
        domain: "testing",
        created_at: "2026-06-25T03:00:00.000Z",
        created_by: "occupant",
        grant_id: "grant-live-memory",
        provider: "soma.provider.occupant-memory",
        scope: "session",
        status: "active",
      },
    ],
    tombstones: [],
  };
}

function liveProvenanceEvent(overrides = {}) {
  return {
    event_type: "occupant.memory.written",
    entry_id: "live-memory-new",
    memory_class: "self_note",
    actor: "occupant",
    reason_class: "",
    timestamp: "2026-06-25T03:05:00.000Z",
    model_id: "claude-live",
    episode_id: "episode-live",
    domain: "testing",
    grant_id: "grant-live-memory",
    provider: "soma.provider.occupant-memory",
    scope: "session",
    activation_performed: false,
    ...overrides,
  };
}

function liveRing() {
  const ring = new ProvenanceLog();
  ring.append(ringEvent({
    id: "ring-live-model",
    event_type: "model.chat.completed",
    timestamp: "2026-06-25T03:15:00.000Z",
  }));
  ring.append(ringEvent({
    id: "ring-live-desktop",
    event_type: "desktop.inspect.focus",
    timestamp: "2026-06-25T03:10:00.000Z",
    capability: "desktop.inspect.focus",
  }));
  return ring;
}

function ringEvent(overrides = {}) {
  return {
    id: "ring-live",
    event_type: "model.chat.requested",
    timestamp: "2026-06-25T03:00:00.000Z",
    capability: "model.local.chat",
    caller_identity: "ring-caller",
    grant_id: "ring-grant",
    provider: "ring-provider",
    scope: "session",
    episode_id: "ring-episode",
    allowed: true,
    ...overrides,
  };
}

function passthroughAdapter(sourceClass) {
  return {
    source_class: sourceClass,
    freshness_class: "persistent",
    minimization_modes: new Set(["activity_summary", "metadata_only", "excerpt_for_reasoner"]),
    validateSelector(selector) {
      return selector.constraints ?? {};
    },
    snapshot() {
      return {
        source_class: sourceClass,
        snapshot_digest: `${sourceClass}-digest`,
        schema_version: 1,
        freshness_class: "persistent",
        trust_tier: "local_provenance",
        item_count: 0,
        newest_timestamp_ms: 0,
      };
    },
    select() {
      return [];
    },
  };
}

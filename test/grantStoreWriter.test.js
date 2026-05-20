import assert from "node:assert/strict";
import test from "node:test";

import { createGrantCreatedProvenanceEvent } from "../src/grantMutationProvenance.js";
import { createGrant } from "../src/grants.js";
import { writeGrantStoreMutation } from "../src/grantStoreWriter.js";

const storePath = "/tmp/soma-grants.json";
const baseStore = {
  schema_version: 1,
  grants: [],
  examples: [],
};

const catalog = {
  schema_version: 1,
  capabilities: [
    {
      key: "desktop.inspect.focus",
      activation_policy: "explicit_grant",
      allowed_scopes: ["session"],
    },
  ],
};

const providerRegistry = {
  schema_version: 1,
  providers: [
    {
      id: "soma.provider.desktop-broker",
      capabilities: [{ key: "desktop.inspect.focus" }],
    },
  ],
};

const grantInput = {
  id: "grant-created",
  capability: "desktop.inspect.focus",
  provider: "soma.provider.desktop-broker",
  scope: "session",
  constraints: { include_text: false },
  approved_by: "user",
  direct_user_action: true,
  reason: "Inspect the focused desktop object for this session.",
  created_at: "2026-05-20T12:00:00.000Z",
};

test("grant-store writer commits grant JSON before appending provenance", async () => {
  const io = new MemoryGrantStoreIo({ [storePath]: baseStore });
  const provenance = new MemoryProvenanceLog({ calls: io.calls });
  const lock = new MemoryLock({ calls: io.calls });

  const result = await writeGrantStoreMutation({
    grantStorePath: storePath,
    mutationKind: "grant.created",
    mutationId: "mutation-1",
    io,
    provenance,
    lock,
    mutate: createGrantMutation,
  });

  assert.equal(result.ok, true);
  assert.equal(result.receipt.status, "committed");
  assert.equal(result.receipt.grant_store_committed, true);
  assert.equal(result.receipt.provenance_appended, true);
  assert.equal(result.receipt.recovery_required, false);
  assert.deepEqual(io.calls, [
    "lock.acquire",
    "readFile",
    "tempPath",
    "writeFile",
    "fsyncFile",
    "rename",
    "fsyncDir",
    "provenance.append",
    "lock.release",
  ]);
  assert.equal(JSON.parse(io.files.get(storePath)).grants[0].id, "grant-created");
  assert.equal(provenance.events[0].event_type, "grant.created");
  assert.equal(provenance.events[0].activation_performed, false);
});

test("grant-store writer leaves authority unchanged when temp write fails", async () => {
  const io = new MemoryGrantStoreIo({ [storePath]: baseStore }, { failStage: "writeFile" });
  const provenance = new MemoryProvenanceLog({ calls: io.calls });

  const result = await writeGrantStoreMutation({
    grantStorePath: storePath,
    mutationKind: "grant.created",
    mutationId: "mutation-temp-fail",
    io,
    provenance,
    mutate: createGrantMutation,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "grant_store_temp_write_failed");
  assert.equal(result.receipt.grant_store_committed, false);
  assert.equal(result.receipt.provenance_appended, false);
  assert.equal(result.receipt.recovery_required, false);
  assert.equal(JSON.parse(io.files.get(storePath)).grants.length, 0);
  assert.equal(provenance.events.length, 0);
  assert.equal(io.calls.includes("provenance.append"), false);
});

test("grant-store writer leaves prior file authoritative when rename fails", async () => {
  const io = new MemoryGrantStoreIo({ [storePath]: baseStore }, { failStage: "rename" });
  const provenance = new MemoryProvenanceLog({ calls: io.calls });

  const result = await writeGrantStoreMutation({
    grantStorePath: storePath,
    mutationKind: "grant.created",
    mutationId: "mutation-rename-fail",
    io,
    provenance,
    mutate: createGrantMutation,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "grant_store_rename_failed");
  assert.equal(result.receipt.grant_store_committed, false);
  assert.equal(result.receipt.provenance_appended, false);
  assert.equal(JSON.parse(io.files.get(storePath)).grants.length, 0);
  assert.equal(provenance.events.length, 0);
  assert.equal(io.calls.includes("unlink"), true);
});

test("grant-store writer reports degraded recovery when provenance append fails after commit", async () => {
  const io = new MemoryGrantStoreIo({ [storePath]: baseStore });
  const provenance = new MemoryProvenanceLog({ calls: io.calls, failAppend: true });

  const result = await writeGrantStoreMutation({
    grantStorePath: storePath,
    mutationKind: "grant.created",
    mutationId: "mutation-provenance-fail",
    io,
    provenance,
    mutate: createGrantMutation,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "grant_store_provenance_append_failed");
  assert.equal(result.degraded, true);
  assert.equal(result.receipt.status, "degraded");
  assert.equal(result.receipt.grant_store_committed, true);
  assert.equal(result.receipt.provenance_appended, false);
  assert.equal(result.receipt.recovery_required, true);
  assert.equal(JSON.parse(io.files.get(storePath)).grants[0].id, "grant-created");
  assert.equal(provenance.events.length, 0);
});

test("grant-store writer fails closed on stale schema before mutation", async () => {
  const io = new MemoryGrantStoreIo({
    [storePath]: { ...baseStore, schema_version: 2 },
  });
  const provenance = new MemoryProvenanceLog({ calls: io.calls });
  let mutated = false;

  const result = await writeGrantStoreMutation({
    grantStorePath: storePath,
    expectedSchemaVersion: 1,
    mutationKind: "grant.created",
    mutationId: "mutation-schema-fail",
    io,
    provenance,
    mutate: () => {
      mutated = true;
      return createGrantMutation(baseStore);
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "grant_store_schema_mismatch");
  assert.equal(result.receipt.observed_schema_version, 2);
  assert.equal(mutated, false);
  assert.equal(io.calls.includes("writeFile"), false);
  assert.equal(provenance.events.length, 0);
});

test("grant-store writer reports retryable lock failure before reading", async () => {
  const io = new MemoryGrantStoreIo({ [storePath]: baseStore });
  const provenance = new MemoryProvenanceLog({ calls: io.calls });

  const result = await writeGrantStoreMutation({
    grantStorePath: storePath,
    mutationKind: "grant.created",
    mutationId: "mutation-lock-fail",
    io,
    provenance,
    lock: new MemoryLock({ calls: io.calls, failAcquire: true }),
    mutate: createGrantMutation,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "grant_store_lock_failed");
  assert.equal(result.retryable, true);
  assert.equal(result.receipt.grant_store_committed, false);
  assert.deepEqual(io.calls, ["lock.acquire"]);
  assert.equal(provenance.events.length, 0);
});

test("grant-store writer fails closed on corrupted grant JSON", async () => {
  const io = new MemoryGrantStoreIo({ [storePath]: "{not json" });
  const provenance = new MemoryProvenanceLog({ calls: io.calls });

  const result = await writeGrantStoreMutation({
    grantStorePath: storePath,
    mutationKind: "grant.created",
    mutationId: "mutation-parse-fail",
    io,
    provenance,
    mutate: createGrantMutation,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "grant_store_parse_failed");
  assert.equal(result.receipt.grant_store_committed, false);
  assert.equal(io.calls.includes("writeFile"), false);
  assert.equal(provenance.events.length, 0);
});

function createGrantMutation(store) {
  const nextStore = createGrant(store, grantInput, {
    catalog,
    providerRegistry,
  });
  const grant = nextStore.grants.find((candidate) => candidate.id === "grant-created");
  return {
    nextStore,
    grant,
    event: createGrantCreatedProvenanceEvent({ grant }),
  };
}

class MemoryGrantStoreIo {
  constructor(files = {}, { failStage = "" } = {}) {
    this.files = new Map();
    for (const [filePath, value] of Object.entries(files)) {
      this.files.set(filePath, typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
    }
    this.failStage = failStage;
    this.calls = [];
  }

  async readFile(filePath) {
    this.calls.push("readFile");
    this.failIf("readFile");
    return this.files.get(filePath);
  }

  tempPath({ grant_store_path: grantStorePath, mutation_id: mutationId }) {
    this.calls.push("tempPath");
    return `${grantStorePath}.${mutationId}.tmp`;
  }

  async writeFile(filePath, contents) {
    this.calls.push("writeFile");
    this.failIf("writeFile");
    this.files.set(filePath, contents);
  }

  async fsyncFile() {
    this.calls.push("fsyncFile");
  }

  async rename(source, target) {
    this.calls.push("rename");
    this.failIf("rename");
    this.files.set(target, this.files.get(source));
    this.files.delete(source);
  }

  async fsyncDir() {
    this.calls.push("fsyncDir");
  }

  async unlink(filePath) {
    this.calls.push("unlink");
    this.files.delete(filePath);
  }

  failIf(stage) {
    if (this.failStage === stage) {
      const error = new Error(`${stage} failed`);
      error.stage = stage;
      throw error;
    }
  }
}

class MemoryProvenanceLog {
  constructor({ calls = [], failAppend = false } = {}) {
    this.calls = calls;
    this.failAppend = failAppend;
    this.events = [];
  }

  async append(event) {
    this.calls.push("provenance.append");
    if (this.failAppend) {
      const error = new Error("provenance append failed");
      error.stage = "append";
      throw error;
    }
    this.events.push(event);
  }
}

class MemoryLock {
  constructor({ calls = [], failAcquire = false } = {}) {
    this.calls = calls;
    this.failAcquire = failAcquire;
  }

  async acquire() {
    this.calls.push("lock.acquire");
    if (this.failAcquire) {
      const error = new Error("lock unavailable");
      error.stage = "lock";
      throw error;
    }
    return async () => {
      this.calls.push("lock.release");
    };
  }
}

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createGrantCreatedProvenanceEvent } from "../src/grantMutationProvenance.js";
import { createGrant } from "../src/grants.js";
import {
  createGrantStoreFileIo,
  createGrantStoreLock,
} from "../src/grantStoreFileAdapters.js";
import { writeGrantStoreMutation } from "../src/grantStoreWriter.js";

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

test("grant-store file adapter writes through temp file rename and appends provenance", async () => {
  const workspace = await makeWorkspace();
  try {
    const grantStorePath = path.join(workspace, "grants.json");
    await writeJson(grantStorePath, { schema_version: 1, grants: [], examples: [] });
    const provenance = new MemoryProvenanceLog();

    const result = await writeGrantStoreMutation({
      grantStorePath,
      mutationId: "mutation-file-success",
      mutationKind: "grant.created",
      io: createGrantStoreFileIo(),
      lock: createGrantStoreLock(),
      provenance,
      mutate: createGrantMutation,
    });

    const persisted = JSON.parse(await readFile(grantStorePath, "utf8"));
    assert.equal(result.ok, true);
    assert.equal(result.receipt.grant_store_committed, true);
    assert.equal(result.receipt.provenance_appended, true);
    assert.equal(persisted.grants[0].id, "grant-created");
    assert.equal(provenance.events[0].event_type, "grant.created");
    await assertMissing(`${grantStorePath}.lock`);
    await assertMissing(path.join(workspace, ".grants.json.mutation-file-success.tmp"));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("grant-store file adapter fails safely and cleans stale temp path", async () => {
  const workspace = await makeWorkspace();
  try {
    const grantStorePath = path.join(workspace, "grants.json");
    const tempPath = path.join(workspace, ".grants.json.mutation-stale-temp.tmp");
    await writeJson(grantStorePath, { schema_version: 1, grants: [], examples: [] });
    await writeFile(tempPath, "stale temp", "utf8");
    const provenance = new MemoryProvenanceLog();

    const result = await writeGrantStoreMutation({
      grantStorePath,
      mutationId: "mutation-stale-temp",
      mutationKind: "grant.created",
      io: createGrantStoreFileIo(),
      lock: createGrantStoreLock(),
      provenance,
      mutate: createGrantMutation,
    });

    const persisted = JSON.parse(await readFile(grantStorePath, "utf8"));
    assert.equal(result.ok, false);
    assert.equal(result.code, "grant_store_temp_write_failed");
    assert.equal(result.receipt.grant_store_committed, false);
    assert.equal(result.receipt.provenance_appended, false);
    assert.equal(persisted.grants.length, 0);
    assert.equal(provenance.events.length, 0);
    await assertMissing(tempPath);
    await assertMissing(`${grantStorePath}.lock`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("grant-store lock rejects a second writer before reading", async () => {
  const workspace = await makeWorkspace();
  let releaseLock = null;
  try {
    const grantStorePath = path.join(workspace, "grants.json");
    await writeJson(grantStorePath, { schema_version: 1, grants: [], examples: [] });
    releaseLock = await createGrantStoreLock().acquire({ grant_store_path: grantStorePath });
    const provenance = new MemoryProvenanceLog();

    const result = await writeGrantStoreMutation({
      grantStorePath,
      mutationId: "mutation-lock-contention",
      mutationKind: "grant.created",
      io: createGrantStoreFileIo(),
      lock: createGrantStoreLock(),
      provenance,
      mutate: createGrantMutation,
    });

    const persisted = JSON.parse(await readFile(grantStorePath, "utf8"));
    assert.equal(result.ok, false);
    assert.equal(result.code, "grant_store_lock_failed");
    assert.equal(result.retryable, true);
    assert.equal(result.receipt.grant_store_committed, false);
    assert.equal(persisted.grants.length, 0);
    assert.equal(provenance.events.length, 0);
  } finally {
    if (releaseLock) {
      await releaseLock();
    }
    await rm(workspace, { recursive: true, force: true });
  }
});

async function makeWorkspace() {
  return mkdtemp(path.join(os.tmpdir(), "soma-grants-"));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function assertMissing(filePath) {
  await assert.rejects(
    () => readFile(filePath, "utf8"),
    (error) => error.code === "ENOENT",
  );
}

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

class MemoryProvenanceLog {
  constructor() {
    this.events = [];
  }

  async append(event) {
    this.events.push(event);
  }
}

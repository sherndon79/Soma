import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createGrantMutationProvenanceFile } from "../src/grantMutationProvenanceFile.js";
import { inspectGrantMutationRecovery } from "../src/grantMutationRecovery.js";
import {
  writeGrantCreateMutation,
  writeGrantRevokeMutation,
} from "../src/grantMutationStoreWriters.js";
import {
  createGrantStoreFileIo,
  createGrantStoreLock,
} from "../src/grantStoreFileAdapters.js";

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

test("durable grant create composes store write provenance append and recovery inspection", async () => {
  const workspace = await makeWorkspace();
  try {
    const { grantStorePath, provenancePath } = await initializeStores(workspace);
    const result = await writeGrantCreateMutation({
      grantStorePath,
      mutationId: "mutation-create",
      io: createGrantStoreFileIo(),
      lock: createGrantStoreLock(),
      provenance: createGrantMutationProvenanceFile({ path: provenancePath }),
      input: {
        id: "grant-created",
        capability: "desktop.inspect.focus",
        provider: "soma.provider.desktop-broker",
        scope: "session",
        constraints: { include_text: false },
        approved_by: "user",
        direct_user_action: true,
        reason: "Inspect the focused desktop object for this session.",
        created_at: "2026-05-20T12:00:00.000Z",
      },
      context: { catalog, providerRegistry },
    });

    const store = await readJson(grantStorePath);
    const provenanceEvents = await createGrantMutationProvenanceFile({ path: provenancePath }).read();
    const recovery = inspectGrantMutationRecovery({ store, provenanceEvents });

    assert.equal(result.ok, true);
    assert.equal(result.receipt.status, "committed");
    assert.equal(store.grants[0].id, "grant-created");
    assert.equal(provenanceEvents.length, 1);
    assert.equal(provenanceEvents[0].event_type, "grant.created");
    assert.equal(recovery.ok, true);
    assert.equal(recovery.degraded, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("durable grant revoke composes terminal provenance and clean recovery inspection", async () => {
  const workspace = await makeWorkspace();
  try {
    const { grantStorePath, provenancePath } = await initializeStores(workspace);
    const provenance = createGrantMutationProvenanceFile({ path: provenancePath });
    const io = createGrantStoreFileIo();
    const lock = createGrantStoreLock();

    const createResult = await writeGrantCreateMutation({
      grantStorePath,
      mutationId: "mutation-create-before-revoke",
      io,
      lock,
      provenance,
      input: {
        id: "grant-created",
        capability: "desktop.inspect.focus",
        provider: "soma.provider.desktop-broker",
        scope: "session",
        constraints: { include_text: false },
        approved_by: "user",
        direct_user_action: true,
        reason: "Inspect the focused desktop object for this session.",
        created_at: "2026-05-20T12:00:00.000Z",
      },
      context: { catalog, providerRegistry },
    });
    const revokeResult = await writeGrantRevokeMutation({
      grantStorePath,
      mutationId: "mutation-revoke",
      io,
      lock,
      provenance,
      input: {
        id: "grant-created",
        actor: "user",
        reason: "Focused inspection no longer needed.",
        revoked_at: "2026-05-20T12:30:00.000Z",
      },
      context: { catalog, providerRegistry },
    });

    const store = await readJson(grantStorePath);
    const provenanceEvents = await provenance.read();
    const recovery = inspectGrantMutationRecovery({ store, provenanceEvents });

    assert.equal(createResult.ok, true);
    assert.equal(revokeResult.ok, true);
    assert.equal(store.grants[0].status, "revoked");
    assert.equal(store.grants[0].revocation_reason, "Focused inspection no longer needed.");
    assert.deepEqual(provenanceEvents.map((event) => event.event_type), [
      "grant.created",
      "grant.revoked",
    ]);
    assert.equal(recovery.ok, true);
    assert.equal(recovery.degraded, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("durable composition recovery detects grant committed with missing provenance", async () => {
  const workspace = await makeWorkspace();
  try {
    const { grantStorePath, provenancePath } = await initializeStores(workspace);
    const result = await writeGrantCreateMutation({
      grantStorePath,
      mutationId: "mutation-create-missing-provenance",
      io: createGrantStoreFileIo(),
      lock: createGrantStoreLock(),
      provenance: {
        async append() {
          const error = new Error("simulated durable provenance outage");
          error.stage = "append";
          throw error;
        },
      },
      input: {
        id: "grant-created",
        capability: "desktop.inspect.focus",
        provider: "soma.provider.desktop-broker",
        scope: "session",
        constraints: { include_text: false },
        approved_by: "user",
        direct_user_action: true,
        reason: "Inspect the focused desktop object for this session.",
        created_at: "2026-05-20T12:00:00.000Z",
      },
      context: { catalog, providerRegistry },
    });

    const store = await readJson(grantStorePath);
    const provenanceEvents = await createGrantMutationProvenanceFile({ path: provenancePath }).read();
    const recovery = inspectGrantMutationRecovery({ store, provenanceEvents });

    assert.equal(result.ok, false);
    assert.equal(result.code, "grant_store_provenance_append_failed");
    assert.equal(result.receipt.grant_store_committed, true);
    assert.equal(result.receipt.provenance_appended, false);
    assert.equal(result.receipt.recovery_required, true);
    assert.equal(store.grants[0].id, "grant-created");
    assert.deepEqual(provenanceEvents, []);
    assert.equal(recovery.ok, false);
    assert.equal(recovery.degraded, true);
    assert.deepEqual(recovery.findings.map((finding) => finding.code), [
      "missing_grant_created_provenance",
    ]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

async function makeWorkspace() {
  return mkdtemp(path.join(os.tmpdir(), "soma-grant-composition-"));
}

async function initializeStores(workspace) {
  const grantStorePath = path.join(workspace, "grants.json");
  const provenancePath = path.join(workspace, "grant-mutations.ndjson");
  await writeFile(
    grantStorePath,
    `${JSON.stringify({ schema_version: 1, grants: [], examples: [] }, null, 2)}\n`,
    "utf8",
  );
  return { grantStorePath, provenancePath };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

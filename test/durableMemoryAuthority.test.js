import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { loadDurableMemoryAuthority } from "../src/durableMemoryAuthority.js";

const entry = {
  id: "memory-authority-test",
  role: "note",
  content: "Remember that default URL paths must survive restart.",
  source: "manual",
  created_at: "2026-06-04T00:00:00.000Z",
  created_by: "user",
  grant_id: "grant-memory",
  provider: "soma.provider.session-memory",
  scope: "session",
};

const event = {
  event_type: "memory.durable.written",
  memory_id: entry.id,
  role: entry.role,
  source: entry.source,
  actor: entry.created_by,
  reason: "Persist durable memory.",
  timestamp: entry.created_at,
  grant_id: entry.grant_id,
  provider: entry.provider,
  scope: entry.scope,
  activation_performed: false,
};

test("loadDurableMemoryAuthority keeps durable memory recovery clean with file URL paths", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "soma-durable-memory-authority-"));
  const storePath = path.join(workspace, "durable-memory.json");
  const provenancePath = path.join(workspace, "durable-memory-mutations.ndjson");
  await writeFile(storePath, JSON.stringify({
    schema_version: 1,
    entries: [entry],
  }), "utf8");
  await writeFile(provenancePath, `${JSON.stringify(event)}\n`, "utf8");

  const authority = await loadDurableMemoryAuthority({
    durableMemoryStorePath: pathToFileURL(storePath),
    durableMemoryProvenancePath: pathToFileURL(provenancePath),
  });

  assert.equal(authority.durableMemoryStore.entries.length, 1);
  assert.equal(authority.durableMemoryRecoveryReport.ok, true);
  assert.equal(authority.durableMemoryRecoveryReport.degraded, false);
  assert.deepEqual(authority.durableMemoryRecoveryReport.findings, []);
  assert.equal(authority.durableMemoryStorePath, storePath);
  assert.equal(authority.durableMemoryProvenancePath, provenancePath);
});

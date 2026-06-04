import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { createDurableMemoryProvenanceFile } from "../src/durableMemoryProvenanceFile.js";

test("durable memory provenance file accepts file URL paths", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "soma-memory-provenance-"));
  try {
    const provenancePath = path.join(workspace, "durable-memory-mutations.ndjson");
    const adapter = createDurableMemoryProvenanceFile({ path: pathToFileURL(provenancePath) });
    const event = {
      event_type: "memory.durable.written",
      memory_id: "memory-1",
      role: "note",
      source: "manual",
      actor: "user",
      reason: "Remember this across restarts.",
      timestamp: "2026-06-04T00:00:00.000Z",
      grant_id: "grant-memory",
      provider: "soma.provider.session-memory",
      scope: "session",
      activation_performed: false,
    };

    await adapter.append(event);

    assert.deepEqual(await adapter.read(), [event]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

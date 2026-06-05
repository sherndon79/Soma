import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadDurableTestimonyAuthority } from "../src/durableTestimonyAuthority.js";

test("loadDurableTestimonyAuthority keeps recovery clean with file URL paths", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "soma-durable-testimony-authority-"));
  try {
    const storePath = path.join(workspace, "durable-testimony.json");
    const provenancePath = path.join(workspace, "durable-testimony.ndjson");
    await writeFile(storePath, `${JSON.stringify({
      schema_version: 1,
      entries: [
        {
          id: "testimony-1",
          text: "Exact words.",
          domain: "testing",
          steward_durable: true,
          successor_visibility_requested: false,
          presentation: "exact",
          created_at: "2026-06-05T00:00:00.000Z",
          created_by: "occupant",
          disclosure_version: "durable-testimony-disclosure-v1",
        },
      ],
    }, null, 2)}\n`);
    await writeFile(provenancePath, "", "utf8");

    const authority = await loadDurableTestimonyAuthority({
      durableTestimonyStorePath: pathToFileURL(storePath),
      durableTestimonyProvenancePath: pathToFileURL(provenancePath),
    });

    assert.equal(authority.durableTestimonyStore.entries.length, 1);
    assert.equal(authority.durableTestimonyRecoveryReport.ok, true);
    assert.equal(authority.durableTestimonyRecoveryReport.degraded, false);
    assert.equal(authority.durableTestimonyStorePath, storePath);
    assert.equal(authority.durableTestimonyProvenancePath, provenancePath);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

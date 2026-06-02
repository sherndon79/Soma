import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadGrantAuthority } from "../src/grantAuthority.js";
import { createGrantCreatedProvenanceEvent } from "../src/grantMutationProvenance.js";

const grant = {
  id: "grant-authority-test",
  status: "active",
  capability: "desktop.inspect.focus",
  provider: "soma.provider.desktop.local",
  scope: "session",
  constraints: {},
  approved_by: "user",
  approval_provenance_id: "approval-1",
  reason: "Need focus metadata for the current task.",
  created_at: "2026-05-21T12:00:00.000Z",
  activation_performed: false,
};

test("loadGrantAuthority pairs grant store with clean mutation recovery inspection", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "soma-grant-authority-"));
  const grantStorePath = path.join(workspace, "grants.json");
  const provenancePath = path.join(workspace, "grant-mutations.ndjson");
  await writeFile(grantStorePath, JSON.stringify({
    schema_version: 1,
    grants: [grant],
  }), "utf8");
  await writeFile(
    provenancePath,
    `${JSON.stringify(createGrantCreatedProvenanceEvent({ grant }))}\n`,
    "utf8",
  );

  const authority = await loadGrantAuthority({
    grantStorePath,
    grantMutationProvenancePath: provenancePath,
  });

  assert.equal(authority.grantStore.grants.length, 1);
  assert.equal(authority.grantRecoveryReport.ok, true);
  assert.equal(authority.grantRecoveryReport.degraded, false);
  assert.deepEqual(authority.grantRecoveryReport.findings, []);
});

test("loadGrantAuthority reports missing provenance as degraded recovery", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "soma-grant-authority-"));
  const grantStorePath = path.join(workspace, "grants.json");
  const provenancePath = path.join(workspace, "missing-grant-mutations.ndjson");
  await writeFile(grantStorePath, JSON.stringify({
    schema_version: 1,
    grants: [grant],
  }), "utf8");

  const authority = await loadGrantAuthority({
    grantStorePath,
    grantMutationProvenancePath: provenancePath,
  });

  assert.equal(authority.grantRecoveryReport.ok, false);
  assert.equal(authority.grantRecoveryReport.degraded, true);
  assert.equal(authority.grantRecoveryReport.findings[0].code, "missing_grant_created_provenance");
  assert.equal(authority.grantRecoveryReport.findings[0].grant_id, "grant-authority-test");
  assert.equal(authority.grantRecoveryReport.findings[0].authorizing_safe, false);
});

test("loadGrantAuthority converts unreadable provenance into non-authorizing findings", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "soma-grant-authority-"));
  const grantStorePath = path.join(workspace, "grants.json");
  const provenancePath = path.join(workspace, "grant-mutations.ndjson");
  await writeFile(grantStorePath, JSON.stringify({
    schema_version: 1,
    grants: [grant],
  }), "utf8");
  await writeFile(provenancePath, "{not json}\n", "utf8");

  const authority = await loadGrantAuthority({
    grantStorePath,
    grantMutationProvenancePath: provenancePath,
  });

  assert.equal(authority.grantRecoveryReport.ok, false);
  assert.equal(authority.grantRecoveryReport.degraded, true);
  assert.equal(authority.grantRecoveryReport.findings[0].code, "grant_mutation_provenance_unreadable");
  assert.equal(authority.grantRecoveryReport.findings[0].grant_id, "grant-authority-test");
  assert.equal(authority.grantRecoveryReport.findings[0].provenance_stage, "read");
  assert.equal(authority.grantRecoveryReport.findings[0].authorizing_safe, false);
});

test("loadGrantAuthority degrades loudly to an empty store when grant store is corrupt", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "soma-grant-authority-"));
  const grantStorePath = path.join(workspace, "grants.json");
  const provenancePath = path.join(workspace, "grant-mutations.ndjson");
  const corruptGrantStore = "{not json";
  await writeFile(grantStorePath, corruptGrantStore, "utf8");
  await writeFile(provenancePath, "", "utf8");

  const authority = await loadGrantAuthority({
    grantStorePath,
    grantMutationProvenancePath: provenancePath,
  });

  assert.equal(authority.grantStore.grants.length, 0);
  assert.equal(authority.grantRecoveryReport.ok, false);
  assert.equal(authority.grantRecoveryReport.degraded, true);
  assert.equal(authority.grantRecoveryReport.grant_store_status, "corrupt");
  assert.equal(authority.grantRecoveryReport.grant_store_degraded_reason, "grant_store_unreadable");
  assert.equal(authority.grantRecoveryReport.findings[0].code, "grant_store_unreadable");
  assert.equal(authority.grantRecoveryReport.findings[0].grant_id, "");
  assert.equal(authority.grantRecoveryReport.findings[0].authorizing_safe, false);
  assert.equal(await readFile(grantStorePath, "utf8"), corruptGrantStore);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  writeGrantCreateMutation,
  writeGrantExpireMutation,
  writeGrantRevokeMutation,
  writeGrantSupersedeMutation,
} from "../src/grantMutationStoreWriters.js";

const storePath = "/tmp/soma-grants.json";
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

const context = {
  catalog,
  providerRegistry,
  now: () => "2026-05-20T12:00:00.000Z",
  createId: () => "grant-created",
};

const grantCreateInput = {
  capability: "desktop.inspect.focus",
  provider: "soma.provider.desktop-broker",
  scope: "session",
  constraints: { include_text: false },
  approved_by: "user",
  direct_user_action: true,
  reason: "Inspect the focused desktop object for this session.",
};

const baseStore = {
  schema_version: 1,
  grants: [
    {
      id: "grant-active",
      status: "active",
      capability: "desktop.inspect.focus",
      provider: "soma.provider.desktop-broker",
      scope: "session",
      constraints: { include_text: false },
      approved_by: "user",
      approval_provenance_id: "approval-active",
      reason: "Existing focused inspection grant.",
      created_at: "2026-05-20T11:00:00.000Z",
      review_required: false,
      revoked_at: null,
      revoked_by: "",
      revocation_reason: "",
      replacement_grant_id: "",
      activation_performed: false,
    },
    {
      id: "grant-replacement",
      status: "active",
      capability: "desktop.inspect.focus",
      provider: "soma.provider.desktop-broker",
      scope: "session",
      constraints: { include_text: false, max_depth: 0 },
      approved_by: "user",
      approval_provenance_id: "approval-replacement",
      reason: "Narrower focused inspection grant.",
      created_at: "2026-05-20T11:30:00.000Z",
      review_required: false,
      revoked_at: null,
      revoked_by: "",
      revocation_reason: "",
      replacement_grant_id: "",
      activation_performed: false,
    },
  ],
  examples: [],
};

test("grant create writer composes create helper provenance and durable writer", async () => {
  const io = new MemoryGrantStoreIo({ [storePath]: { schema_version: 1, grants: [], examples: [] } });
  const provenance = new MemoryProvenanceLog({ calls: io.calls });

  const result = await writeGrantCreateMutation({
    grantStorePath: storePath,
    mutationId: "mutation-create",
    io,
    provenance,
    input: grantCreateInput,
    context,
  });

  const persisted = JSON.parse(io.files.get(storePath));
  assert.equal(result.ok, true);
  assert.equal(result.receipt.mutation_kind, "grant.created");
  assert.equal(result.grant.id, "grant-created");
  assert.equal(result.event.event_type, "grant.created");
  assert.equal(result.event.grant_id, "grant-created");
  assert.equal(result.event.activation_performed, false);
  assert.equal(persisted.grants[0].id, "grant-created");
  assert.equal(persisted.mutation, undefined);
  assert.equal(provenance.events[0], result.event);
});

test("grant revoke writer records revoked grant metadata without activation", async () => {
  const io = new MemoryGrantStoreIo({ [storePath]: baseStore });
  const provenance = new MemoryProvenanceLog({ calls: io.calls });

  const result = await writeGrantRevokeMutation({
    grantStorePath: storePath,
    mutationId: "mutation-revoke",
    io,
    provenance,
    input: {
      id: "grant-active",
      actor: "user",
      reason: "Focused inspection no longer needed.",
    },
    context,
  });

  const grant = JSON.parse(io.files.get(storePath)).grants.find((candidate) => (
    candidate.id === "grant-active"
  ));
  assert.equal(result.ok, true);
  assert.equal(result.receipt.mutation_kind, "grant.revoked");
  assert.equal(result.event.event_type, "grant.revoked");
  assert.equal(result.event.actor, "user");
  assert.equal(result.event.activation_performed, false);
  assert.equal(grant.status, "revoked");
  assert.equal(grant.revocation_reason, "Focused inspection no longer needed.");
});

test("grant supersede writer links replacement grant in store and provenance", async () => {
  const io = new MemoryGrantStoreIo({ [storePath]: baseStore });
  const provenance = new MemoryProvenanceLog({ calls: io.calls });

  const result = await writeGrantSupersedeMutation({
    grantStorePath: storePath,
    mutationId: "mutation-supersede",
    io,
    provenance,
    input: {
      id: "grant-active",
      replacement_grant_id: "grant-replacement",
      actor: "user",
      reason: "Replace with the narrower grant.",
    },
    context,
  });

  const grant = JSON.parse(io.files.get(storePath)).grants.find((candidate) => (
    candidate.id === "grant-active"
  ));
  assert.equal(result.ok, true);
  assert.equal(result.receipt.mutation_kind, "grant.superseded");
  assert.equal(result.event.event_type, "grant.superseded");
  assert.equal(result.event.replacement_grant_id, "grant-replacement");
  assert.equal(grant.status, "superseded");
  assert.equal(grant.replacement_grant_id, "grant-replacement");
});

test("grant expire writer records system expiration metadata", async () => {
  const io = new MemoryGrantStoreIo({ [storePath]: baseStore });
  const provenance = new MemoryProvenanceLog({ calls: io.calls });

  const result = await writeGrantExpireMutation({
    grantStorePath: storePath,
    mutationId: "mutation-expire",
    io,
    provenance,
    input: {
      id: "grant-active",
      reason: "Session boundary expired.",
    },
    context,
  });

  const grant = JSON.parse(io.files.get(storePath)).grants.find((candidate) => (
    candidate.id === "grant-active"
  ));
  assert.equal(result.ok, true);
  assert.equal(result.receipt.mutation_kind, "grant.expired");
  assert.equal(result.event.event_type, "grant.expired");
  assert.equal(result.event.actor, "system");
  assert.equal(result.event.reason, "Session boundary expired.");
  assert.equal(grant.status, "expired");
  assert.equal(grant.revoked_by, "system");
});

test("grant mutation writer wrappers surface validation failures before durable writes", async () => {
  const io = new MemoryGrantStoreIo({ [storePath]: baseStore });
  const provenance = new MemoryProvenanceLog({ calls: io.calls });

  const result = await writeGrantSupersedeMutation({
    grantStorePath: storePath,
    mutationId: "mutation-invalid-supersede",
    io,
    provenance,
    input: {
      id: "grant-active",
      replacement_grant_id: "missing-grant",
      actor: "user",
      reason: "Invalid replacement should not write.",
    },
    context,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "unknown_replacement_grant");
  assert.equal(result.receipt.grant_store_committed, false);
  assert.equal(io.calls.includes("writeFile"), false);
  assert.equal(provenance.events.length, 0);
  assert.equal(JSON.parse(io.files.get(storePath)).grants[0].status, "active");
});

class MemoryGrantStoreIo {
  constructor(files = {}) {
    this.files = new Map();
    for (const [filePath, value] of Object.entries(files)) {
      this.files.set(filePath, typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
    }
    this.calls = [];
  }

  async readFile(filePath) {
    this.calls.push("readFile");
    return this.files.get(filePath);
  }

  tempPath({ grant_store_path: grantStorePath, mutation_id: mutationId }) {
    this.calls.push("tempPath");
    return `${grantStorePath}.${mutationId}.tmp`;
  }

  async writeFile(filePath, contents) {
    this.calls.push("writeFile");
    this.files.set(filePath, contents);
  }

  async fsyncFile() {
    this.calls.push("fsyncFile");
  }

  async rename(source, target) {
    this.calls.push("rename");
    this.files.set(target, this.files.get(source));
    this.files.delete(source);
  }

  async fsyncDir() {
    this.calls.push("fsyncDir");
  }
}

class MemoryProvenanceLog {
  constructor({ calls = [] } = {}) {
    this.calls = calls;
    this.events = [];
  }

  async append(event) {
    this.calls.push("provenance.append");
    this.events.push(event);
  }
}

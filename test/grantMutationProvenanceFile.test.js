import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { createGrantCreatedProvenanceEvent } from "../src/grantMutationProvenance.js";
import {
  appendGrantMutationProvenanceEvent,
  createGrantMutationProvenanceFile,
  readGrantMutationProvenanceEvents,
  validateDurableGrantMutationEvent,
} from "../src/grantMutationProvenanceFile.js";
import { createGrant } from "../src/grants.js";
import { createGrantStoreFileIo } from "../src/grantStoreFileAdapters.js";
import { writeGrantStoreMutation } from "../src/grantStoreWriter.js";

const grant = {
  id: "grant-created",
  status: "active",
  capability: "desktop.inspect.focus",
  provider: "soma.provider.desktop-broker",
  scope: "session",
  constraints: { include_text: false },
  approved_by: "user",
  approval_provenance_id: "prov-approval",
  reason: "Inspect the focused desktop object for this session.",
  created_at: "2026-05-20T12:00:00.000Z",
  activation_performed: false,
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

test("grant mutation provenance file appends and reads metadata-only events", async () => {
  const workspace = await makeWorkspace();
  try {
    const provenancePath = path.join(workspace, "grant-mutations.ndjson");
    const adapter = createGrantMutationProvenanceFile({ path: provenancePath });
    const event = createGrantCreatedProvenanceEvent({ grant });

    const appended = await adapter.append(event);
    const readBack = await adapter.read();
    const raw = await readFile(provenancePath, "utf8");

    assert.deepEqual(appended, event);
    assert.deepEqual(readBack, [event]);
    assert.equal(raw.split("\n").filter(Boolean).length, 1);
    assert.equal(JSON.stringify(readBack).includes("constraints"), false);
    assert.equal(JSON.stringify(readBack).includes("payload_bytes"), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("grant mutation provenance file appends multiple events without replacing prior lines", async () => {
  const workspace = await makeWorkspace();
  try {
    const provenancePath = path.join(workspace, "grant-mutations.ndjson");
    const event = createGrantCreatedProvenanceEvent({ grant });

    await appendGrantMutationProvenanceEvent(provenancePath, event);
    await appendGrantMutationProvenanceEvent(provenancePath, {
      ...event,
      grant_id: "grant-second",
      timestamp: "2026-05-20T12:01:00.000Z",
    });

    const readBack = await readGrantMutationProvenanceEvents(provenancePath);
    assert.equal(readBack.length, 2);
    assert.deepEqual(readBack.map((entry) => entry.grant_id), ["grant-created", "grant-second"]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("grant mutation provenance file accepts file URL paths", async () => {
  const workspace = await makeWorkspace();
  try {
    const provenancePath = path.join(workspace, "grant-mutations.ndjson");
    const adapter = createGrantMutationProvenanceFile({ path: pathToFileURL(provenancePath) });
    const event = createGrantCreatedProvenanceEvent({ grant });

    await adapter.append(event);

    assert.deepEqual(await adapter.read(), [event]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("grant mutation provenance file rejects payload-like fields before append", async () => {
  const workspace = await makeWorkspace();
  try {
    const provenancePath = path.join(workspace, "grant-mutations.ndjson");
    const event = {
      ...createGrantCreatedProvenanceEvent({ grant }),
      payload_bytes: "must not persist",
    };

    await assert.rejects(
      () => appendGrantMutationProvenanceEvent(provenancePath, event),
      (error) => error.code === "grant_mutation_provenance_forbidden_field"
        && error.message.includes("payload_bytes"),
    );
    assert.deepEqual(await readGrantMutationProvenanceEvents(provenancePath), []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("grant mutation provenance file rejects unexpected fields before append", async () => {
  const workspace = await makeWorkspace();
  try {
    const provenancePath = path.join(workspace, "grant-mutations.ndjson");
    const event = {
      ...createGrantCreatedProvenanceEvent({ grant }),
      arbitrary_metadata: "not allowed",
    };

    await assert.rejects(
      () => appendGrantMutationProvenanceEvent(provenancePath, event),
      (error) => error.code === "grant_mutation_provenance_unexpected_field"
        && error.message.includes("arbitrary_metadata"),
    );
    assert.deepEqual(await readGrantMutationProvenanceEvents(provenancePath), []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("grant mutation provenance file read fails closed on malformed lines", async () => {
  const workspace = await makeWorkspace();
  try {
    const provenancePath = path.join(workspace, "grant-mutations.ndjson");
    await writeFile(
      provenancePath,
      `${JSON.stringify(createGrantCreatedProvenanceEvent({ grant }))}\n{not json}\n`,
      "utf8",
    );

    await assert.rejects(
      () => readGrantMutationProvenanceEvents(provenancePath),
      (error) => error.stage === "read" && error.line_number === 2,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("writer reports degraded recovery when durable provenance rejects malformed event after commit", async () => {
  const workspace = await makeWorkspace();
  try {
    const grantStorePath = path.join(workspace, "grants.json");
    const provenancePath = path.join(workspace, "grant-mutations.ndjson");
    await writeFile(
      grantStorePath,
      `${JSON.stringify({ schema_version: 1, grants: [], examples: [] }, null, 2)}\n`,
      "utf8",
    );

    const result = await writeGrantStoreMutation({
      grantStorePath,
      mutationKind: "grant.created",
      mutationId: "mutation-malformed-provenance",
      io: createGrantStoreFileIo(),
      provenance: createGrantMutationProvenanceFile({ path: provenancePath }),
      mutate: (store) => {
        const nextStore = createGrant(store, {
          id: "grant-created",
          capability: "desktop.inspect.focus",
          provider: "soma.provider.desktop-broker",
          scope: "session",
          constraints: { include_text: false },
          approved_by: "user",
          direct_user_action: true,
          reason: "Inspect the focused desktop object for this session.",
          created_at: "2026-05-20T12:00:00.000Z",
        }, { catalog, providerRegistry });
        const createdGrant = nextStore.grants[0];
        return {
          nextStore,
          grant: createdGrant,
          event: {
            ...createGrantCreatedProvenanceEvent({ grant: createdGrant }),
            payload_bytes: "must not persist",
          },
        };
      },
    });

    const persisted = JSON.parse(await readFile(grantStorePath, "utf8"));
    assert.equal(result.ok, false);
    assert.equal(result.code, "grant_store_provenance_append_failed");
    assert.equal(result.receipt.status, "degraded");
    assert.equal(result.receipt.grant_store_committed, true);
    assert.equal(result.receipt.provenance_appended, false);
    assert.equal(result.receipt.recovery_required, true);
    assert.equal(persisted.grants[0].id, "grant-created");
    assert.deepEqual(await readGrantMutationProvenanceEvents(provenancePath), []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("grant mutation provenance validator normalizes optional durable fields", () => {
  const event = validateDurableGrantMutationEvent({
    event_type: "grant.created",
    grant_id: "grant-created",
    capability: "desktop.inspect.focus",
    provider: "soma.provider.desktop-broker",
    scope: "session",
    actor: "user",
    reason: "Inspect the focused desktop object for this session.",
    timestamp: "2026-05-20T12:00:00.000Z",
    activation_performed: false,
  });

  assert.equal(event.source_proposal_id, "");
  assert.equal(event.approval_provenance_id, "");
  assert.equal(event.replacement_grant_id, "");
  assert.equal(event.activation_performed, false);
});

async function makeWorkspace() {
  return mkdtemp(path.join(os.tmpdir(), "soma-grant-provenance-"));
}

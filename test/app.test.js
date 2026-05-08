import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { createRequestHandler } from "../src/app.js";
import { inspectDesktopBrokerEnvironment } from "../src/desktopBroker.js";

const allowedHarness = {
  capabilities: [
    { key: "model.local.chat", status: "allowed" },
    { key: "memory.session.read", status: "allowed" },
    { key: "memory.session.write", status: "allowed" },
    { key: "provenance.read", status: "allowed" },
    { key: "provenance.clear", status: "allowed" },
    { key: "stewardship.cognitive_load.assess", status: "allowed" },
    { key: "tool.files.read", status: "allowed" },
    { key: "desktop.inspect.accessibility_tree", status: "allowed" },
  ],
  disclosure: {
    remote_services_used: false,
    memory_writes_enabled: false,
    perception_mode: "submitted_text_only",
  },
  filesystem: {
    read_roots: ["."],
    max_read_bytes: 256000,
  },
};

const focusedInspectionHarness = {
  ...allowedHarness,
  capabilities: [
    ...allowedHarness.capabilities,
    { key: "desktop.inspect.focus", status: "allowed" },
  ],
};

const runtimeProfiles = {
  schema_version: 1,
  default_profile: "local-test",
  profiles: [
    {
      id: "local-test",
      route: "local",
      endpoint: "http://127.0.0.1:8000",
      model: "local-test-model",
      remote_service: false,
      allowed_data_classes: ["submitted_text"],
    },
  ],
};

const moduleRegistry = {
  schema_version: 1,
  modules: [
    {
      id: "pause-local-chat",
      name: "Pause Local Chat",
      approval_state: "approved",
      adoption: {
        impact_scope: "self",
        capability_effect: "narrowing",
        adoption_policy: "self_apply",
      },
      overlay: {
        disabled_capabilities: ["model.local.chat"],
      },
    },
    {
      id: "no-session-memory",
      name: "No Session Memory",
      approval_state: "approved",
      adoption: {
        impact_scope: "self",
        capability_effect: "narrowing",
        adoption_policy: "self_apply",
      },
      overlay: {
        disabled_capabilities: ["memory.session.read", "memory.session.write"],
      },
    },
    {
      id: "no-cognitive-load-stewardship",
      name: "No Cognitive Load Stewardship",
      approval_state: "approved",
      adoption: {
        impact_scope: "self",
        capability_effect: "narrowing",
        adoption_policy: "self_apply",
      },
      overlay: {
        disabled_capabilities: ["stewardship.cognitive_load.assess"],
      },
    },
    {
      id: "no-file-read",
      name: "No File Read",
      approval_state: "approved",
      adoption: {
        impact_scope: "self",
        capability_effect: "narrowing",
        adoption_policy: "self_apply",
      },
      overlay: {
        disabled_capabilities: ["tool.files.read"],
      },
    },
    {
      id: "no-desktop-inspection",
      name: "No Desktop Inspection",
      approval_state: "approved",
      adoption: {
        impact_scope: "self",
        capability_effect: "narrowing",
        adoption_policy: "self_apply",
      },
      overlay: {
        disabled_capabilities: ["desktop.inspect.accessibility_tree"],
      },
    },
  ],
};

const capabilityCatalog = {
  schema_version: 1,
  capabilities: [
    {
      key: "model.local.chat",
      name: "Local Model Chat",
      category: "model",
      risk_class: "low",
      default_status: "allowed",
      activation_policy: "base_harness",
    },
    {
      key: "desktop.inspect.focus",
      name: "Focused Desktop Inspection",
      category: "desktop",
      risk_class: "sensitive",
      default_status: "disabled",
      activation_policy: "explicit_grant",
    },
    {
      key: "desktop.inspect.text",
      name: "Desktop Text Inspection",
      category: "desktop",
      risk_class: "high",
      default_status: "disabled",
      activation_policy: "explicit_grant",
    },
  ],
};

const providerRegistry = {
  schema_version: 1,
  providers: [
    {
      id: "local-model",
      name: "Local Model",
      runtime: "test",
      local_only: true,
      network_access: false,
      capabilities: ["model.local.chat"],
    },
    {
      id: "desktop-broker",
      name: "Desktop Broker",
      runtime: "test",
      local_only: true,
      network_access: false,
      capabilities: ["desktop.inspect.focus"],
    },
  ],
};

const grantStore = {
  schema_version: 1,
  grants: [
    {
      id: "grant-1",
      status: "active",
      capability: "desktop.inspect.focus",
      provider: "desktop-broker",
      scope: "session",
      constraints: { include_text: false },
      approved_by: "user",
      reason: "Need focused object role for the current session.",
      created_at: "2026-05-06T12:00:00.000Z",
      activation_performed: false,
    },
    {
      id: "grant-2",
      status: "revoked",
      capability: "desktop.inspect.text",
      provider: "desktop-broker",
      scope: "session",
      constraints: {},
      approved_by: "user",
      reason: "Previous text inspection test.",
      created_at: "2026-05-06T12:10:00.000Z",
      revoked_at: "2026-05-06T12:15:00.000Z",
      revoked_by: "user",
      revocation_reason: "Text inspection was no longer needed.",
      replacement_grant_id: "grant-3",
      activation_performed: false,
    },
  ],
  examples: [
    {
      id: "example-grant",
      status: "revoked",
      capability: "desktop.inspect.focus",
    },
  ],
};

test("GET /health returns ok", async () => {
  const response = await invoke({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { status: "ok" });
});

test("GET /harness returns active harness", async () => {
  const response = await invoke({ method: "GET", url: "/harness", harness: allowedHarness });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.harness_id, allowedHarness.harness_id);
  assert.equal(response.body.runtime_profiles.default_profile, "local-test");
});

test("GET /capability-view groups active requestable and unsupported capabilities", async () => {
  const response = await invoke({
    method: "GET",
    url: "/capability-view",
    harness: allowedHarness,
    capabilityCatalog,
    providerRegistry,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.summary.total, 3);
  assert.equal(response.body.summary.by_status.active, 1);
  assert.equal(response.body.summary.by_status.requestable, 1);
  assert.equal(response.body.summary.by_status.unsupported, 1);
  assert.equal(response.body.grouped.desktop.total, 2);
  const focus = response.body.capabilities.find((capability) => capability.key === "desktop.inspect.focus");
  const text = response.body.capabilities.find((capability) => capability.key === "desktop.inspect.text");
  assert.equal(focus.status, "requestable");
  assert.equal(focus.providers[0].id, "desktop-broker");
  assert.equal(text.status, "unsupported");
});

test("capability proposals can be created and listed without activation", async () => {
  const handler = makeHandler({ harness: allowedHarness });

  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/capability-proposals",
    body: {
      requested_by: "assistant",
      capability: "desktop.inspect.focus",
      reason: "Need to identify the currently focused UI role before advising next action.",
      requested_scope: "session",
      data_exposed: ["focused object role", "focused object child count"],
      excluded_data: ["text content", "screenshots"],
      risk: "May reveal active application context.",
      fallback: "Continue with broad desktop inspection summary only.",
    },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.proposal.status, "pending");
  assert.equal(response.body.proposal.capability, "desktop.inspect.focus");
  assert.equal(response.body.notification.title, "Capability requested");
  assert.equal(response.body.activation_performed, false);
  assert.match(response.body.provenance_id, /^[0-9a-f-]{36}$/);
  const proposalId = response.body.proposal.id;
  const provenanceId = response.body.provenance_id;

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/capability-proposals?status=pending",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.proposals.length, 1);
  assert.equal(response.body.proposals[0].id, proposalId);
  assert.equal(response.body.proposals[0].provenance_id, provenanceId);

  response = await invokeHandler(handler, {
    method: "GET",
    url: `/capability-proposals/${proposalId}`,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.proposal.id, proposalId);
  assert.equal(response.body.proposal.reason, "Need to identify the currently focused UI role before advising next action.");
  assert.equal(response.body.activation_performed, false);
  assert.equal(response.body.durable, false);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/notifications",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.notifications.length, 1);
  assert.equal(response.body.notifications[0].type, "capability_proposal");
  assert.equal(response.body.notifications[0].proposal_id, proposalId);
  assert.equal(response.body.notifications[0].capability, "desktop.inspect.focus");
  assert.equal(response.body.notifications[0].activation_performed, false);
  assert.equal(response.body.notifications[0].choices[0].path, `/capability-proposals/${proposalId}`);
  assert.equal(response.body.notifications[0].choices[1].path, `/capability-proposals/${proposalId}/approve`);
  assert.equal(response.body.notifications[0].choices[2].path, `/capability-proposals/${proposalId}/deny`);
  assert.equal(response.body.summary.total, 1);
  assert.equal(response.body.summary.by_type.capability_proposal, 1);
  assert.equal(response.body.summary.by_status.pending, 1);
  assert.equal(response.body.activation_performed, false);
  assert.equal(response.body.durable, false);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/harness-modules",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.pending_capability_proposals, 1);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/provenance?event_type=capability.proposal.created",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.entries.length, 1);
  assert.equal(response.body.entries[0].id, provenanceId);
  assert.equal(response.body.entries[0].capability, "capability.proposal.create");
  assert.equal(response.body.entries[0].requested_capability, "desktop.inspect.focus");
  assert.equal(response.body.entries[0].activation_performed, false);
});

test("GET /grants lists file-backed grants without activation", async () => {
  const response = await invoke({
    method: "GET",
    url: "/grants?status=active",
    harness: allowedHarness,
    grantStore,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.grants.length, 1);
  assert.equal(response.body.grants[0].id, "grant-1");
  assert.equal(response.body.grants[0].capability, "desktop.inspect.focus");
  assert.equal(response.body.grants[0].activation_performed, false);
  assert.equal(response.body.summary.total, 2);
  assert.equal(response.body.summary.by_status.active, 1);
  assert.equal(response.body.summary.by_status.revoked, 1);
  assert.equal(response.body.examples_available, true);
  assert.equal(response.body.file_backed, true);
  assert.equal(response.body.writable, false);
  assert.equal(response.body.runtime_writes_enabled, false);
  assert.equal(response.body.activation_performed, false);
});

test("GET /grants exposes revoked grant metadata without activation", async () => {
  const response = await invoke({
    method: "GET",
    url: "/grants?status=revoked",
    harness: allowedHarness,
    grantStore,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.grants.length, 1);
  assert.equal(response.body.grants[0].id, "grant-2");
  assert.equal(response.body.grants[0].status, "revoked");
  assert.equal(response.body.grants[0].revoked_at, "2026-05-06T12:15:00.000Z");
  assert.equal(response.body.grants[0].revoked_by, "user");
  assert.equal(response.body.grants[0].revocation_reason, "Text inspection was no longer needed.");
  assert.equal(response.body.grants[0].replacement_grant_id, "grant-3");
  assert.equal(response.body.grants[0].activation_performed, false);
});

test("capability proposal creation requires reason scope risk exposure and fallback", async () => {
  const response = await invoke({
    method: "POST",
    url: "/capability-proposals",
    harness: allowedHarness,
    body: {
      requested_by: "assistant",
      capability: "desktop.inspect.focus",
      requested_scope: "session",
      data_exposed: ["focused object role"],
      risk: "May reveal active application context.",
      fallback: "Continue without focus.",
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "invalid_capability_proposal");
});

test("GET /capability-proposals/:id returns not found for unknown proposal", async () => {
  const response = await invoke({
    method: "GET",
    url: "/capability-proposals/not-found",
    harness: allowedHarness,
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error, "capability_proposal_not_found");
});

test("capability proposals can be approved without activation", async () => {
  const handler = makeHandler({ harness: allowedHarness });
  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/capability-proposals",
    body: {
      requested_by: "assistant",
      capability: "desktop.inspect.focus",
      reason: "Need focused object role.",
      requested_scope: "session",
      data_exposed: ["focused object role"],
      risk: "May reveal active application context.",
      fallback: "Continue without focus.",
    },
  });
  const proposalId = response.body.proposal.id;

  response = await invokeHandler(handler, {
    method: "POST",
    url: `/capability-proposals/${proposalId}/approve`,
    body: { approved_scope: "session", decided_by: "user" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.proposal.status, "approved");
  assert.equal(response.body.decision.decision, "approved");
  assert.equal(response.body.decision.approved_scope, "session");
  assert.equal(response.body.activation_performed, false);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/harness-modules",
  });
  assert.equal(response.body.pending_capability_proposals, 0);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/provenance?event_type=capability.proposal.approved",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.entries.length, 1);
  assert.equal(response.body.entries[0].proposal_id, proposalId);
  assert.equal(response.body.entries[0].approved_scope, "session");
  assert.equal(response.body.entries[0].activation_performed, false);
});

test("capability proposals can be denied without activation", async () => {
  const handler = makeHandler({ harness: allowedHarness });
  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/capability-proposals",
    body: {
      requested_by: "assistant",
      capability: "desktop.inspect.focus",
      reason: "Need focused object role.",
      requested_scope: "session",
      data_exposed: ["focused object role"],
      risk: "May reveal active application context.",
      fallback: "Continue without focus.",
    },
  });
  const proposalId = response.body.proposal.id;

  response = await invokeHandler(handler, {
    method: "POST",
    url: `/capability-proposals/${proposalId}/deny`,
    body: { reason: "Not needed right now.", decided_by: "user" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.proposal.status, "denied");
  assert.equal(response.body.decision.decision, "denied");
  assert.equal(response.body.decision.denial_reason, "Not needed right now.");
  assert.equal(response.body.activation_performed, false);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/provenance?event_type=capability.proposal.denied",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.entries.length, 1);
  assert.equal(response.body.entries[0].proposal_id, proposalId);
  assert.equal(response.body.entries[0].denial_reason, "Not needed right now.");
});

test("capability proposal decisions cannot be repeated", async () => {
  const handler = makeHandler({ harness: allowedHarness });
  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/capability-proposals",
    body: {
      requested_by: "assistant",
      capability: "desktop.inspect.focus",
      reason: "Need focused object role.",
      requested_scope: "session",
      data_exposed: ["focused object role"],
      risk: "May reveal active application context.",
      fallback: "Continue without focus.",
    },
  });
  const proposalId = response.body.proposal.id;

  await invokeHandler(handler, {
    method: "POST",
    url: `/capability-proposals/${proposalId}/approve`,
    body: { approved_scope: "session" },
  });

  response = await invokeHandler(handler, {
    method: "POST",
    url: `/capability-proposals/${proposalId}/deny`,
    body: { reason: "Changed my mind." },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.error, "capability_proposal_already_decided");
});

test("POST /chat routes through local model when capability is allowed", async () => {
  const modelClient = {
    model: "local-test-model",
    async chat({ messages, model }) {
      assert.deepEqual(messages, [{ role: "user", content: "hello" }]);
      assert.equal(model, "local-test-model");
      return {
        text: "hello from local model",
        model,
        finish_reason: "stop",
        tokens_used: 7,
      };
    },
  };
  const response = await invoke({
    method: "POST",
    url: "/chat",
    harness: allowedHarness,
    modelClient,
    body: { messages: [{ role: "user", content: "hello" }] },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.text, "hello from local model");
  assert.equal(response.body.model, "local-test-model");
  assert.equal(response.body.model_profile, "local-test");
  assert.equal(response.body.capability_used, "model.local.chat");
  assert.equal(response.body.remote_service_used, false);
  assert.match(response.body.provenance_id, /^[0-9a-f-]{36}$/);
});

test("POST /chat fails closed when local chat is disabled", async () => {
  const harness = {
    capabilities: [{ key: "model.local.chat", status: "disabled" }],
  };
  const response = await invoke({
    method: "POST",
    url: "/chat",
    harness,
    body: { messages: [{ role: "user", content: "hello" }] },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "capability_not_allowed");
});

test("self-applied narrowing module disables local chat until dropped", async () => {
  const handler = makeHandler({ harness: allowedHarness, moduleRegistry });

  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/harness-modules/adopt",
    body: { module_id: "pause-local-chat" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.active_modules.length, 1);

  response = await invokeHandler(handler, {
    method: "POST",
    url: "/chat",
    body: { messages: [{ role: "user", content: "hello" }] },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "capability_not_allowed");

  response = await invokeHandler(handler, {
    method: "POST",
    url: "/harness-modules/drop",
    body: { module_id: "pause-local-chat" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.active_modules.length, 0);

  response = await invokeHandler(handler, {
    method: "POST",
    url: "/chat",
    body: { messages: [{ role: "user", content: "hello" }] },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.capability_used, "model.local.chat");
});

test("module adoption and drop are recorded in provenance", async () => {
  const handler = makeHandler({ harness: allowedHarness, moduleRegistry });

  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/harness-modules/adopt",
    body: { module_id: "pause-local-chat" },
  });
  assert.equal(response.statusCode, 200);

  response = await invokeHandler(handler, {
    method: "POST",
    url: "/harness-modules/drop",
    body: { module_id: "pause-local-chat" },
  });
  assert.equal(response.statusCode, 200);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/provenance?event_type=harness.module.adopted",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.entries.length, 1);
  assert.equal(response.body.entries[0].module_id, "pause-local-chat");
  assert.equal(response.body.entries[0].event_type, "harness.module.adopted");
  assert.equal(response.body.entries[0].capability, "harness.module.configure");
  assert.deepEqual(response.body.filters, {
    allowed: null,
    capability: "",
    eventType: "harness.module.adopted",
    limit: null,
  });

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/provenance/summary",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.summary.by_event_type["harness.module.adopted"], 1);
  assert.equal(response.body.summary.by_event_type["harness.module.dropped"], 1);
  assert.equal(response.body.summary.by_capability["harness.module.configure"], 2);
});

test("session memory can be written, read, and cleared when allowed", async () => {
  const handler = makeHandler({ harness: allowedHarness });

  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/session-memory",
    body: { role: "note", content: "Keep this in session only." },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.durable, false);
  assert.match(response.body.provenance_id, /^[0-9a-f-]{36}$/);
  const writeProvenanceId = response.body.provenance_id;

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/session-memory",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.entries.length, 1);
  assert.equal(response.body.entries[0].content, "Keep this in session only.");

  response = await invokeHandler(handler, {
    method: "DELETE",
    url: "/session-memory",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.removed, 1);
  assert.match(response.body.provenance_id, /^[0-9a-f-]{36}$/);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/provenance?event_type=memory.session.written",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.entries.length, 1);
  assert.equal(response.body.entries[0].id, writeProvenanceId);
  assert.equal(response.body.entries[0].memory_role, "note");
  assert.equal(response.body.entries[0].memory_source, "manual");
  assert.equal(response.body.entries[0].memory_written, true);
  assert.equal("content" in response.body.entries[0], false);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/provenance/summary",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.summary.by_event_type["memory.session.written"], 1);
  assert.equal(response.body.summary.by_event_type["memory.session.cleared"], 1);
});

test("chat can read and write ephemeral session memory when explicitly requested", async () => {
  const seenMessages = [];
  const modelClient = {
    model: "local-test-model",
    withProfile(profile) {
      return {
        model: profile.model,
        async chat(request) {
          seenMessages.push(request.messages);
          return {
            text: "remembered for this session",
            model: profile.model,
            finish_reason: "stop",
            tokens_used: 9,
          };
        },
      };
    },
  };
  const handler = makeHandler({ harness: allowedHarness, modelClient });

  await invokeHandler(handler, {
    method: "POST",
    url: "/session-memory",
    body: { role: "note", content: "Session note." },
  });

  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/chat",
    body: {
      use_session_memory: true,
      write_session_memory: true,
      messages: [{ role: "user", content: "hello" }],
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.memory_read, true);
  assert.equal(response.body.memory_written, true);
  assert.equal(seenMessages[0][0].role, "system");
  assert.match(seenMessages[0][0].content, /Session note\./);

  const memory = await invokeHandler(handler, {
    method: "GET",
    url: "/session-memory",
  });
  assert.equal(memory.body.entries.length, 3);
});

test("no-session-memory module blocks session memory access", async () => {
  const handler = makeHandler({ harness: allowedHarness, moduleRegistry });

  await invokeHandler(handler, {
    method: "POST",
    url: "/harness-modules/adopt",
    body: { module_id: "no-session-memory" },
  });

  const response = await invokeHandler(handler, {
    method: "GET",
    url: "/session-memory",
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "capability_not_allowed");
});

test("file read returns content only inside granted scope and records provenance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "soma-file-read-"));
  const filePath = path.join(root, "note.txt");
  await writeFile(filePath, "Scoped read ok.", "utf8");
  const handler = makeHandler({
    harness: {
      ...allowedHarness,
      filesystem: {
        read_roots: [root],
        max_read_bytes: 1024,
      },
    },
  });

  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/files/read",
    body: { path: filePath },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.content, "Scoped read ok.");
  assert.equal(response.body.bytes, 15);
  assert.match(response.body.provenance_id, /^[0-9a-f-]{36}$/);
  const provenanceId = response.body.provenance_id;

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/provenance?event_type=tool.files.read",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.entries.length, 1);
  assert.equal(response.body.entries[0].id, provenanceId);
  assert.equal(response.body.entries[0].capability, "tool.files.read");
  assert.equal(response.body.entries[0].file_path, filePath);
  assert.equal(response.body.entries[0].file_bytes, 15);
  assert.equal("content" in response.body.entries[0], false);
});

test("file read fails closed outside granted scope", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "soma-file-root-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "soma-file-outside-"));
  const outsidePath = path.join(outside, "outside.txt");
  await writeFile(outsidePath, "Outside.", "utf8");
  const handler = makeHandler({
    harness: {
      ...allowedHarness,
      filesystem: {
        read_roots: [root],
        max_read_bytes: 1024,
      },
    },
  });

  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/files/read",
    body: { path: outsidePath },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "file_scope_denied");
});

test("self-applied module disables file read", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "soma-file-module-"));
  const filePath = path.join(root, "note.txt");
  await writeFile(filePath, "Blocked.", "utf8");
  const handler = makeHandler({
    harness: {
      ...allowedHarness,
      filesystem: {
        read_roots: [root],
        max_read_bytes: 1024,
      },
    },
    moduleRegistry,
  });

  await invokeHandler(handler, {
    method: "POST",
    url: "/harness-modules/adopt",
    body: { module_id: "no-file-read" },
  });

  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/files/read",
    body: { path: filePath },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "capability_not_allowed");
});

test("desktop accessibility inspection scaffold returns environment metadata and provenance", async () => {
  const handler = makeHandler({ harness: allowedHarness });

  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/desktop/inspect/accessibility-tree",
    body: {},
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.inspection.mode, "read_only_environment_probe");
  assert.ok(["javascript_fallback", "rust_helper"].includes(response.body.inspection.broker_source));
  assert.equal(response.body.inspection.tree_available, false);
  assert.equal(response.body.inspection.tree, null);
  assert.equal(typeof response.body.inspection.dbus_session_bus_available, "boolean");
  assert.match(response.body.provenance_id, /^[0-9a-f-]{36}$/);
  const provenanceId = response.body.provenance_id;
  const brokerSource = response.body.inspection.broker_source;

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/provenance?event_type=desktop.inspect.accessibility_tree",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.entries.length, 1);
  assert.equal(response.body.entries[0].id, provenanceId);
  assert.equal(response.body.entries[0].capability, "desktop.inspect.accessibility_tree");
  assert.equal(response.body.entries[0].broker_source, brokerSource);
  assert.equal(response.body.entries[0].inspection_mode, "read_only_environment_probe");
  assert.equal(response.body.entries[0].tree_available, false);
});

test("desktop broker uses rust helper when available", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "soma-desktop-helper-"));
  const helperPath = path.join(root, "soma-desktop-broker");
  await writeFile(helperPath, `#!/usr/bin/env sh
cat <<'JSON'
{"mode":"read_only_environment_probe","broker_source":"rust_helper","platform":"linux","release":"test","desktop_session":"test","session_type":"wayland","wayland_display_present":true,"x11_display_present":false,"dbus_session_bus_available":true,"atspi_likely_available":true,"candidate_adapters":{"atspi_dbus":true,"kde_kwin":false,"xdg_desktop_portal":true,"wayland_keyboard_input":false,"uinput_input":false},"commands":{"gdbus":true,"busctl":false,"qdbus":false,"wtype":false,"ydotool":false},"tree":null,"tree_available":false}
JSON
`, "utf8");
  await chmod(helperPath, 0o755);

  const inspection = await inspectDesktopBrokerEnvironment({ helperPath });

  assert.equal(inspection.broker_source, "rust_helper");
  assert.equal(inspection.platform, "linux");
  assert.equal(inspection.atspi_likely_available, true);
});

test("desktop broker asks rust helper for AT-SPI probe when requested", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "soma-desktop-atspi-helper-"));
  const helperPath = path.join(root, "soma-desktop-broker");
  await writeFile(helperPath, `#!/usr/bin/env sh
if [ "$1" = "inspect-atspi" ]; then
  printf '%s\\n' '{"mode":"read_only_atspi_probe","broker_source":"rust_helper","platform":"linux","release":"test","desktop_session":"GNOME","session_type":"wayland","dbus_session_bus_available":true,"atspi_likely_available":true,"atspi_bus_address_available":true,"application_count":1,"root_object_available_count":1,"window_count":0,"tree":{"applications":[{"service":":1.42","pid":123,"process":"test-app","registry":false,"root_object":{"path":"/org/a11y/atspi/accessible/root","name":"test-app","role":"application","child_count":1,"children_sample":[{"service":":1.42","path":"/child"}],"child_metadata_sample":[{"service":":1.42","path":"/child","role":"frame","child_count":0}]},"root_object_error":null}],"windows":[],"bounded":true,"text_content_included":false},"tree_available":true}'
else
  printf '%s\\n' '{"mode":"read_only_environment_probe","broker_source":"rust_helper","platform":"linux","release":"test","desktop_session":"GNOME","session_type":"wayland","wayland_display_present":true,"x11_display_present":false,"dbus_session_bus_available":true,"atspi_likely_available":true,"candidate_adapters":{},"commands":{},"tree":null,"tree_available":false}'
fi
`, "utf8");
  await chmod(helperPath, 0o755);

  const inspection = await inspectDesktopBrokerEnvironment({ helperPath, mode: "atspi" });

  assert.equal(inspection.mode, "read_only_atspi_probe");
  assert.equal(inspection.broker_source, "rust_helper");
  assert.equal(inspection.application_count, 1);
  assert.equal(inspection.root_object_available_count, 1);
  assert.equal(inspection.tree_available, true);
  assert.equal(inspection.tree.applications[0].process, "test-app");
  assert.equal(inspection.tree.applications[0].root_object.role, "application");
  assert.equal(inspection.tree.applications[0].root_object.child_metadata_sample[0].role, "frame");
});

test("desktop broker rejects helper output that exceeds the inspection contract", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "soma-desktop-invalid-helper-"));
  const helperPath = path.join(root, "soma-desktop-broker");
  await writeFile(helperPath, `#!/usr/bin/env sh
printf '%s\\n' '{"mode":"read_only_atspi_probe","broker_source":"rust_helper","platform":"linux","release":"test","desktop_session":"GNOME","session_type":"wayland","dbus_session_bus_available":true,"atspi_likely_available":true,"atspi_bus_address_available":true,"application_count":1,"root_object_available_count":1,"window_count":0,"tree":{"applications":[{"service":":1.42","pid":123,"process":"test-app","registry":false,"root_object":{"path":"/org/a11y/atspi/accessible/root","name":"test-app","role":"application","child_count":1,"children_sample":[],"child_metadata_sample":[{"service":":1.42","path":"/child","role":"frame","child_count":0,"name":"private child title"}]},"root_object_error":null}],"windows":[],"bounded":true,"text_content_included":false},"tree_available":true}'
`, "utf8");
  await chmod(helperPath, 0o755);

  await assert.rejects(
    () => inspectDesktopBrokerEnvironment({ helperPath, mode: "atspi" }),
    {
      code: "desktop_inspection_schema_invalid",
      statusCode: 502,
    },
  );
});

test("desktop inspection endpoint reports helper contract failures without returning helper payload", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "soma-desktop-invalid-endpoint-"));
  const helperPath = path.join(root, "soma-desktop-broker");
  await writeFile(helperPath, `#!/usr/bin/env sh
printf '%s\\n' '{"mode":"read_only_atspi_probe","broker_source":"rust_helper","platform":"linux","release":"test","desktop_session":"GNOME","session_type":"wayland","dbus_session_bus_available":true,"atspi_likely_available":true,"atspi_bus_address_available":true,"application_count":1,"root_object_available_count":1,"window_count":0,"tree":{"applications":[{"service":":1.42","pid":123,"process":"test-app","registry":false,"root_object":{"path":"/org/a11y/atspi/accessible/root","name":"test-app","role":"application","child_count":1,"children_sample":[],"child_metadata_sample":[{"service":":1.42","path":"/child","role":"frame","child_count":0,"description":"private child description"}]},"root_object_error":null}],"windows":[],"bounded":true,"text_content_included":false},"tree_available":true}'
`, "utf8");
  await chmod(helperPath, 0o755);
  const previousBroker = process.env.SOMA_DESKTOP_BROKER;
  process.env.SOMA_DESKTOP_BROKER = helperPath;
  try {
    const handler = makeHandler({ harness: allowedHarness });
    const response = await invokeHandler(handler, {
      method: "POST",
      url: "/desktop/inspect/accessibility-tree",
      body: { mode: "atspi" },
    });

    assert.equal(response.statusCode, 502);
    assert.equal(response.body.error, "desktop_inspection_schema_invalid");
    assert.ok(response.body.validation_errors.includes(
      "result.tree.applications[0].root_object.child_metadata_sample[0].description is not allowed",
    ));
    assert.equal("inspection" in response.body, false);

    const provenance = await invokeHandler(handler, {
      method: "GET",
      url: "/provenance?event_type=desktop.inspect.accessibility_tree",
    });
    assert.equal(provenance.statusCode, 200);
    assert.equal(provenance.body.entries.length, 0);
  } finally {
    if (previousBroker === undefined) {
      delete process.env.SOMA_DESKTOP_BROKER;
    } else {
      process.env.SOMA_DESKTOP_BROKER = previousBroker;
    }
  }
});

test("desktop accessibility inspection rejects traversal request shapes until traversal is implemented", async () => {
  for (const [name, body] of Object.entries({
    bounded_atspi_traversal: {
      mode: "atspi",
      traversal: {
        enabled: true,
        root: { service: ":1.42", path: "/org/a11y/atspi/accessible/root" },
        max_depth: 1,
        max_nodes: 16,
        max_children_per_node: 4,
      },
    },
    non_atspi_mode: {
      mode: "environment",
      traversal: {
        enabled: true,
        root: { service: ":1.42", path: "/org/a11y/atspi/accessible/root" },
        max_depth: 1,
        max_nodes: 16,
        max_children_per_node: 4,
      },
    },
    unknown_traversal_field: {
      mode: "atspi",
      traversal: {
        enabled: true,
        root: { service: ":1.42", path: "/org/a11y/atspi/accessible/root" },
        max_depth: 1,
        max_nodes: 16,
        max_children_per_node: 4,
        include_text: true,
      },
    },
    invalid_root_shape: {
      mode: "atspi",
      traversal: {
        enabled: true,
        root: { service: ":1.42" },
        max_depth: 1,
        max_nodes: 16,
        max_children_per_node: 4,
      },
    },
    excessive_limits: {
      mode: "atspi",
      traversal: {
        enabled: true,
        root: { service: ":1.42", path: "/org/a11y/atspi/accessible/root" },
        max_depth: 99,
        max_nodes: 10000,
        max_children_per_node: 1000,
      },
    },
  })) {
    const handler = makeHandler({ harness: allowedHarness });
    const response = await invokeHandler(handler, {
      method: "POST",
      url: "/desktop/inspect/accessibility-tree",
      body,
    });

    assert.equal(response.statusCode, 403, name);
    assert.equal(response.body.error, "desktop_traversal_not_implemented", name);

    const provenance = await invokeHandler(handler, {
      method: "GET",
      url: "/provenance?event_type=desktop.inspect.accessibility_tree",
    });
    assert.equal(provenance.statusCode, 200, name);
    assert.equal(provenance.body.entries.length, 0, name);
  }
});

test("desktop accessibility inspection rejects invalid request fields before provenance", async () => {
  for (const [name, body] of Object.entries({
    unknown_field: { mode: "atspi", include_text: true },
    invalid_mode: { mode: "focused" },
    invalid_max_apps: { mode: "atspi", max_apps: 65 },
    invalid_max_children: { mode: "atspi", max_children: 9 },
    non_integer_limit: { mode: "atspi", max_apps: 1.5 },
    string_limit: { mode: "atspi", max_children: "1" },
  })) {
    const handler = makeHandler({ harness: allowedHarness });
    const response = await invokeHandler(handler, {
      method: "POST",
      url: "/desktop/inspect/accessibility-tree",
      body,
    });

    assert.equal(response.statusCode, 400, name);
    assert.equal(response.body.error, "desktop_inspection_request_invalid", name);
    assert.equal("inspection" in response.body, false, name);
    assert.ok(Array.isArray(response.body.validation_errors), name);

    const provenance = await invokeHandler(handler, {
      method: "GET",
      url: "/provenance?event_type=desktop.inspect.accessibility_tree",
    });
    assert.equal(provenance.statusCode, 200, name);
    assert.equal(provenance.body.entries.length, 0, name);
  }
});

test("desktop accessibility inspection can request bounded AT-SPI metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "soma-desktop-atspi-endpoint-"));
  const helperPath = path.join(root, "soma-desktop-broker");
  await writeFile(helperPath, `#!/usr/bin/env sh
printf '%s\\n' '{"mode":"read_only_atspi_probe","broker_source":"rust_helper","platform":"linux","release":"test","desktop_session":"GNOME","session_type":"wayland","dbus_session_bus_available":true,"atspi_likely_available":true,"atspi_bus_address_available":true,"application_count":2,"root_object_available_count":1,"window_count":0,"tree":{"applications":[{"service":":1.42","pid":123,"process":"test-app","registry":false,"root_object":{"path":"/org/a11y/atspi/accessible/root","name":"test-app","role":"application","child_count":1,"children_sample":[],"child_metadata_sample":[]},"root_object_error":null},{"service":"org.a11y.atspi.Registry","pid":111,"process":"at-spi2-registryd","registry":true,"root_object":null,"root_object_error":null}],"windows":[],"bounded":true,"text_content_included":false},"tree_available":true}'
`, "utf8");
  await chmod(helperPath, 0o755);
  const previousBroker = process.env.SOMA_DESKTOP_BROKER;
  process.env.SOMA_DESKTOP_BROKER = helperPath;
  try {
    const handler = makeHandler({ harness: allowedHarness });

    let response = await invokeHandler(handler, {
      method: "POST",
      url: "/desktop/inspect/accessibility-tree",
      body: { mode: "atspi" },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.inspection.mode, "read_only_atspi_probe");
    assert.equal(response.body.inspection.application_count, 2);
    assert.equal(response.body.inspection.root_object_available_count, 1);
    assert.equal(response.body.inspection.tree.text_content_included, false);
    const provenanceId = response.body.provenance_id;

    response = await invokeHandler(handler, {
      method: "GET",
      url: "/provenance?event_type=desktop.inspect.accessibility_tree",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.entries[0].id, provenanceId);
    assert.equal(response.body.entries[0].inspection_mode, "read_only_atspi_probe");
    assert.equal(response.body.entries[0].requested_mode, "atspi");
    assert.equal(response.body.entries[0].requested_max_apps, null);
    assert.equal(response.body.entries[0].requested_max_children, null);
    assert.equal(response.body.entries[0].application_count, 2);
    assert.equal(response.body.entries[0].root_object_available_count, 1);
    assert.equal(response.body.entries[0].window_count, 0);
    assert.equal(response.body.entries[0].tree_available, true);
  } finally {
    if (previousBroker === undefined) {
      delete process.env.SOMA_DESKTOP_BROKER;
    } else {
      process.env.SOMA_DESKTOP_BROKER = previousBroker;
    }
  }
});

test("desktop accessibility inspection can limit returned applications and child samples", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "soma-desktop-limited-endpoint-"));
  const helperPath = path.join(root, "soma-desktop-broker");
  await writeFile(helperPath, `#!/usr/bin/env sh
printf '%s\\n' '{"mode":"read_only_atspi_probe","broker_source":"rust_helper","platform":"linux","release":"test","desktop_session":"GNOME","session_type":"wayland","dbus_session_bus_available":true,"atspi_likely_available":true,"atspi_bus_address_available":true,"application_count":2,"root_object_available_count":2,"window_count":0,"tree":{"applications":[{"service":":1.42","pid":123,"process":"test-app","registry":false,"root_object":{"path":"/org/a11y/atspi/accessible/root","name":"test-app","role":"application","child_count":2,"children_sample":[{"service":":1.42","path":"/child-a"},{"service":":1.42","path":"/child-b"}],"child_metadata_sample":[{"service":":1.42","path":"/child-a","role":"frame","child_count":0},{"service":":1.42","path":"/child-b","role":"frame","child_count":0}]},"root_object_error":null},{"service":":1.43","pid":124,"process":"other-app","registry":false,"root_object":{"path":"/org/a11y/atspi/accessible/root","name":"other-app","role":"application","child_count":0,"children_sample":[],"child_metadata_sample":[]},"root_object_error":null}],"windows":[],"bounded":true,"text_content_included":false},"tree_available":true}'
`, "utf8");
  await chmod(helperPath, 0o755);
  const previousBroker = process.env.SOMA_DESKTOP_BROKER;
  process.env.SOMA_DESKTOP_BROKER = helperPath;
  try {
    const handler = makeHandler({ harness: allowedHarness });
    let response = await invokeHandler(handler, {
      method: "POST",
      url: "/desktop/inspect/accessibility-tree",
      body: { mode: "atspi", max_apps: 1, max_children: 1 },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.inspection.application_count, 1);
    assert.equal(response.body.inspection.root_object_available_count, 1);
    assert.equal(response.body.inspection.tree.applications.length, 1);
    assert.equal(response.body.inspection.tree.applications[0].root_object.children_sample.length, 1);
    assert.equal(response.body.inspection.tree.applications[0].root_object.child_metadata_sample.length, 1);

    response = await invokeHandler(handler, {
      method: "GET",
      url: "/provenance?event_type=desktop.inspect.accessibility_tree",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.entries[0].requested_mode, "atspi");
    assert.equal(response.body.entries[0].requested_max_apps, 1);
    assert.equal(response.body.entries[0].requested_max_children, 1);
    assert.equal(response.body.entries[0].application_count, 1);
  } finally {
    if (previousBroker === undefined) {
      delete process.env.SOMA_DESKTOP_BROKER;
    } else {
      process.env.SOMA_DESKTOP_BROKER = previousBroker;
    }
  }
});

test("focused desktop inspection is blocked when focus capability is disabled", async () => {
  const response = await invoke({
    method: "POST",
    url: "/desktop/inspect/focus",
    harness: allowedHarness,
    body: {},
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "capability_not_allowed");
});

test("focused desktop inspection returns bounded focus metadata and provenance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "soma-desktop-focus-endpoint-"));
  const helperPath = path.join(root, "soma-desktop-broker");
  await writeFile(helperPath, `#!/usr/bin/env sh
if [ "$1" = "inspect-focus" ]; then
  printf '%s\\n' '{"mode":"read_only_focused_object_probe","broker_source":"rust_helper","platform":"linux","release":"test","desktop_session":"GNOME","session_type":"wayland","focus_available":true,"focused_object":{"service":":1.42","path":"/org/a11y/atspi/accessible/focus","role":"frame","child_count":2,"application":{"service":":1.42","path":"/org/a11y/atspi/accessible/root"}},"text_content_included":false,"withheld_fields":["name","description","text","states","actions"]}'
else
  printf '%s\\n' '{"mode":"read_only_environment_probe","broker_source":"rust_helper","platform":"linux","release":"test","desktop_session":"GNOME","session_type":"wayland","wayland_display_present":true,"x11_display_present":false,"dbus_session_bus_available":true,"atspi_likely_available":true,"candidate_adapters":{},"commands":{},"tree":null,"tree_available":false}'
fi
`, "utf8");
  await chmod(helperPath, 0o755);
  const previousBroker = process.env.SOMA_DESKTOP_BROKER;
  process.env.SOMA_DESKTOP_BROKER = helperPath;
  try {
    const handler = makeHandler({ harness: focusedInspectionHarness });
    let response = await invokeHandler(handler, {
      method: "POST",
      url: "/desktop/inspect/focus",
      body: {},
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.inspection.mode, "read_only_focused_object_probe");
    assert.equal(response.body.inspection.focus_available, true);
    assert.equal(response.body.inspection.focused_object.role, "frame");
    assert.equal(response.body.inspection.focused_object.child_count, 2);
    assert.equal(response.body.inspection.text_content_included, false);
    assert.equal("name" in response.body.inspection.focused_object, false);
    const provenanceId = response.body.provenance_id;

    response = await invokeHandler(handler, {
      method: "GET",
      url: "/provenance?event_type=desktop.inspect.focus",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.entries.length, 1);
    assert.equal(response.body.entries[0].id, provenanceId);
    assert.equal(response.body.entries[0].capability, "desktop.inspect.focus");
    assert.equal(response.body.entries[0].focus_available, true);
    assert.equal(response.body.entries[0].focused_role, "frame");
    assert.equal(response.body.entries[0].focused_child_count, 2);
    assert.equal(response.body.entries[0].text_content_included, false);
    assert.equal("focused_name" in response.body.entries[0], false);
  } finally {
    if (previousBroker === undefined) {
      delete process.env.SOMA_DESKTOP_BROKER;
    } else {
      process.env.SOMA_DESKTOP_BROKER = previousBroker;
    }
  }
});

test("focused desktop inspection preserves fail-closed unavailable output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "soma-desktop-focus-unavailable-"));
  const helperPath = path.join(root, "soma-desktop-broker");
  await writeFile(helperPath, `#!/usr/bin/env sh
printf '%s\\n' '{"mode":"read_only_focused_object_probe","broker_source":"rust_helper","platform":"linux","release":"test","desktop_session":"GNOME","session_type":"wayland","dbus_session_bus_available":false,"focus_available":false,"focused_object":null,"unavailable_reason":"atspi_bus_address_unavailable","text_content_included":false,"withheld_fields":["name","description","text","states","actions"]}'
`, "utf8");
  await chmod(helperPath, 0o755);
  const previousBroker = process.env.SOMA_DESKTOP_BROKER;
  process.env.SOMA_DESKTOP_BROKER = helperPath;
  try {
    const handler = makeHandler({ harness: focusedInspectionHarness });
    let response = await invokeHandler(handler, {
      method: "POST",
      url: "/desktop/inspect/focus",
      body: {},
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.inspection.focus_available, false);
    assert.equal(response.body.inspection.focused_object, null);
    assert.equal(response.body.inspection.unavailable_reason, "atspi_bus_address_unavailable");
    assert.equal(response.body.inspection.text_content_included, false);
    assert.equal(response.body.inspection.dbus_session_bus_available, false);
    const provenanceId = response.body.provenance_id;

    response = await invokeHandler(handler, {
      method: "GET",
      url: "/provenance?event_type=desktop.inspect.focus",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.entries.length, 1);
    assert.equal(response.body.entries[0].id, provenanceId);
    assert.equal(response.body.entries[0].focus_available, false);
    assert.equal(response.body.entries[0].focused_role, "");
    assert.equal(response.body.entries[0].focused_child_count, null);
    assert.equal(response.body.entries[0].text_content_included, false);
  } finally {
    if (previousBroker === undefined) {
      delete process.env.SOMA_DESKTOP_BROKER;
    } else {
      process.env.SOMA_DESKTOP_BROKER = previousBroker;
    }
  }
});

test("focused desktop inspection rejects text inclusion", async () => {
  const response = await invoke({
    method: "POST",
    url: "/desktop/inspect/focus",
    harness: focusedInspectionHarness,
    body: { include_text: true },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "focused_desktop_text_not_allowed");
});

test("focused desktop inspection rejects helper over-disclosure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "soma-desktop-focus-invalid-"));
  const helperPath = path.join(root, "soma-desktop-broker");
  await writeFile(helperPath, `#!/usr/bin/env sh
printf '%s\\n' '{"mode":"read_only_focused_object_probe","broker_source":"rust_helper","platform":"linux","release":"test","desktop_session":"GNOME","session_type":"wayland","focus_available":true,"focused_object":{"service":":1.42","path":"/focus","role":"entry","child_count":0,"name":"private field label"},"text_content_included":false,"withheld_fields":["name","description","text","states","actions"]}'
`, "utf8");
  await chmod(helperPath, 0o755);
  const previousBroker = process.env.SOMA_DESKTOP_BROKER;
  process.env.SOMA_DESKTOP_BROKER = helperPath;
  try {
    const response = await invoke({
      method: "POST",
      url: "/desktop/inspect/focus",
      harness: focusedInspectionHarness,
      body: {},
    });

    assert.equal(response.statusCode, 502);
    assert.equal(response.body.error, "focused_desktop_inspection_schema_invalid");
    assert.ok(response.body.validation_errors.includes("result.focused_object.name is not allowed"));
    assert.equal("inspection" in response.body, false);
  } finally {
    if (previousBroker === undefined) {
      delete process.env.SOMA_DESKTOP_BROKER;
    } else {
      process.env.SOMA_DESKTOP_BROKER = previousBroker;
    }
  }
});

test("self-applied module disables desktop inspection", async () => {
  const handler = makeHandler({ harness: allowedHarness, moduleRegistry });

  await invokeHandler(handler, {
    method: "POST",
    url: "/harness-modules/adopt",
    body: { module_id: "no-desktop-inspection" },
  });

  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/desktop/inspect/accessibility-tree",
    body: {},
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "capability_not_allowed");
});

test("cognitive load stewardship returns a non-diagnostic advisory and provenance", async () => {
  const handler = makeHandler({ harness: allowedHarness });

  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/stewardship/cognitive-load",
    body: {
      messages: [
        {
          role: "user",
          content: "I feel confused and mentally fatigued. This is hard to hold onto and I may need to remember these insights.",
        },
      ],
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.assessment.mode, "text_only");
  assert.equal(response.body.assessment.advisory_needed, true);
  assert.equal(response.body.assessment.non_diagnostic, true);
  assert.equal(response.body.assessment.memory_written, false);
  assert.ok(response.body.assessment.choices.includes("pause"));
  assert.match(response.body.provenance_id, /^[0-9a-f-]{36}$/);
  const provenanceId = response.body.provenance_id;

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/provenance?event_type=stewardship.cognitive_load.assessed",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.entries.length, 1);
  assert.equal(response.body.entries[0].id, provenanceId);
  assert.equal(response.body.entries[0].capability, "stewardship.cognitive_load.assess");
  assert.equal(response.body.entries[0].cognitive_load_assessed, true);
  assert.equal(response.body.entries[0].cognitive_load_advisory_needed, true);
  assert.equal(response.body.entries[0].memory_written, false);
});

test("chat can include optional cognitive load assessment metadata", async () => {
  const response = await invoke({
    method: "POST",
    url: "/chat",
    body: {
      assess_cognitive_load: true,
      messages: [
        {
          role: "user",
          content: "I am overwhelmed and mentally fatigued, please help me preserve this insight.",
        },
      ],
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.cognitive_load_assessment.advisory_needed, true);
  assert.equal(response.body.cognitive_load_assessment.memory_written, false);
});

test("chat can surface local escalation triggers without remote routing", async () => {
  const escalationCatalog = {
    schema_version: 1,
    capabilities: [
      {
        key: "model.local.chat",
        name: "Local Model Chat",
        category: "model",
        default_status: "allowed",
        activation_policy: "base_harness",
      },
      {
        key: "model.remote.plan",
        name: "Remote Model Planning",
        category: "model",
        default_status: "disabled",
        activation_policy: "explicit_grant",
        provider_contract: "soma.model.remote.plan.v1",
      },
    ],
  };
  const modelClient = {
    model: "local-test-model",
    async chat() {
      return {
        text: "I am not sure this complex architecture request can be fully resolved locally.",
        model: "local-test-model",
        finish_reason: "stop",
        tokens_used: 11,
      };
    },
  };
  const handler = makeHandler({
    harness: allowedHarness,
    capabilityCatalog: escalationCatalog,
    providerRegistry: { schema_version: 1, providers: [] },
    modelClient,
  });

  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/chat",
    body: {
      assess_escalation: true,
      messages: [
        {
          role: "user",
          content: "This is a complex architecture task. Should we escalate to a remote planner?",
        },
      ],
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.remote_service_used, false);
  assert.equal(response.body.escalation_assessment.triggers_fired, true);
  assert.deepEqual(response.body.escalation_assessment.trigger_families, [
    "uncertainty",
    "complexity",
    "capability_gap",
  ]);
  assert.equal(response.body.escalation_assessment.remote_planning_status, "unsupported");
  assert.equal(response.body.escalation_assessment.remote_planning_available, false);
  assert.match(response.body.escalation_assessment.provenance_id, /^[0-9a-f-]{36}$/);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/provenance?event_type=model.local.escalation_proposed",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.entries.length, 1);
  assert.equal(response.body.entries[0].capability, "model.local.chat");
  assert.equal(response.body.entries[0].remote_service_used, false);
  assert.equal(response.body.entries[0].remote_planning_status, "unsupported");
  assert.deepEqual(response.body.entries[0].escalation_trigger_families, [
    "uncertainty",
    "complexity",
    "capability_gap",
  ]);
  assert.equal("content" in response.body.entries[0], false);
});

test("self-applied module disables cognitive load stewardship", async () => {
  const handler = makeHandler({ harness: allowedHarness, moduleRegistry });

  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/harness-modules/adopt",
    body: { module_id: "no-cognitive-load-stewardship" },
  });
  assert.equal(response.statusCode, 200);

  response = await invokeHandler(handler, {
    method: "POST",
    url: "/stewardship/cognitive-load",
    body: {
      messages: [{ role: "user", content: "I am overwhelmed and confused." }],
    },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "capability_not_allowed");

  response = await invokeHandler(handler, {
    method: "POST",
    url: "/chat",
    body: {
      assess_cognitive_load: true,
      messages: [{ role: "user", content: "hello" }],
    },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "capability_not_allowed");
});

test("provenance log records chat requests and can be cleared", async () => {
  const handler = makeHandler({ harness: allowedHarness });

  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/chat",
    body: {
      use_session_memory: true,
      write_session_memory: true,
      messages: [{ role: "user", content: "hello" }],
    },
  });
  assert.equal(response.statusCode, 200);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/provenance",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.durable, false);
  assert.equal(response.body.entries.length, 1);
  assert.equal(response.body.entries[0].capability, "model.local.chat");
  assert.equal(response.body.entries[0].memory_read, true);
  assert.equal(response.body.entries[0].memory_written, true);
  assert.equal(response.body.entries[0].allowed, true);

  response = await invokeHandler(handler, {
    method: "DELETE",
    url: "/provenance",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.removed, 1);
});

test("provenance log records chat requests denied by active modules", async () => {
  const handler = makeHandler({ harness: allowedHarness, moduleRegistry });

  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/harness-modules/adopt",
    body: { module_id: "pause-local-chat" },
  });
  assert.equal(response.statusCode, 200);

  response = await invokeHandler(handler, {
    method: "POST",
    url: "/chat",
    body: { messages: [{ role: "user", content: "hello" }] },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "capability_not_allowed");

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/provenance?capability=model.local.chat",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.entries.length, 1);
  assert.equal(response.body.entries[0].capability, "model.local.chat");
  assert.equal(response.body.entries[0].event_type, "model.chat.denied");
  assert.equal(response.body.entries[0].allowed, false);
  assert.equal(response.body.entries[0].denial_reason, "capability_not_allowed");
});

test("provenance log can be filtered and summarized", async () => {
  const handler = makeHandler({ harness: allowedHarness, moduleRegistry });

  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/chat",
    body: {
      use_session_memory: true,
      messages: [{ role: "user", content: "hello" }],
    },
  });
  assert.equal(response.statusCode, 200);

  await invokeHandler(handler, {
    method: "POST",
    url: "/harness-modules/adopt",
    body: { module_id: "pause-local-chat" },
  });

  response = await invokeHandler(handler, {
    method: "POST",
    url: "/chat",
    body: { messages: [{ role: "user", content: "blocked" }] },
  });
  assert.equal(response.statusCode, 403);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/provenance?allowed=false",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.entries.length, 1);
  assert.equal(response.body.entries[0].allowed, false);
  assert.deepEqual(response.body.filters, {
    allowed: false,
    capability: "",
    eventType: "",
    limit: null,
  });

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/provenance?capability=model.local.chat&limit=1",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.entries.length, 1);
  assert.equal(response.body.filters.limit, 1);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/provenance/summary",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.summary.total, 3);
  assert.equal(response.body.summary.allowed, 2);
  assert.equal(response.body.summary.denied, 1);
  assert.equal(response.body.summary.memory_read, 1);
  assert.equal(response.body.summary.cognitive_load_assessed, 0);
  assert.equal(response.body.summary.by_capability["model.local.chat"], 2);
  assert.equal(response.body.summary.by_event_type["model.chat.completed"], 1);
  assert.equal(response.body.summary.by_event_type["model.chat.denied"], 1);
  assert.equal(response.body.summary.by_event_type["harness.module.adopted"], 1);
});

test("provenance summary counts cognitive load assessments requested through chat", async () => {
  const handler = makeHandler({ harness: allowedHarness });

  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/chat",
    body: {
      assess_cognitive_load: true,
      messages: [{ role: "user", content: "I am overwhelmed and confused." }],
    },
  });
  assert.equal(response.statusCode, 200);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/provenance/summary",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.summary.cognitive_load_assessed, 1);
});

test("provenance summary counts standalone cognitive load assessments", async () => {
  const handler = makeHandler({ harness: allowedHarness });

  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/stewardship/cognitive-load",
    body: {
      messages: [{ role: "user", content: "I am overwhelmed and confused." }],
    },
  });
  assert.equal(response.statusCode, 200);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/provenance/summary",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.summary.cognitive_load_assessed, 1);
  assert.equal(response.body.summary.by_event_type["stewardship.cognitive_load.assessed"], 1);
  assert.equal(response.body.summary.by_capability["stewardship.cognitive_load.assess"], 1);
});

test("POST /chat fails closed for unknown runtime profile", async () => {
  const response = await invoke({
    method: "POST",
    url: "/chat",
    harness: allowedHarness,
    body: {
      model_profile: "missing-profile",
      messages: [{ role: "user", content: "hello" }],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "runtime_profile_not_available");
});

test("POST /chat fails closed when remote profile is requested without remote capability", async () => {
  const profiles = {
    schema_version: 1,
    default_profile: "remote-test",
    profiles: [
      {
        id: "remote-test",
        route: "remote",
        endpoint: "https://example.invalid",
        model: "remote-test-model",
        remote_service: true,
      },
    ],
  };
  const response = await invoke({
    method: "POST",
    url: "/chat",
    harness: allowedHarness,
    runtimeProfiles: profiles,
    body: {
      model_profile: "remote-test",
      messages: [{ role: "user", content: "hello" }],
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "capability_not_allowed");
});

async function invoke({
  method,
  url,
  harness = allowedHarness,
  capabilityCatalog: catalog,
  providerRegistry: providers,
  runtimeProfiles: profiles = runtimeProfiles,
  modelClient = {
    model: "test-model",
    withProfile(profile) {
      return {
        model: profile.model,
        chat: this.chat,
      };
    },
    async chat() {
      return { text: "ok", model: "test-model", finish_reason: "stop", tokens_used: 1 };
    },
  },
  grantStore: grants,
  body,
} = {}) {
  return invokeHandler(makeHandler({
    harness,
    capabilityCatalog: catalog,
    providerRegistry: providers,
    runtimeProfiles: profiles,
    modelClient,
    grantStore: grants,
  }), {
    method,
    url,
    body,
  });
}

function makeHandler({
  harness = allowedHarness,
  capabilityCatalog: catalog,
  providerRegistry: providers,
  moduleRegistry: modules = moduleRegistry,
  runtimeProfiles: profiles = runtimeProfiles,
  modelClient = {
    model: "test-model",
    withProfile(profile) {
      return {
        model: profile.model,
        chat: this.chat,
      };
    },
    async chat({ model = "test-model" } = {}) {
      return { text: "ok", model, finish_reason: "stop", tokens_used: 1 };
    },
  },
  grantStore: grants,
} = {}) {
  return createRequestHandler({
    harness,
    capabilityCatalog: catalog,
    providerRegistry: providers,
    moduleRegistry: modules,
    runtimeProfiles: profiles,
    modelClient,
    grantStore: grants,
    logger: { info() {} },
  });
}

async function invokeHandler(handler, { method, url, body }) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.url = url;
  req.headers = { "content-type": "application/json" };

  const chunks = [];
  const res = {
    statusCode: 0,
    headers: {},
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk) {
      if (chunk) {
        chunks.push(Buffer.from(chunk));
      }
    },
  };

  await handler(req, res);

  const raw = Buffer.concat(chunks).toString("utf8");
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    body: raw ? JSON.parse(raw) : null,
  };
}

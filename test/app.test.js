import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { createRequestHandler } from "../src/app.js";
import { CapabilityProposalStore } from "../src/capabilityProposals.js";
import { inspectDesktopBrokerEnvironment } from "../src/desktopBroker.js";
import { DesktopDisclosureRegistry } from "../src/desktopDisclosureRegistry.js";

const traversalEndpointActivationCasesPath = new URL(
  "../docs/fixtures/desktop-traversal-endpoint-activation-cases.json",
  import.meta.url,
);
const grantMutationPreviewReviewCasesPath = new URL(
  "../docs/fixtures/grant-mutation-preview-review-cases.json",
  import.meta.url,
);

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
    {
      key: "perception.sensorium.color.subscribe",
      name: "Sensorium Color Stream Subscription",
      category: "perception",
      risk_class: "high",
      default_status: "disabled",
      allowed_scopes: ["session"],
      data_exposed: [
        "JPEG-encoded color frames from a remote Sensorium publisher",
        "scene contents within the camera's field of view",
      ],
      excluded_by_default: [
        "hidden recording",
        "remote export of frames",
        "audio",
        "raw uncompressed frames",
        "frames outside the subscription window",
      ],
      reversible: false,
      activation_policy: "explicit_grant",
      provider_contract: "soma.perception.sensorium.color.v1",
    },
    {
      key: "perception.remote_desktop.video.subscribe",
      name: "Remote Desktop Video Subscription",
      category: "perception",
      risk_class: "high",
      default_status: "disabled",
      allowed_scopes: ["once", "session"],
      data_exposed: ["encoded remote graphical session frames", "remote host identity"],
      excluded_by_default: ["keyboard input", "pointer input", "hidden recording"],
      reversible: false,
      activation_policy: "explicit_grant",
      provider_contract: "soma.perception.remote_desktop.video.v1",
    },
    {
      key: "desktop.remote.input.pointer",
      name: "Remote Desktop Pointer Input",
      category: "desktop",
      risk_class: "high",
      default_status: "disabled",
      allowed_scopes: ["once", "session"],
      data_exposed: ["target remote graphical session identity", "pointer movement or click intent"],
      excluded_by_default: ["remote desktop video access", "keyboard input", "hidden input injection"],
      reversible: false,
      activation_policy: "explicit_grant",
      provider_contract: "soma.desktop.remote.input.pointer.v1",
    },
    {
      key: "desktop.remote.input.keyboard",
      name: "Remote Desktop Keyboard Input",
      category: "desktop",
      risk_class: "high",
      default_status: "disabled",
      allowed_scopes: ["once", "session"],
      data_exposed: ["target remote graphical session identity", "keyboard input intent"],
      excluded_by_default: ["remote desktop video access", "pointer input", "hidden input injection"],
      reversible: false,
      activation_policy: "explicit_grant",
      provider_contract: "soma.desktop.remote.input.keyboard.v1",
    },
    {
      key: "desktop.remote.session.disconnect",
      name: "Remote Desktop Session Disconnect",
      category: "desktop",
      risk_class: "sensitive",
      default_status: "disabled",
      allowed_scopes: ["once", "session"],
      data_exposed: ["target remote graphical session identity", "disconnect intent"],
      excluded_by_default: ["remote desktop video access", "pointer input", "keyboard input"],
      reversible: false,
      activation_policy: "explicit_grant",
      provider_contract: "soma.desktop.remote.session.disconnect.v1",
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
    {
      id: "soma.provider.sensorium.jetsorano",
      name: "Sensorium Node (jetsorano)",
      runtime: "test",
      local_only: false,
      network_access: true,
      host_segment: "jetsorano",
      capabilities: [
        "perception.sensorium.color.subscribe",
        "perception.sensorium.depth.subscribe",
        "perception.sensorium.imu.subscribe",
        "perception.sensorium.location.subscribe",
        "perception.sensorium.status.subscribe",
      ],
    },
    {
      id: "soma.provider.remote_desktop.sunshine",
      name: "Remote Desktop Sunshine/Moonlight Transport",
      runtime: "test",
      local_only: false,
      network_access: true,
      capabilities: [
        "perception.remote_desktop.video.subscribe",
        "desktop.remote.input.pointer",
        "desktop.remote.input.keyboard",
        "desktop.remote.session.disconnect",
      ],
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
  assert.equal(response.body.status, "ok");
  assert.equal(response.body.runtime_writes_enabled, false);
  assert.equal(response.body.runtime_write_posture.status, "disabled");
  assert.equal(response.body.runtime_write_posture.requested, false);
  assert.equal(response.body.runtime_write_posture.activation_supported, false);
});

test("GET /health reports requested runtime writes as disabled posture", async () => {
  const response = await invoke({
    method: "GET",
    url: "/health",
    runtimeWritePosture: {
      requested: true,
      source: "test",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.runtime_writes_enabled, false);
  assert.equal(response.body.runtime_write_posture.status, "requested_but_disabled");
  assert.equal(response.body.runtime_write_posture.requested, true);
  assert.equal(response.body.runtime_write_posture.source, "test");
  assert.equal(response.body.runtime_write_posture.durable_grant_mutation_enabled, false);
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
  assert.equal(response.body.summary.total, 8);
  assert.equal(response.body.summary.by_status.active, 1);
  assert.equal(response.body.summary.by_status.requestable, 6);
  assert.equal(response.body.summary.by_status.unsupported, 1);
  assert.equal(response.body.grouped.desktop.total, 5);
  assert.equal(response.body.grouped.perception.total, 2);
  const focus = response.body.capabilities.find((capability) => capability.key === "desktop.inspect.focus");
  const text = response.body.capabilities.find((capability) => capability.key === "desktop.inspect.text");
  const sensoriumColor = response.body.capabilities.find((capability) => capability.key === "perception.sensorium.color.subscribe");
  const remoteVideo = response.body.capabilities.find((capability) => capability.key === "perception.remote_desktop.video.subscribe");
  const remoteKeyboard = response.body.capabilities.find((capability) => capability.key === "desktop.remote.input.keyboard");
  assert.equal(focus.status, "requestable");
  assert.equal(focus.providers[0].id, "desktop-broker");
  assert.equal(text.status, "unsupported");
  assert.equal(sensoriumColor.status, "requestable");
  assert.equal(remoteVideo.status, "requestable");
  assert.equal(remoteKeyboard.status, "requestable");
});

test("POST /model-visual/review-text formats proposal review without activation", async () => {
  const response = await invoke({
    method: "POST",
    url: "/model-visual/review-text",
    body: {
      kind: "proposal",
      review_response: modelVisualProposalReviewFixture(),
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.kind, "proposal");
  assert.equal(response.body.review_only, true);
  assert.equal(response.body.activation_performed, false);
  assert.equal(response.body.grant_written, false);
  assert.equal(response.body.subscription_activated, false);
  assert.equal(response.body.model_delivery_performed, false);
  assert.equal(response.body.payload_attached, false);
  assert.equal(response.body.payload_bytes_included, false);
  assert.match(response.body.text, /Model visual attach proposal/);
  assert.match(response.body.text, /preview acknowledgement: artifact=preview-color-1/);
});

test("POST /model-visual/review-text rejects payload-shaped fields before formatting", async () => {
  const fixture = modelVisualProposalReviewFixture();
  fixture.review.preview.image_bytes = "base64-not-allowed";

  const response = await invoke({
    method: "POST",
    url: "/model-visual/review-text",
    body: {
      kind: "proposal",
      review_response: fixture,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "model_visual_attach_review_payload_field");
  assert.ok(response.body.validation_errors.some((entry) => entry.includes("response.review.preview.image_bytes")));
});

test("POST /model-visual/attach-requests/dry-run validates active visual grant without delivery", async () => {
  const response = await invoke({
    method: "POST",
    url: "/model-visual/attach-requests/dry-run",
    grantStore: {
      schema_version: 1,
      grants: [modelVisualGrantFixture()],
    },
    body: modelVisualAttachRequestFixture(),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.dry_run, true);
  assert.equal(response.body.accepted, true);
  assert.equal(response.body.request.grant_id, "grant-visual-color");
  assert.equal(response.body.request.preview_acknowledgement_id, "ack-preview-color-1");
  assert.equal(response.body.future_provenance_appended, false);
  assert.equal(response.body.future_provenance_preview.event_type, "model.context.visual.attached");
  assert.equal(response.body.future_provenance_preview.grant_id, "grant-visual-color");
  assert.equal(response.body.future_provenance_preview.preview_acknowledgement_id, "ack-preview-color-1");
  assert.equal(response.body.future_provenance_preview.payload_bytes_included, false);
  assert.equal(response.body.future_provenance_preview.visual_memory_written, false);
  assert.equal(response.body.activation_performed, false);
  assert.equal(response.body.grant_written, false);
  assert.equal(response.body.subscription_activated, false);
  assert.equal(response.body.model_delivery_performed, false);
  assert.equal(response.body.payload_attached, false);
  assert.equal(response.body.payload_bytes_included, false);
});

test("POST /model-visual/attach-requests/dry-run rejects missing grant and payload fields", async () => {
  const response = await invoke({
    method: "POST",
    url: "/model-visual/attach-requests/dry-run",
    grantStore: {
      schema_version: 1,
      grants: [],
    },
    body: {
      ...modelVisualAttachRequestFixture(),
      image_bytes: "base64-not-allowed",
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "invalid_model_visual_attach_request");
  assert.ok(response.body.validation_errors.some((entry) => entry.includes("an active model visual attach grant is required")));
  assert.ok(response.body.validation_errors.some((entry) => entry.includes("request.image_bytes is forbidden")));
});

test("POST /model-visual/attach-requests/dry-run fails closed on degraded visual grant recovery", async () => {
  const response = await invoke({
    method: "POST",
    url: "/model-visual/attach-requests/dry-run",
    grantStore: {
      schema_version: 1,
      grants: [modelVisualGrantFixture()],
    },
    grantRecoveryReport: {
      ok: false,
      degraded: true,
      findings: [
        {
          code: "missing_grant_created_provenance",
          grant_id: "grant-visual-color",
          capability: "model.context.visual.color.attach",
          provider: "soma.provider.local-model",
          scope: "once",
          authorizing_safe: false,
        },
      ],
    },
    body: modelVisualAttachRequestFixture(),
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "model_visual_attach_grant_recovery_required");
  assert.equal(response.body.findings[0].code, "missing_grant_created_provenance");
});

test("POST /model-visual/attach-requests/dry-run fails closed on unsupported grant-store schema", async () => {
  const response = await invoke({
    method: "POST",
    url: "/model-visual/attach-requests/dry-run",
    grantStore: {
      schema_version: 2,
      grants: [modelVisualGrantFixture()],
    },
    body: modelVisualAttachRequestFixture(),
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "model_visual_attach_grant_store_schema_unsupported");
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
  assert.equal(response.body.runtime_write_posture.status, "disabled");
  assert.equal(response.body.runtime_write_posture.activation_supported, false);
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

test("GET /grants/recovery reports absent inspection without declaring authority clean", async () => {
  const response = await invoke({
    method: "GET",
    url: "/grants/recovery",
    harness: allowedHarness,
    grantStore,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.recovery_inspection_available, false);
  assert.equal(response.body.ok, null);
  assert.equal(response.body.degraded, false);
  assert.equal(response.body.grant_count, 2);
  assert.equal(response.body.finding_count, 0);
  assert.deepEqual(response.body.findings, []);
  assert.equal(response.body.durable, false);
  assert.equal(response.body.activation_performed, false);
  assert.equal(response.body.runtime_writes_enabled, false);
  assert.equal(response.body.runtime_write_posture.status, "disabled");
});

test("GET /grants/recovery exposes bounded degraded findings", async () => {
  const response = await invoke({
    method: "GET",
    url: "/grants/recovery",
    harness: allowedHarness,
    grantStore,
    grantRecoveryReport: {
      ok: false,
      degraded: true,
      grant_count: 2,
      finding_count: 1,
      findings: [
        {
          code: "grant_provenance_metadata_mismatch",
          grant_id: "grant-1",
          status: "active",
          capability: "desktop.inspect.focus",
          provider: "soma.provider.desktop.local",
          scope: "session",
          authorizing_safe: false,
          event_type: "grant.created",
          field: "reason",
          grant_value: "operator-facing sensitive reason",
          event_value: "mismatched sensitive reason",
        },
      ],
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.recovery_inspection_available, true);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.degraded, true);
  assert.equal(response.body.finding_count, 1);
  assert.deepEqual(response.body.findings[0], {
    code: "grant_provenance_metadata_mismatch",
    grant_id: "grant-1",
    status: "active",
    capability: "desktop.inspect.focus",
    provider: "soma.provider.desktop.local",
    scope: "session",
    authorizing_safe: false,
    event_type: "grant.created",
    field: "reason",
  });
});

test("POST /grants returns explicit durable mutation disabled refusal without writing", async () => {
  const response = await invoke({
    method: "POST",
    url: "/grants",
    harness: allowedHarness,
    grantStore,
    runtimeWritePosture: {
      requested: true,
      source: "test",
    },
    body: {
      capability: "desktop.inspect.focus",
      provider: "desktop-broker",
      scope: "session",
      reason: "Attempt durable creation.",
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error, "durable_grant_mutation_not_enabled");
  assert.equal(response.body.route, "POST /grants");
  assert.equal(response.body.mutation_kind, "grant.created");
  assert.equal(response.body.runtime_writes_enabled, false);
  assert.equal(response.body.runtime_write_posture.status, "requested_but_disabled");
  assert.equal(response.body.activation_policy, "docs/concepts/drafts/durable_grant_mutation_activation_policy.md");
  assert.equal(response.body.durable, false);
  assert.equal(response.body.grant_written, false);
  assert.equal(response.body.provenance_appended, false);
  assert.equal(response.body.activation_performed, false);
  assert.equal(response.body.subscription_activated, false);
  assert.equal(response.body.model_delivery_performed, false);
  assert.equal(response.body.repair_performed, false);
  assert.equal(grantStore.grants.length, 2);
});

test("POST /grants/:id/revoke returns explicit durable mutation disabled refusal without writing", async () => {
  const response = await invoke({
    method: "POST",
    url: "/grants/grant-1/revoke",
    harness: allowedHarness,
    grantStore,
    body: {
      actor: "user",
      reason: "Attempt durable revocation.",
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error, "durable_grant_mutation_not_enabled");
  assert.equal(response.body.route, "POST /grants/:id/revoke");
  assert.equal(response.body.mutation_kind, "grant.revoked");
  assert.equal(response.body.grant_id, "grant-1");
  assert.equal(response.body.runtime_writes_enabled, false);
  assert.equal(response.body.runtime_write_posture.status, "disabled");
  assert.equal(response.body.durable, false);
  assert.equal(response.body.grant_written, false);
  assert.equal(response.body.provenance_appended, false);
  assert.equal(response.body.activation_performed, false);
  assert.equal(grantStore.grants.find((grant) => grant.id === "grant-1").status, "active");
});

test("POST /grants/mutation-previews previews creation without writes or activation", async () => {
  const response = await invoke({
    method: "POST",
    url: "/grants/mutation-previews",
    harness: allowedHarness,
    grantStore: { schema_version: 1, grants: [], examples: [] },
    grantRecoveryReport: { ok: true, degraded: false, grant_count: 0, finding_count: 0, findings: [] },
    body: {
      kind: "grant.created",
      mutation_id: "mutation-preview-create",
      input: {
        capability: "desktop.inspect.focus",
        provider: "desktop-broker",
        scope: "session",
        constraints: { include_text: false },
        approved_by: "user",
        direct_user_action: true,
        reason: "Preview a focused desktop inspection grant.",
      },
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.dry_run, true);
  assert.equal(response.body.mutation_kind, "grant.created");
  assert.equal(response.body.event.event_type, "grant.created");
  assert.equal(response.body.receipt_preview.status, "preview");
  assert.equal(response.body.receipt_preview.grant_store_committed, false);
  assert.equal(response.body.receipt_preview.provenance_appended, false);
  assert.equal(response.body.durable, false);
  assert.equal(response.body.grant_written, false);
  assert.equal(response.body.activation_performed, false);
});

test("POST /grants/mutation-previews rejects degraded recovery before preview", async () => {
  const response = await invoke({
    method: "POST",
    url: "/grants/mutation-previews",
    harness: allowedHarness,
    grantStore,
    grantRecoveryReport: {
      ok: false,
      degraded: true,
      grant_count: 2,
      finding_count: 1,
      findings: [
        {
          code: "missing_grant_created_provenance",
          grant_id: "grant-1",
          status: "active",
          capability: "desktop.inspect.focus",
          provider: "soma.provider.desktop.local",
          scope: "session",
          authorizing_safe: false,
        },
      ],
    },
    body: {
      kind: "grant.revoked",
      mutation_id: "mutation-preview-revoke",
      input: {
        id: "grant-1",
        actor: "user",
        reason: "Preview revocation.",
      },
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.dry_run, true);
  assert.equal(response.body.error, "grant_mutation_preview_recovery_required");
  assert.equal(response.body.findings[0].code, "missing_grant_created_provenance");
  assert.equal(response.body.durable, false);
  assert.equal(response.body.grant_written, false);
  assert.equal(response.body.provenance_appended, false);
  assert.equal(response.body.activation_performed, false);
  assert.equal(response.body.subscription_activated, false);
  assert.equal(response.body.model_delivery_performed, false);
});

test("POST /grants/mutation-previews rejects unsupported kinds without writes", async () => {
  const response = await invoke({
    method: "POST",
    url: "/grants/mutation-previews",
    harness: allowedHarness,
    grantStore,
    grantRecoveryReport: { ok: true, degraded: false, grant_count: 2, finding_count: 0, findings: [] },
    body: {
      kind: "grant.superseded",
      mutation_id: "mutation-preview-unsupported",
      input: {},
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.dry_run, true);
  assert.equal(response.body.code, "grant_mutation_preview_unsupported_kind");
  assert.equal(response.body.mutation_kind, "grant.superseded");
  assert.equal(response.body.receipt_preview.status, "failed");
  assert.equal(response.body.receipt_preview.grant_store_committed, false);
  assert.equal(response.body.receipt_preview.provenance_appended, false);
  assert.equal(response.body.durable, false);
  assert.equal(response.body.grant_written, false);
  assert.equal(response.body.provenance_appended, false);
  assert.equal(response.body.activation_performed, false);
  assert.equal(response.body.subscription_activated, false);
  assert.equal(response.body.model_delivery_performed, false);
});

test("POST /grants/mutation-previews rejects malformed create inputs without writes", async () => {
  const response = await invoke({
    method: "POST",
    url: "/grants/mutation-previews",
    harness: allowedHarness,
    grantStore: { schema_version: 1, grants: [], examples: [] },
    grantRecoveryReport: { ok: true, degraded: false, grant_count: 0, finding_count: 0, findings: [] },
    body: {
      kind: "grant.created",
      mutation_id: "mutation-preview-invalid",
      input: {
        capability: "desktop.inspect.focus",
        provider: "desktop-broker",
        scope: "session",
        constraints: [],
        approved_by: "user",
        direct_user_action: true,
        reason: "Preview a focused desktop inspection grant.",
      },
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.dry_run, true);
  assert.equal(response.body.code, "invalid_constraints");
  assert.equal(response.body.mutation_kind, "grant.created");
  assert.equal(response.body.receipt_preview.status, "failed");
  assert.equal(response.body.receipt_preview.grant_store_committed, false);
  assert.equal(response.body.receipt_preview.provenance_appended, false);
  assert.equal(response.body.durable, false);
  assert.equal(response.body.grant_written, false);
  assert.equal(response.body.provenance_appended, false);
  assert.equal(response.body.activation_performed, false);
  assert.equal(response.body.subscription_activated, false);
  assert.equal(response.body.model_delivery_performed, false);
});

test("POST /grants/mutation-preview-review-text formats an existing preview without writes", async () => {
  const fixture = JSON.parse(await readFile(grantMutationPreviewReviewCasesPath, "utf8"));
  const response = await invoke({
    method: "POST",
    url: "/grants/mutation-preview-review-text",
    body: {
      review_response: fixture.accepted_case.preview,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.review_only, true);
  assert.equal(response.body.dry_run, true);
  assert.equal(response.body.durable, false);
  assert.equal(response.body.grant_written, false);
  assert.equal(response.body.provenance_appended, false);
  assert.equal(response.body.activation_performed, false);
  assert.equal(response.body.subscription_activated, false);
  assert.equal(response.body.model_delivery_performed, false);
  assert.match(response.body.text, /Grant mutation preview/);
  assert.match(response.body.text, /mutation: grant\.created/);
  assert.match(response.body.text, /durable write: no/);
  for (const value of fixture.accepted_case.must_not_render) {
    assert.doesNotMatch(response.body.text, new RegExp(value));
  }
});

test("POST /grants/mutation-preview-review-text rejects forbidden preview review fields", async () => {
  const fixture = JSON.parse(await readFile(grantMutationPreviewReviewCasesPath, "utf8"));
  const rejectedCase = fixture.rejected_cases.find((entry) => entry.forbidden_key === "event_value");
  const response = await invoke({
    method: "POST",
    url: "/grants/mutation-preview-review-text",
    body: {
      review_response: rejectedCase.preview,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "grant_mutation_preview_review_forbidden_field");
  assert.ok(response.body.validation_errors.includes(rejectedCase.expected_path));
});

test("POST /grants/mutation-preview-review-text rejects missing preview objects", async () => {
  const response = await invoke({
    method: "POST",
    url: "/grants/mutation-preview-review-text",
    body: {
      review_response: null,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "grant_mutation_preview_review_request_invalid");
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

test("generic capability proposals reject caller-supplied review metadata", async () => {
  const response = await invoke({
    method: "POST",
    url: "/capability-proposals",
    harness: allowedHarness,
    body: {
      requested_by: "assistant",
      capability: "desktop.inspect.focus",
      reason: "Need focused object role.",
      requested_scope: "session",
      data_exposed: ["focused object role"],
      risk: "May reveal active application context.",
      fallback: "Continue without focus.",
      review_context: {
        hidden: "generic callers should not be able to attach arbitrary review metadata",
      },
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

test("desktop broker passes limit hints to rust helper while keeping response narrowing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "soma-desktop-limit-args-"));
  const helperPath = path.join(root, "soma-desktop-broker");
  const argsPath = path.join(root, "args.txt");
  await writeFile(helperPath, `#!/usr/bin/env sh
printf '%s\\n' "$@" > "${argsPath}"
printf '%s\\n' '{"mode":"read_only_atspi_probe","broker_source":"rust_helper","platform":"linux","release":"test","desktop_session":"GNOME","session_type":"wayland","dbus_session_bus_available":true,"atspi_likely_available":true,"atspi_bus_address_available":true,"application_count":2,"root_object_available_count":2,"window_count":0,"tree":{"applications":[{"service":":1.42","pid":123,"process":"test-app","registry":false,"root_object":{"path":"/org/a11y/atspi/accessible/root","name":"test-app","role":"application","child_count":2,"children_sample":[{"service":":1.42","path":"/child-a"},{"service":":1.42","path":"/child-b"}],"child_metadata_sample":[{"service":":1.42","path":"/child-a","role":"frame","child_count":0},{"service":":1.42","path":"/child-b","role":"frame","child_count":0}]},"root_object_error":null},{"service":":1.43","pid":124,"process":"other-app","registry":false,"root_object":{"path":"/org/a11y/atspi/accessible/root","name":"other-app","role":"application","child_count":0,"children_sample":[],"child_metadata_sample":[]},"root_object_error":null}],"windows":[],"bounded":true,"text_content_included":false},"tree_available":true}'
`, "utf8");
  await chmod(helperPath, 0o755);

  const inspection = await inspectDesktopBrokerEnvironment({
    helperPath,
    mode: "atspi",
    maxApps: 1,
    maxChildren: 5,
  });
  const args = (await readFile(argsPath, "utf8")).trim().split("\n");

  assert.deepEqual(args, [
    "inspect-atspi",
    "--max-applications",
    "1",
    "--max-root-child-refs",
    "5",
    "--max-root-child-metadata",
    "4",
  ]);
  assert.equal(inspection.application_count, 1);
  assert.equal(inspection.root_object_available_count, 1);
  assert.equal(inspection.tree.applications.length, 1);
  assert.equal(inspection.tree.applications[0].root_object.children_sample.length, 2);
  assert.equal(inspection.tree.applications[0].root_object.child_metadata_sample.length, 2);
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
    const desktopDisclosureRegistry = createDesktopDisclosureRegistrySpy();
    const handler = makeHandler({ harness: allowedHarness, desktopDisclosureRegistry });
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
    assert.equal(desktopDisclosureRegistry.accessibilityTreeCalls.length, 0);

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

test("desktop inspection endpoint rejects traversal-shaped helper output before provenance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "soma-desktop-traversal-helper-output-"));
  const helperPath = path.join(root, "soma-desktop-broker");
  await writeFile(helperPath, `#!/usr/bin/env sh
printf '%s\\n' '{"mode":"read_only_atspi_probe","broker_source":"rust_helper","platform":"linux","release":"test","desktop_session":"GNOME","session_type":"wayland","dbus_session_bus_available":true,"atspi_likely_available":true,"atspi_bus_address_available":true,"application_count":1,"root_object_available_count":1,"window_count":0,"tree":{"applications":[{"service":":1.42","pid":123,"process":"test-app","registry":false,"root_object":{"path":"/org/a11y/atspi/accessible/root","name":"test-app","role":"application","child_count":1,"children_sample":[],"child_metadata_sample":[],"traversal":{"root":{"service":":1.42","path":"/org/a11y/atspi/accessible/root"},"nodes":[{"id":"n0","service":":1.42","path":"/org/a11y/atspi/accessible/root","role":"application","child_count":1,"depth":0,"children":[]}],"limits":{"max_depth":1,"max_nodes":64,"max_children_per_node":8},"truncated":false,"text_content_included":false,"withheld_fields":["name","description","text","states","actions"]}},"root_object_error":null}],"windows":[],"bounded":true,"text_content_included":false},"tree_available":true}'
`, "utf8");
  await chmod(helperPath, 0o755);
  const previousBroker = process.env.SOMA_DESKTOP_BROKER;
  process.env.SOMA_DESKTOP_BROKER = helperPath;
  try {
    const desktopDisclosureRegistry = createDesktopDisclosureRegistrySpy();
    const handler = makeHandler({ harness: allowedHarness, desktopDisclosureRegistry });
    const response = await invokeHandler(handler, {
      method: "POST",
      url: "/desktop/inspect/accessibility-tree",
      body: { mode: "atspi" },
    });

    assert.equal(response.statusCode, 502);
    assert.equal(response.body.error, "desktop_inspection_schema_invalid");
    assert.ok(response.body.validation_errors.includes(
      "result.tree.applications[0].root_object.traversal is not allowed",
    ));
    assert.equal("inspection" in response.body, false);
    assert.equal(desktopDisclosureRegistry.accessibilityTreeCalls.length, 0);

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

test("desktop accessibility inspection rejects invalid traversal request shapes", async () => {
  for (const [name, scenario] of Object.entries({
    disclosed_root_ref: {
      expectedStatus: 403,
      expectedError: "desktop_traversal_root_not_disclosed",
      expectedAuthorizationCalls: 1,
      body: {
        mode: "atspi",
        traversal: {
          enabled: true,
          root_ref: "desktop-ref-1",
          max_depth: 1,
          max_nodes: 16,
          max_children_per_node: 4,
        },
      },
    },
    bounded_atspi_traversal: {
      expectedStatus: 400,
      expectedError: "desktop_traversal_request_invalid",
      expectedAuthorizationCalls: 0,
      body: {
        mode: "atspi",
        traversal: {
          enabled: true,
          root: { service: ":1.42", path: "/org/a11y/atspi/accessible/root" },
          max_depth: 1,
          max_nodes: 16,
          max_children_per_node: 4,
        },
      },
    },
    non_atspi_mode: {
      expectedStatus: 400,
      expectedError: "desktop_traversal_request_invalid",
      expectedAuthorizationCalls: 0,
      body: {
        mode: "environment",
        traversal: {
          enabled: true,
          root: { service: ":1.42", path: "/org/a11y/atspi/accessible/root" },
          max_depth: 1,
          max_nodes: 16,
          max_children_per_node: 4,
        },
      },
    },
    unknown_traversal_field: {
      expectedStatus: 400,
      expectedError: "desktop_traversal_request_invalid",
      expectedAuthorizationCalls: 0,
      body: {
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
    },
    unknown_top_level_field: {
      expectedStatus: 400,
      expectedError: "desktop_traversal_request_invalid",
      expectedAuthorizationCalls: 0,
      body: {
        mode: "atspi",
        include_text: true,
        traversal: {
          enabled: true,
          root_ref: "desktop-ref-1",
          max_depth: 1,
          max_nodes: 16,
          max_children_per_node: 4,
        },
      },
    },
    invalid_root_shape: {
      expectedStatus: 400,
      expectedError: "desktop_traversal_request_invalid",
      expectedAuthorizationCalls: 0,
      body: {
        mode: "atspi",
        traversal: {
          enabled: true,
          root: { service: ":1.42" },
          max_depth: 1,
          max_nodes: 16,
          max_children_per_node: 4,
        },
      },
    },
    excessive_limits: {
      expectedStatus: 400,
      expectedError: "desktop_traversal_request_invalid",
      expectedAuthorizationCalls: 0,
      body: {
        mode: "atspi",
        traversal: {
          enabled: true,
          root: { service: ":1.42", path: "/org/a11y/atspi/accessible/root" },
          max_depth: 99,
          max_nodes: 10000,
          max_children_per_node: 1000,
        },
      },
    },
  })) {
    const desktopDisclosureRegistry = createDesktopDisclosureRegistrySpy();
    const handler = makeHandler({ harness: allowedHarness, desktopDisclosureRegistry });
    const response = await invokeHandler(handler, {
      method: "POST",
      url: "/desktop/inspect/accessibility-tree",
      body: scenario.body,
    });

    assert.equal(response.statusCode, scenario.expectedStatus, name);
    assert.equal(response.body.error, scenario.expectedError, name);
    assert.equal(desktopDisclosureRegistry.authorizeRootRefCalls.length, scenario.expectedAuthorizationCalls, name);
    assert.equal(desktopDisclosureRegistry.accessibilityTreeCalls.length, 0, name);
    assert.equal(desktopDisclosureRegistry.focusedInspectionCalls.length, 0, name);

    const provenance = await invokeHandler(handler, {
      method: "GET",
      url: "/provenance?event_type=desktop.inspect.accessibility_tree",
    });
    assert.equal(provenance.statusCode, 200, name);
    assert.equal(provenance.body.entries.length, 0, name);
  }
});

test("desktop traversal endpoint activation cases exercise active endpoint paths", async () => {
  const fixture = JSON.parse(await readFile(traversalEndpointActivationCasesPath, "utf8"));

  for (const scenario of fixture.cases) {
    const root = await mkdtemp(path.join(os.tmpdir(), `soma-desktop-traversal-${scenario.name}-`));
    const helperPath = path.join(root, "soma-desktop-broker");
    const commandsPath = path.join(root, "helper-commands.txt");
    await writeFile(
      helperPath,
      desktopTraversalActivationHelperScript({
        commandsPath,
        baseInspection: traversalBaseInspection(),
        traversal: traversalOutputForActivationScenario(scenario),
      }),
      "utf8",
    );
    await chmod(helperPath, 0o755);
    const previousBroker = process.env.SOMA_DESKTOP_BROKER;
    process.env.SOMA_DESKTOP_BROKER = helperPath;
    const desktopDisclosureRegistry = createTraversalActivationRegistrySpy(scenario);
    const handler = makeHandler({ harness: allowedHarness, desktopDisclosureRegistry });

    try {
      const response = await invokeHandler(handler, {
        method: "POST",
        url: "/desktop/inspect/accessibility-tree",
        body: scenario.body,
      });
      const helperCommands = await readHelperCommands(commandsPath);
      const traversalHelperCommands = helperCommands.filter((command) => command === "inspect-atspi-traversal");

      if (scenario.expected_path === "success") {
        assert.equal(response.statusCode, 200, scenario.name);
        assert.deepEqual(
          response.body.inspection.tree.applications[0].root_object.traversal,
          successfulEndpointTraversalOutput(),
          scenario.name,
        );
        assert.equal(desktopDisclosureRegistry.authorizeRootRefCalls.length, 1, scenario.name);
        assert.deepEqual(helperCommands, ["inspect-atspi", "inspect-atspi-traversal"], scenario.name);
        assert.equal(traversalHelperCommands.length, 1, scenario.name);
      } else if (scenario.expected_path === "unavailable") {
        assert.equal(response.statusCode, 200, scenario.name);
        assert.deepEqual(
          response.body.inspection.tree.applications[0].root_object.traversal,
          unavailableEndpointTraversalOutput(),
          scenario.name,
        );
        assert.equal(desktopDisclosureRegistry.authorizeRootRefCalls.length, 1, scenario.name);
        assert.deepEqual(helperCommands, ["inspect-atspi", "inspect-atspi-traversal"], scenario.name);
        assert.equal(traversalHelperCommands.length, 1, scenario.name);
      } else {
        const expectedStatus = scenario.expected_path === "helper_output_failure"
          ? 502
          : scenario.expected_path === "request_validation_failure"
            ? 400
            : 403;
        const expectedTraversalCommands = scenario.expected_path === "helper_output_failure" ? 1 : 0;
        assert.equal(response.statusCode, expectedStatus, scenario.name);
        assert.equal(response.body.error, scenario.expected_error, scenario.name);
        assert.equal("inspection" in response.body, false, scenario.name);
        assert.deepEqual(
          helperCommands,
          scenario.expected_path === "helper_output_failure"
            ? ["inspect-atspi", "inspect-atspi-traversal"]
            : [],
          scenario.name,
        );
        assert.equal(traversalHelperCommands.length, expectedTraversalCommands, scenario.name);
        if (scenario.expected_path === "request_validation_failure") {
          assert.equal(desktopDisclosureRegistry.authorizeRootRefCalls.length, 0, scenario.name);
        } else {
          assert.equal(desktopDisclosureRegistry.authorizeRootRefCalls.length, 1, scenario.name);
        }
      }

      assert.equal(desktopDisclosureRegistry.accessibilityTreeCalls.length, 0, scenario.name);
      assert.equal(desktopDisclosureRegistry.focusedInspectionCalls.length, 0, scenario.name);

      const provenance = await invokeHandler(handler, {
        method: "GET",
        url: "/provenance?event_type=desktop.inspect.accessibility_tree",
      });
      assert.equal(provenance.statusCode, 200, scenario.name);
      if (["success", "unavailable"].includes(scenario.expected_path)) {
        assert.equal(provenance.body.entries.length, 1, scenario.name);
        assert.equal(provenance.body.entries[0].id, response.body.provenance_id, scenario.name);
        assert.equal(provenance.body.entries[0].traversal_requested, true, scenario.name);
        assert.equal(provenance.body.entries[0].traversal_root_source_event_id, "prov-tree", scenario.name);
        assert.equal(JSON.stringify(provenance.body.entries[0]).includes(":1.42"), false, scenario.name);
        assert.equal(
          JSON.stringify(provenance.body.entries[0]).includes("/org/a11y/atspi/accessible/root"),
          false,
          scenario.name,
        );
      } else {
        assert.equal(provenance.body.entries.length, 0, scenario.name);
      }
    } finally {
      if (previousBroker === undefined) {
        delete process.env.SOMA_DESKTOP_BROKER;
      } else {
        process.env.SOMA_DESKTOP_BROKER = previousBroker;
      }
    }
  }
});

test("desktop traversal authorization failure happens before traversal helper invocation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "soma-desktop-traversal-no-helper-"));
  const helperPath = path.join(root, "soma-desktop-broker");
  const commandsPath = path.join(root, "helper-commands.txt");
  await writeFile(
    helperPath,
    desktopTraversalActivationHelperScript({
      commandsPath,
      baseInspection: traversalBaseInspection(),
      traversal: successfulEndpointTraversalOutput(),
    }),
    "utf8",
  );
  await chmod(helperPath, 0o755);
  const previousBroker = process.env.SOMA_DESKTOP_BROKER;
  process.env.SOMA_DESKTOP_BROKER = helperPath;
  try {
    const desktopDisclosureRegistry = createDesktopDisclosureRegistrySpy();
    const handler = makeHandler({ harness: allowedHarness, desktopDisclosureRegistry });
    const response = await invokeHandler(handler, {
      method: "POST",
      url: "/desktop/inspect/accessibility-tree",
      body: {
        mode: "atspi",
        traversal: {
          enabled: true,
          root_ref: "desktop-ref-1",
          max_depth: 1,
          max_nodes: 16,
          max_children_per_node: 4,
        },
      },
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error, "desktop_traversal_root_not_disclosed");
    assert.deepEqual(await readHelperCommands(commandsPath), []);
    assert.equal(desktopDisclosureRegistry.authorizeRootRefCalls.length, 1);
    assert.equal(desktopDisclosureRegistry.accessibilityTreeCalls.length, 0);
    assert.equal(desktopDisclosureRegistry.focusedInspectionCalls.length, 0);

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
    const desktopDisclosureRegistry = createDesktopDisclosureRegistrySpy();
    const handler = makeHandler({ harness: allowedHarness, desktopDisclosureRegistry });

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
    assert.equal("desktop_ref_id" in response.body.inspection.tree.applications[0], false);
    assert.equal(desktopDisclosureRegistry.accessibilityTreeCalls.length, 1);
    assert.equal(desktopDisclosureRegistry.accessibilityTreeCalls[0].provenanceId, provenanceId);
    assert.equal(desktopDisclosureRegistry.accessibilityTreeCalls[0].capability, "desktop.inspect.accessibility_tree");
    assert.equal(desktopDisclosureRegistry.accessibilityTreeCalls[0].inspection.mode, "read_only_atspi_probe");

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
    assert.equal("traversal_requested" in response.body.entries[0], false);
    assert.equal("traversal" in response.body.entries[0], false);
    assert.equal("traversal_tree" in response.body.entries[0], false);
    assert.equal("traversal_nodes" in response.body.entries[0], false);
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

test("desktop disclosure registry revokes refs when desktop inspection is narrowed by module", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "soma-desktop-registry-revoke-"));
  const helperPath = path.join(root, "soma-desktop-broker");
  await writeFile(helperPath, `#!/usr/bin/env sh
printf '%s\\n' '{"mode":"read_only_atspi_probe","broker_source":"rust_helper","platform":"linux","release":"test","desktop_session":"GNOME","session_type":"wayland","dbus_session_bus_available":true,"atspi_likely_available":true,"atspi_bus_address_available":true,"application_count":1,"root_object_available_count":1,"window_count":0,"tree":{"applications":[{"service":":1.42","pid":123,"process":"test-app","registry":false,"root_object":{"path":"/org/a11y/atspi/accessible/root","name":"test-app","role":"application","child_count":1,"children_sample":[{"service":":1.42","path":"/child"}],"child_metadata_sample":[{"service":":1.42","path":"/child","role":"frame","child_count":0}]},"root_object_error":null}],"windows":[],"bounded":true,"text_content_included":false},"tree_available":true}'
`, "utf8");
  await chmod(helperPath, 0o755);
  const previousBroker = process.env.SOMA_DESKTOP_BROKER;
  process.env.SOMA_DESKTOP_BROKER = helperPath;
  try {
    const desktopDisclosureRegistry = new DesktopDisclosureRegistry({
      idFactory: (() => {
        let nextId = 0;
        return () => `desktop-ref-${++nextId}`;
      })(),
    });
    const handler = makeHandler({ harness: allowedHarness, desktopDisclosureRegistry });

    let response = await invokeHandler(handler, {
      method: "POST",
      url: "/desktop/inspect/accessibility-tree",
      body: { mode: "atspi" },
    });
    assert.equal(response.statusCode, 200);
    const [entry] = desktopDisclosureRegistry.snapshot();
    assert.equal(desktopDisclosureRegistry.authorizeRootRef({
      rootRef: entry.id,
      capability: "desktop.inspect.accessibility_tree",
    }).ok, true);

    response = await invokeHandler(handler, {
      method: "POST",
      url: "/harness-modules/adopt",
      body: { module_id: "no-desktop-inspection" },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(desktopDisclosureRegistry.authorizeRootRef({
      rootRef: entry.id,
      capability: "desktop.inspect.accessibility_tree",
    }), { ok: false, error: "desktop_traversal_root_revoked" });

    response = await invokeHandler(handler, {
      method: "POST",
      url: "/harness-modules/drop",
      body: { module_id: "no-desktop-inspection" },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(desktopDisclosureRegistry.authorizeRootRef({
      rootRef: entry.id,
      capability: "desktop.inspect.accessibility_tree",
    }), { ok: false, error: "desktop_traversal_root_revoked" });
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
    const desktopDisclosureRegistry = createDesktopDisclosureRegistrySpy();
    const handler = makeHandler({ harness: focusedInspectionHarness, desktopDisclosureRegistry });
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
    assert.equal("desktop_ref_id" in response.body.inspection.focused_object, false);
    assert.equal(desktopDisclosureRegistry.focusedInspectionCalls.length, 1);
    assert.equal(desktopDisclosureRegistry.focusedInspectionCalls[0].provenanceId, provenanceId);
    assert.equal(desktopDisclosureRegistry.focusedInspectionCalls[0].capability, "desktop.inspect.focus");
    assert.equal(desktopDisclosureRegistry.focusedInspectionCalls[0].inspection.focus_available, true);

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
  const handler = makeHandler({ harness: focusedInspectionHarness });
  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/desktop/inspect/focus",
    body: { include_text: true },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "focused_desktop_text_not_allowed");

  const provenance = await invokeHandler(handler, {
    method: "GET",
    url: "/provenance?event_type=desktop.inspect.focus",
  });
  assert.equal(provenance.statusCode, 200);
  assert.equal(provenance.body.entries.length, 0);
});

test("focused desktop inspection rejects invalid request fields before provenance", async () => {
  for (const [name, body] of Object.entries({
    unknown_field: { include_text: false, mode: "atspi" },
    string_include_text: { include_text: "false" },
    null_include_text: { include_text: null },
    object_include_text: { include_text: {} },
  })) {
    const handler = makeHandler({ harness: focusedInspectionHarness });
    const response = await invokeHandler(handler, {
      method: "POST",
      url: "/desktop/inspect/focus",
      body,
    });

    assert.equal(response.statusCode, 400, name);
    assert.equal(response.body.error, "focused_desktop_inspection_request_invalid", name);
    assert.equal("inspection" in response.body, false, name);
    assert.ok(Array.isArray(response.body.validation_errors), name);

    const provenance = await invokeHandler(handler, {
      method: "GET",
      url: "/provenance?event_type=desktop.inspect.focus",
    });
    assert.equal(provenance.statusCode, 200, name);
    assert.equal(provenance.body.entries.length, 0, name);
  }
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
    const desktopDisclosureRegistry = createDesktopDisclosureRegistrySpy();
    const handler = makeHandler({ harness: focusedInspectionHarness, desktopDisclosureRegistry });
    const response = await invokeHandler(handler, {
      method: "POST",
      url: "/desktop/inspect/focus",
      body: {},
    });

    assert.equal(response.statusCode, 502);
    assert.equal(response.body.error, "focused_desktop_inspection_schema_invalid");
    assert.ok(response.body.validation_errors.includes("result.focused_object.name is not allowed"));
    assert.equal("inspection" in response.body, false);
    assert.equal(desktopDisclosureRegistry.focusedInspectionCalls.length, 0);
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

function modelVisualProposalReviewFixture() {
  return {
    type: "model_visual_attach_proposal_template",
    activation_performed: false,
    subscription_activated: false,
    model_delivery_performed: false,
    payload_attached: false,
    payload_bytes_included: false,
    proposal: {
      capability: "model.context.visual.color.attach",
      reason: "Need one reviewed color frame for this turn.",
      requested_scope: "once",
    },
    review: {
      capability: "model.context.visual.color.attach",
      provider: "soma.provider.local-model",
      source: {
        subscription_id: "sub-color-1",
        subscription_ids: ["sub-color-1"],
        capability: "perception.sensorium.color.subscribe",
        capabilities: ["perception.sensorium.color.subscribe"],
        provider: "soma.provider.sensorium.jetsorano",
        topic: "sensor/jetsorano/realsense/color",
        grant_id: "grant-color-1",
      },
      model_target: "local.gemma4",
      payload_type: "color",
      frame_count: 1,
      max_frame_age_ms: 5_000,
      transformed_dimensions: [384, 384],
      format_required: "jpeg",
      preview: {
        required: true,
        available: true,
        acknowledgement_required: true,
        acknowledged: false,
        artifact_id: "preview-color-1",
        acknowledgement_id: "ack-preview-color-1",
        acknowledged_by: "user",
        acknowledged_at: "2026-05-19T12:00:00.000Z",
        cleanup_required: true,
      },
      retention: {
        mode: "none",
        payload_retained: false,
        memory_write_authorized: false,
      },
      memory_write_authorized: false,
      model_delivery_performed: false,
      payload_attached: false,
      payload_bytes_included: false,
    },
  };
}

function modelVisualGrantFixture() {
  return {
    id: "grant-visual-color",
    status: "active",
    capability: "model.context.visual.color.attach",
    provider: "soma.provider.local-model",
    scope: "once",
    constraints: {
      max_frame_count: 1,
      max_frame_age_ms: 5_000,
      transformed_dimensions: [384, 384],
      format_required: "jpeg",
      source_subscription_ids: ["sub-color-1"],
      source_capabilities: ["perception.sensorium.color.subscribe"],
      source_provider: "soma.provider.sensorium.jetsorano",
      source_topic: "sensor/jetsorano/realsense/color",
      source_grant_id: "grant-color-1",
      model_target: "local.gemma4",
      payload_type: "color",
      preview_artifact_id: "preview-color-1",
      preview_acknowledgement_id: "ack-preview-color-1",
      preview_acknowledged_by: "user",
      preview_acknowledged_at: "2026-05-19T12:00:00.000Z",
      preview_acknowledged: true,
      preview_cleanup_required: true,
      retention_mode: "none",
    },
  };
}

function modelVisualAttachRequestFixture() {
  return {
    capability: "model.context.visual.color.attach",
    grant_id: "grant-visual-color",
    source_subscription_ids: ["sub-color-1"],
    source_capabilities: ["perception.sensorium.color.subscribe"],
    source_provider: "soma.provider.sensorium.jetsorano",
    source_topic: "sensor/jetsorano/realsense/color",
    source_grant_id: "grant-color-1",
    model_target: "local.gemma4",
    payload_type: "color",
    max_frame_count: 1,
    max_frame_age_ms: 5_000,
    transformed_dimensions: [384, 384],
    format_required: "jpeg",
    preview_artifact_id: "preview-color-1",
    preview_acknowledgement_id: "ack-preview-color-1",
    preview_acknowledged_by: "user",
    preview_acknowledged_at: "2026-05-19T12:00:00.000Z",
    preview_acknowledged: true,
    preview_cleanup_required: true,
    retention_mode: "none",
  };
}

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
  grantRecoveryReport,
  runtimeWritePosture,
  body,
} = {}) {
  return invokeHandler(makeHandler({
    harness,
    capabilityCatalog: catalog,
    providerRegistry: providers,
    runtimeProfiles: profiles,
    modelClient,
    grantStore: grants,
    grantRecoveryReport,
    runtimeWritePosture,
  }), {
    method,
    url,
    body,
  });
}

// ── Sensorium subscription route fixtures (step 9e activation) ────────────

function makeFakeSensoriumSubscriber({ subscriptionId = "sub-test", startedAt = 1_700_000_000 } = {}) {
  const calls = [];
  const active = new Map();
  let automaticEndHandler = null;
  return {
    calls,
    activeCount: 0,
    onSubscriptionEnded(handler) {
      automaticEndHandler = typeof handler === "function" ? handler : null;
    },
    emitAutomaticEnd({ endSummary, subscription_id = subscriptionId } = {}) {
      automaticEndHandler?.({ subscription_id, endSummary });
    },
    async start({ capability, provider, grantId, scope, body }) {
      calls.push({ method: "start", args: { capability, provider, grantId, scope, body } });
      this.activeCount++;
      active.set(subscriptionId, { grantId });
      return {
        subscription_id: subscriptionId,
        topic: body?.topic ?? "",
        started_at: startedAt,
        startSummary: {
          event_type: "perception.sensorium.subscription_started",
          timestamp: new Date(startedAt * 1000).toISOString(),
          capability,
          provider,
          grant_id: grantId,
          scope: scope ?? "",
          topic: body?.topic ?? "",
          constraints_declared: body?.constraints ?? {},
          text_content_included: false,
          frames_recorded: false,
        },
      };
    },
    async stop(id, { terminationReason = "clean_stop" } = {}) {
      calls.push({ method: "stop", args: { id, terminationReason } });
      active.delete(id);
      this.activeCount = Math.max(0, this.activeCount - 1);
      return {
        endSummary: {
          event_type: "perception.sensorium.subscription_ended",
          timestamp: new Date().toISOString(),
          subscription_id: id,
          termination_reason: terminationReason,
          frames_consumed: 0,
          duration_seconds: 0,
          text_content_included: false,
          frames_recorded: false,
        },
      };
    },
    async stopByGrantId(grantId, { terminationReason = "revoked" } = {}) {
      const ids = Array.from(active.entries())
        .filter(([, record]) => record.grantId === grantId)
        .map(([id]) => id);
      const stopped = [];
      for (const id of ids) {
        const result = await this.stop(id, { terminationReason });
        stopped.push({
          subscription_id: id,
          endSummary: result.endSummary,
        });
      }
      return {
        stopped,
        stopped_count: stopped.length,
      };
    },
    describeActive() {
      return {
        family: "perception.sensorium",
        active_count: this.activeCount,
        summary: this.activeCount === 0 ? "No Sensorium subscriptions active" : "active",
        streams: [],
        frames_recorded: false,
      };
    },
  };
}

const SENSORIUM_TEST_GRANT_STORE = {
  schema_version: 1,
  grants: [
    {
      id: "grant-sensorium-color-test",
      status: "active",
      capability: "perception.sensorium.color.subscribe",
      provider: "soma.provider.sensorium.jetsorano",
      scope: "session",
      constraints: {
        max_seconds: 60,
        max_fps: 10,
        format_required: "jpeg",
        downsample_to: [640, 480],
      },
      approved_by: "user",
      reason: "test fixture",
      created_at: "2026-05-15T00:00:00.000Z",
      review_required: false,
      revoked_at: null,
      revoked_by: "",
      revocation_reason: "",
      replacement_grant_id: "",
      activation_performed: false,
    },
  ],
};

test("Sensorium routes return 503 when sensoriumSubscriber is not configured", async () => {
  const handler = makeHandler({ harness: allowedHarness });
  for (const url of ["/sensorium/subscriptions", "/sensorium/subscriptions/foo"]) {
    for (const method of ["GET", "POST", "DELETE"]) {
      const response = await invokeHandler(handler, { method, url });
      assert.equal(response.statusCode, 503, `${method} ${url}: expected 503`);
      assert.equal(response.body.error, "sensorium_subscriber_not_configured");
    }
  }
});

test("POST /sensorium/proposal-template returns review context without subscriber activation", async () => {
  const handler = makeHandler({ harness: allowedHarness });
  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/proposal-template",
    body: {
      requested_by: "assistant",
      capability: "perception.sensorium.color.subscribe",
      provider: "soma.provider.sensorium.jetsorano",
      topic: "sensor/jetsorano/realsense/color",
      requested_scope: "session",
      reason: "Need a bounded color view of the Sensorium scene for this task.",
      constraints: {
        max_seconds: 600,
        max_fps: 5,
        format_required: "jpeg",
        downsample_to: [384, 384],
      },
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.type, "sensorium_grant_proposal_template");
  assert.equal(response.body.review_only, true);
  assert.equal(response.body.activation_performed, false);
  assert.equal(response.body.durable, false);
  assert.equal(response.body.writable, false);
  assert.equal(response.body.grant_written, false);
  assert.equal(response.body.subscription_activated, false);
  assert.equal(response.body.proposal.capability, "perception.sensorium.color.subscribe");
  assert.equal(response.body.review.provider, "soma.provider.sensorium.jetsorano");
  assert.equal(response.body.review.topic, "sensor/jetsorano/realsense/color");
  assert.equal(response.body.review.max_fps, 5);
  assert.deepEqual(response.body.grant_intent.constraints.downsample_to, [384, 384]);
});

test("POST /sensorium/proposal-template rejects invalid review input before grant writes", async () => {
  const handler = makeHandler({ harness: allowedHarness });
  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/proposal-template",
    body: {
      capability: "perception.sensorium.color.subscribe",
      provider: "soma.provider.sensorium.jetsorano",
      topic: "sensor/jetsorano/realsense/depth",
      requested_scope: "session",
      reason: "Need color.",
      constraints: {
        max_seconds: 600,
        max_fps: 5,
        format_required: "jpeg",
        downsample_to: [384, 384],
      },
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "invalid_sensorium_grant_proposal_template");
  assert.match(response.body.message, /sensor\/<host>\/realsense\/color/);
});

test("POST /remote-graphical/proposal-template returns review context without activation", async () => {
  const handler = makeHandler({ harness: allowedHarness });
  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/remote-graphical/proposal-template",
    body: {
      requested_by: "assistant",
      capability: "perception.remote_desktop.video.subscribe",
      provider: "soma.provider.remote_desktop.sunshine",
      target_host: "soma-agent-desktop.local.sthnet.org",
      mode: "view_only",
      requested_scope: "session",
      locality: "lan",
      reason: "Need a bounded view of the graphical lab.",
      constraints: {
        max_seconds: 120,
        max_fps: 30,
        max_width: 1280,
        max_height: 720,
      },
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.type, "remote_graphical_session_proposal_template");
  assert.equal(response.body.review_only, true);
  assert.equal(response.body.activation_performed, false);
  assert.equal(response.body.durable, false);
  assert.equal(response.body.writable, false);
  assert.equal(response.body.grant_written, false);
  assert.equal(response.body.session_opened, false);
  assert.equal(response.body.pairing_performed, false);
  assert.equal(response.body.video_attached, false);
  assert.equal(response.body.input_dispatched, false);
  assert.equal(response.body.recording_started, false);
  assert.equal(response.body.review.provider, "soma.provider.remote_desktop.sunshine");
  assert.equal(response.body.review.target_host, "soma-agent-desktop.local.sthnet.org");
  assert.deepEqual(response.body.review.requested_channels, ["video"]);
  assert.ok(response.body.review.excluded_channels.includes("keyboard"));
  assert.ok(response.body.review.excluded_channels.includes("pointer"));
  assert.equal(response.body.grant_intent.constraints.max_width, 1280);
});

test("POST /remote-graphical/proposal-template rejects cross-channel overreach before activation", async () => {
  const handler = makeHandler({ harness: allowedHarness });
  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/remote-graphical/proposal-template",
    body: {
      capability: "perception.remote_desktop.video.subscribe",
      provider: "soma.provider.remote_desktop.sunshine",
      target_host: "soma-agent-desktop.local.sthnet.org",
      mode: "view_only",
      requested_channels: ["video", "keyboard"],
      requested_scope: "session",
      reason: "Need view plus keyboard.",
      constraints: {
        max_seconds: 120,
        max_fps: 30,
        max_width: 1280,
        max_height: 720,
      },
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "invalid_remote_graphical_proposal_template");
  assert.ok(response.body.validation_errors.includes("requested_channels.keyboard is not authorized by view_only"));
});

test("POST /remote-graphical/proposals stores pending proposal without session activation", async () => {
  const proposals = new CapabilityProposalStore();
  const handler = makeHandler({ harness: allowedHarness, capabilityProposals: proposals });
  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/remote-graphical/proposals",
    body: {
      requested_by: "assistant",
      capability: "desktop.remote.input.pointer",
      provider: "soma.provider.remote_desktop.sunshine",
      target_host: "soma-agent-desktop.local.sthnet.org",
      mode: "pointer_input",
      requested_scope: "session",
      reason: "Need bounded pointer input after operator-visible review.",
      constraints: {
        max_seconds: 30,
      },
    },
  });

  assert.equal(response.statusCode, 201);
  assert.match(response.body.proposal.id, /^[0-9a-f-]{36}$/);
  assert.equal(response.body.proposal.status, "pending");
  assert.equal(response.body.proposal.capability, "desktop.remote.input.pointer");
  assert.equal(response.body.review.provider, "soma.provider.remote_desktop.sunshine");
  assert.equal(response.body.review.authority, "pointer");
  assert.equal(response.body.grant_intent.constraints.mode, "pointer_input");
  assert.equal(response.body.activation_performed, false);
  assert.equal(response.body.durable, false);
  assert.equal(response.body.grant_written, false);
  assert.equal(response.body.session_opened, false);
  assert.equal(response.body.pairing_performed, false);
  assert.equal(response.body.video_attached, false);
  assert.equal(response.body.input_dispatched, false);
  assert.equal(response.body.recording_started, false);
  assert.equal(proposals.pendingCount(), 1);
});

test("POST /remote-graphical/grant-candidates returns candidate without writing grant or opening session", async () => {
  const proposals = new CapabilityProposalStore();
  proposals.proposals.push(makeApprovedRemoteGraphicalProposal());
  const handler = makeHandler({ harness: allowedHarness, capabilityProposals: proposals });
  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/remote-graphical/grant-candidates",
    body: {
      proposal_id: "proposal-remote-video",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.source_proposal_id, "proposal-remote-video");
  assert.equal(response.body.review_only, true);
  assert.equal(response.body.activation_performed, false);
  assert.equal(response.body.durable, false);
  assert.equal(response.body.grant_written, false);
  assert.equal(response.body.session_opened, false);
  assert.equal(response.body.pairing_performed, false);
  assert.equal(response.body.video_attached, false);
  assert.equal(response.body.input_dispatched, false);
  assert.equal(response.body.recording_started, false);
  assert.equal(response.body.grant_create_input.capability, "perception.remote_desktop.video.subscribe");
  assert.equal(response.body.grant_create_input.provider, "soma.provider.remote_desktop.sunshine");
  assert.equal(response.body.grant_create_input.approval_provenance_id, "prov-remote-approval");
  assert.equal(response.body.grant_create_input.constraints.target_host, "soma-agent-desktop.local.sthnet.org");
});

test("POST /remote-graphical/grant-candidates rejects pending proposal before grant write", async () => {
  const proposals = new CapabilityProposalStore();
  proposals.proposals.push({
    ...makeApprovedRemoteGraphicalProposal(),
    status: "pending",
    decision: undefined,
  });
  const handler = makeHandler({ harness: allowedHarness, capabilityProposals: proposals });
  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/remote-graphical/grant-candidates",
    body: {
      proposal_id: "proposal-remote-video",
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "invalid_remote_graphical_grant_candidate");
  assert.match(response.body.message, /proposal must be approved/);
});

test("POST /remote-graphical/grant-candidates rejects metadata drift before grant write", async () => {
  const proposals = new CapabilityProposalStore();
  const proposal = makeApprovedRemoteGraphicalProposal();
  proposal.grant_intent = {
    ...proposal.grant_intent,
    constraints: {
      ...proposal.grant_intent.constraints,
      target_host: "other-host.local",
    },
  };
  proposals.proposals.push(proposal);
  const handler = makeHandler({ harness: allowedHarness, capabilityProposals: proposals });
  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/remote-graphical/grant-candidates",
    body: {
      proposal_id: "proposal-remote-video",
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "invalid_remote_graphical_grant_candidate");
  assert.match(response.body.message, /target_host/);
});

test("remote graphical proposal approval alone does not create a runtime grant", async () => {
  const handler = makeHandler({
    harness: allowedHarness,
    grantStore: { schema_version: 1, grants: [] },
  });

  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/remote-graphical/proposals",
    body: {
      requested_by: "assistant",
      capability: "perception.remote_desktop.video.subscribe",
      provider: "soma.provider.remote_desktop.sunshine",
      target_host: "soma-agent-desktop.local.sthnet.org",
      mode: "view_only",
      requested_scope: "session",
      locality: "lan",
      reason: "Need a bounded view of the graphical lab.",
      constraints: {
        max_seconds: 120,
        max_fps: 30,
        max_width: 1280,
        max_height: 720,
      },
    },
  });
  const proposalId = response.body.proposal.id;

  response = await invokeHandler(handler, {
    method: "POST",
    url: `/capability-proposals/${proposalId}/approve`,
    body: { approved_scope: "session", decided_by: "user" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.activation_performed, false);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/grants?status=active",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.grants.length, 0);
});

test("POST /remote-graphical/grants creates runtime grant without opening remote session", async () => {
  const proposals = new CapabilityProposalStore();
  proposals.proposals.push(makeApprovedRemoteGraphicalProposal());
  const handler = makeHandler({
    harness: allowedHarness,
    capabilityProposals: proposals,
    grantStore: { schema_version: 1, grants: [] },
  });

  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/remote-graphical/grants",
    body: {
      proposal_id: "proposal-remote-video",
      actor: "user",
    },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.source_proposal_id, "proposal-remote-video");
  assert.equal(response.body.grant.capability, "perception.remote_desktop.video.subscribe");
  assert.equal(response.body.grant.provider, "soma.provider.remote_desktop.sunshine");
  assert.equal(response.body.grant.scope, "session");
  assert.equal(response.body.grant.constraints.target_host, "soma-agent-desktop.local.sthnet.org");
  assert.deepEqual(response.body.grant.constraints.requested_channels, ["video"]);
  assert.equal(response.body.grant.constraints.max_seconds, 120);
  assert.equal(response.body.activation_performed, false);
  assert.equal(response.body.durable, false);
  assert.equal(response.body.file_written, false);
  assert.equal(response.body.grant_written, true);
  assert.equal(response.body.session_opened, false);
  assert.equal(response.body.pairing_performed, false);
  assert.equal(response.body.video_attached, false);
  assert.equal(response.body.input_dispatched, false);
  assert.equal(response.body.recording_started, false);
  assert.match(response.body.provenance_id, /^[0-9a-f-]{36}$/);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/grants?status=active",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.grants.length, 1);
  assert.equal(response.body.grants[0].capability, "perception.remote_desktop.video.subscribe");
  assert.equal(response.body.grants[0].activation_performed, false);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/provenance?event_type=desktop.remote_graphical.grant.created",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.entries.length, 1);
  assert.equal(response.body.entries[0].proposal_id, "proposal-remote-video");
  assert.equal(response.body.entries[0].target_host, "soma-agent-desktop.local.sthnet.org");
  assert.equal(response.body.entries[0].session_opened, false);
  assert.equal(response.body.entries[0].input_dispatched, false);
});

test("POST /remote-graphical/grants rejects pending proposals and non-user actors before grant write", async () => {
  const proposals = new CapabilityProposalStore();
  proposals.proposals.push({
    ...makeApprovedRemoteGraphicalProposal(),
    status: "pending",
    decision: undefined,
  });
  const handler = makeHandler({
    harness: allowedHarness,
    capabilityProposals: proposals,
    grantStore: { schema_version: 1, grants: [] },
  });

  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/remote-graphical/grants",
    body: { proposal_id: "proposal-remote-video", actor: "assistant" },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "remote_graphical_grant_create_requires_user_actor");

  response = await invokeHandler(handler, {
    method: "POST",
    url: "/remote-graphical/grants",
    body: { proposal_id: "proposal-remote-video", actor: "user" },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "invalid_remote_graphical_grant_candidate");

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/grants?status=active",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.grants.length, 0);
});

test("POST /sensorium/proposals stores pending proposal with review context but no activation", async () => {
  const handler = makeHandler({ harness: allowedHarness });
  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/proposals",
    body: {
      requested_by: "assistant",
      capability: "perception.sensorium.color.subscribe",
      provider: "soma.provider.sensorium.jetsorano",
      topic: "sensor/jetsorano/realsense/color",
      requested_scope: "session",
      reason: "Need a bounded color view of the Sensorium scene for this task.",
      constraints: {
        max_seconds: 600,
        max_fps: 5,
        format_required: "jpeg",
        downsample_to: [384, 384],
      },
    },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.proposal.status, "pending");
  assert.equal(response.body.proposal.capability, "perception.sensorium.color.subscribe");
  assert.equal(response.body.proposal.review_context.provider, "soma.provider.sensorium.jetsorano");
  assert.equal(response.body.proposal.review_context.topic, "sensor/jetsorano/realsense/color");
  assert.equal(response.body.proposal.grant_intent.provider, "soma.provider.sensorium.jetsorano");
  assert.equal(response.body.activation_performed, false);
  assert.equal(response.body.grant_written, false);
  assert.equal(response.body.subscription_activated, false);
  assert.match(response.body.provenance_id, /^[0-9a-f-]{36}$/);
  const proposalId = response.body.proposal.id;

  response = await invokeHandler(handler, {
    method: "GET",
    url: `/capability-proposals/${proposalId}`,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.proposal.review_context.stream_type, "color");
  assert.deepEqual(response.body.proposal.grant_intent.constraints.downsample_to, [384, 384]);
  assert.equal(response.body.activation_performed, false);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/notifications",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.notifications.length, 1);
  assert.equal(response.body.notifications[0].proposal_id, proposalId);
  assert.equal(response.body.notifications[0].activation_performed, false);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/provenance?event_type=capability.proposal.created",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.entries.length, 1);
  assert.equal(response.body.entries[0].review_provider, "soma.provider.sensorium.jetsorano");
  assert.equal(response.body.entries[0].review_topic, "sensor/jetsorano/realsense/color");
  assert.equal(response.body.entries[0].review_stream_type, "color");
  assert.equal(response.body.entries[0].activation_performed, false);
});

test("POST /sensorium/proposals rejects invalid input before proposal storage", async () => {
  const handler = makeHandler({ harness: allowedHarness });
  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/proposals",
    body: {
      capability: "perception.sensorium.color.subscribe",
      provider: "soma.provider.sensorium.jetsorano",
      topic: "sensor/jetsorano/realsense/depth",
      requested_scope: "session",
      reason: "Need color.",
      constraints: {
        max_seconds: 600,
        max_fps: 5,
        format_required: "jpeg",
        downsample_to: [384, 384],
      },
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "invalid_sensorium_grant_proposal_template");

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/capability-proposals",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.proposals.length, 0);
});

test("approving a Sensorium proposal does not create grants or activate subscriptions", async () => {
  const handler = makeHandler({
    harness: allowedHarness,
    grantStore: { schema_version: 1, grants: [] },
    sensoriumSubscriber: makeFakeSensoriumSubscriber(),
  });

  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/proposals",
    body: {
      requested_by: "assistant",
      capability: "perception.sensorium.color.subscribe",
      provider: "soma.provider.sensorium.jetsorano",
      topic: "sensor/jetsorano/realsense/color",
      requested_scope: "session",
      reason: "Need a bounded color view of the Sensorium scene for this task.",
      constraints: {
        max_seconds: 600,
        max_fps: 5,
        format_required: "jpeg",
        downsample_to: [384, 384],
      },
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
  assert.equal(response.body.activation_performed, false);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/grants",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.grants.length, 0);
  assert.equal(response.body.summary.total, 0);
  assert.equal(response.body.activation_performed, false);
  assert.equal(response.body.writable, false);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/sensorium/subscriptions",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.active_count, 0);
});

test("POST /sensorium/grants creates session grant from approved proposal without activating subscription", async () => {
  const handler = makeHandler({
    harness: allowedHarness,
    grantStore: { schema_version: 1, grants: [] },
    sensoriumSubscriber: makeFakeSensoriumSubscriber(),
  });

  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/proposals",
    body: {
      requested_by: "assistant",
      capability: "perception.sensorium.color.subscribe",
      provider: "soma.provider.sensorium.jetsorano",
      topic: "sensor/jetsorano/realsense/color",
      requested_scope: "session",
      reason: "Need a bounded color view of the Sensorium scene for this task.",
      constraints: {
        max_seconds: 600,
        max_fps: 5,
        format_required: "jpeg",
        downsample_to: [384, 384],
      },
    },
  });
  const proposalId = response.body.proposal.id;

  response = await invokeHandler(handler, {
    method: "POST",
    url: `/capability-proposals/${proposalId}/approve`,
    body: { approved_scope: "session", decided_by: "user" },
  });
  assert.equal(response.statusCode, 200);

  response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/grants",
    body: { proposal_id: proposalId, actor: "user" },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.source_proposal_id, proposalId);
  assert.equal(response.body.grant.capability, "perception.sensorium.color.subscribe");
  assert.equal(response.body.grant.provider, "soma.provider.sensorium.jetsorano");
  assert.equal(response.body.grant.scope, "session");
  assert.equal(response.body.grant.constraints.topic, "sensor/jetsorano/realsense/color");
  assert.equal(response.body.grant.constraints.max_fps, 5);
  assert.equal(response.body.activation_performed, false);
  assert.equal(response.body.file_written, false);
  assert.equal(response.body.grant_written, true);
  assert.equal(response.body.subscription_activated, false);
  assert.match(response.body.provenance_id, /^[0-9a-f-]{36}$/);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/grants?status=active",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.grants.length, 1);
  assert.equal(response.body.grants[0].constraints.topic, "sensor/jetsorano/realsense/color");
  assert.equal(response.body.grants[0].activation_performed, false);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/sensorium/subscriptions",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.active_count, 0);

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/provenance?event_type=perception.sensorium.grant.created",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.entries.length, 1);
  assert.equal(response.body.entries[0].proposal_id, proposalId);
  assert.equal(response.body.entries[0].topic, "sensor/jetsorano/realsense/color");
  assert.equal(response.body.entries[0].subscription_activated, false);
});

test("POST /sensorium/grants rejects unapproved proposals and non-user actors", async () => {
  const handler = makeHandler({
    harness: allowedHarness,
    grantStore: { schema_version: 1, grants: [] },
  });

  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/proposals",
    body: {
      requested_by: "assistant",
      capability: "perception.sensorium.color.subscribe",
      provider: "soma.provider.sensorium.jetsorano",
      topic: "sensor/jetsorano/realsense/color",
      requested_scope: "session",
      reason: "Need a bounded color view of the Sensorium scene for this task.",
      constraints: {
        max_seconds: 600,
        max_fps: 5,
        format_required: "jpeg",
        downsample_to: [384, 384],
      },
    },
  });
  const proposalId = response.body.proposal.id;

  response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/grants",
    body: { proposal_id: proposalId, actor: "assistant" },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "sensorium_grant_create_requires_user_actor");

  response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/grants",
    body: { proposal_id: proposalId, actor: "user" },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "invalid_sensorium_grant_candidate");
});

test("POST /sensorium/grants/:id/revoke revokes runtime grant and stops active subscriptions", async () => {
  const subscriber = makeFakeSensoriumSubscriber({ subscriptionId: "sub-revoked" });
  const handler = makeHandler({
    harness: allowedHarness,
    grantStore: SENSORIUM_TEST_GRANT_STORE,
    sensoriumSubscriber: subscriber,
  });

  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/subscriptions",
    body: {
      capability: "perception.sensorium.color.subscribe",
      topic: "sensor/jetsorano/realsense/color",
      constraints: {
        max_seconds: 30,
        max_fps: 5,
        format_required: "jpeg",
        downsample_to: [320, 240],
      },
    },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.subscription_id, "sub-revoked");

  response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/grants/grant-sensorium-color-test/revoke",
    body: {
      actor: "user",
      reason: "No longer need a color stream for this task.",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.changed, true);
  assert.equal(response.body.grant.status, "revoked");
  assert.equal(response.body.grant.revoked_by, "user");
  assert.equal(response.body.grant.revocation_reason, "No longer need a color stream for this task.");
  assert.equal(response.body.file_written, false);
  assert.equal(response.body.activation_performed, false);
  assert.equal(response.body.subscription_activated, false);
  assert.equal(response.body.stopped_subscription_count, 1);
  assert.equal(response.body.stopped_subscriptions[0].subscription_id, "sub-revoked");
  assert.equal(response.body.stopped_subscriptions[0].end_summary.termination_reason, "revoked");
  assert.equal(subscriber.activeCount, 0);
  assert.deepEqual(
    subscriber.calls.map((call) => [call.method, call.args.terminationReason ?? ""]),
    [["start", ""], ["stop", "revoked"]],
  );

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/grants?status=revoked",
  });
  assert.equal(response.body.grants.length, 1);
  assert.equal(response.body.grants[0].id, "grant-sensorium-color-test");

  response = await invokeHandler(handler, {
    method: "GET",
    url: "/provenance?event_type=perception.sensorium.grant.revoked",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.entries.length, 1);
  assert.equal(response.body.entries[0].grant_id, "grant-sensorium-color-test");
  assert.equal(response.body.entries[0].stopped_subscription_count, 1);
});

test("POST /sensorium/grants/:id/revoke rejects non-user actors and unknown grants", async () => {
  const handler = makeHandler({
    harness: allowedHarness,
    grantStore: SENSORIUM_TEST_GRANT_STORE,
    sensoriumSubscriber: makeFakeSensoriumSubscriber(),
  });

  let response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/grants/grant-sensorium-color-test/revoke",
    body: {
      actor: "assistant",
      reason: "No longer needed.",
    },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "sensorium_grant_revoke_requires_user_actor");

  response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/grants/no-such-grant/revoke",
    body: {
      actor: "user",
      reason: "No longer needed.",
    },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "unknown_grant");
});

test("POST /sensorium/grants/:id/revoke rejects non-Sensorium grants", async () => {
  const handler = makeHandler({
    harness: allowedHarness,
    grantStore: {
      schema_version: 1,
      grants: [
        {
          id: "grant-desktop",
          status: "active",
          capability: "desktop.inspect.accessibility_tree",
          provider: "soma.provider.desktop.local",
          scope: "session",
          constraints: {},
          approved_by: "user",
          reason: "test fixture",
          created_at: "2026-05-17T00:00:00.000Z",
          activation_performed: false,
        },
      ],
    },
    sensoriumSubscriber: makeFakeSensoriumSubscriber(),
  });

  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/grants/grant-desktop/revoke",
    body: {
      actor: "user",
      reason: "No longer needed.",
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "sensorium_grant_revoke_requires_sensorium_grant");
});

test("Sensorium automatic subscription endings are recorded in provenance", async () => {
  const subscriber = makeFakeSensoriumSubscriber({ subscriptionId: "sub-timeout-app" });
  const handler = makeHandler({
    harness: allowedHarness,
    grantStore: SENSORIUM_TEST_GRANT_STORE,
    sensoriumSubscriber: subscriber,
  });

  subscriber.emitAutomaticEnd({
    subscription_id: "sub-timeout-app",
    endSummary: {
      event_type: "perception.sensorium.subscription_ended",
      timestamp: "2026-05-18T22:00:00.000Z",
      capability: "perception.sensorium.color.subscribe",
      provider: "soma.provider.sensorium.jetsorano",
      grant_id: "grant-sensorium-color-test",
      scope: "session",
      topic: "sensor/jetsorano/realsense/color",
      started_at: "2026-05-18T21:59:00.000Z",
      ended_at: "2026-05-18T22:00:00.000Z",
      duration_seconds: 60,
      termination_reason: "timeout",
      frames_consumed: 3,
      schema_version_observed: 1,
      schema_mismatches: 0,
      first_frame_number: 10,
      last_frame_number: 12,
      stream_summary_observed: {
        schema_version: 1,
        frame_number: 12,
        width: 320,
        height: 180,
        format: "jpeg",
        payload_size: 12345,
      },
      text_content_included: false,
      frames_recorded: false,
      payload_bytes: "must not be present in canonical summaries",
    },
  });

  const response = await invokeHandler(handler, {
    method: "GET",
    url: "/provenance?event_type=perception.sensorium.subscription_ended",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.entries.length, 1);
  const event = response.body.entries[0];
  assert.equal(event.caller_identity, "soma.sensorium.automatic-end");
  assert.equal(event.termination_reason, "timeout");
  assert.equal(event.frames_consumed, 3);
  assert.equal(event.frames_recorded, false);
  assert.equal(event.text_content_included, false);
  assert.deepEqual(event.stream_summary_observed, {
    schema_version: 1,
    frame_number: 12,
    width: 320,
    height: 180,
    format: "jpeg",
    payload_size: 12345,
  });
  assert.equal(JSON.stringify(event).includes("payload_bytes"), false);
});

test("POST /sensorium/subscriptions enforces exact grant topic when present", async () => {
  const subscriber = makeFakeSensoriumSubscriber();
  const handler = makeHandler({
    harness: allowedHarness,
    grantStore: {
      schema_version: 1,
      grants: [
        {
          id: "grant-sensorium-imu-accel",
          status: "active",
          capability: "perception.sensorium.imu.subscribe",
          provider: "soma.provider.sensorium.jetsorano",
          scope: "session",
          constraints: {
            topic: "sensor/jetsorano/realsense/imu/accel",
            max_seconds: 60,
          },
          approved_by: "user",
          approval_provenance_id: "prov-imu",
          reason: "test fixture",
          created_at: "2026-05-17T00:00:00.000Z",
          activation_performed: false,
        },
      ],
    },
    sensoriumSubscriber: subscriber,
  });

  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/subscriptions",
    body: {
      capability: "perception.sensorium.imu.subscribe",
      topic: "sensor/jetsorano/realsense/imu/gyro",
      constraints: { max_seconds: 30 },
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "sensorium_subscription_topic_not_authorized");
  assert.equal(subscriber.calls.length, 0);
});

test("POST /sensorium/subscriptions returns 403 when no active grant exists", async () => {
  // The default grant store (no Sensorium grants) is what production
  // starts with. This is the load-bearing fail-closed path.
  const subscriber = makeFakeSensoriumSubscriber();
  const handler = makeHandler({
    harness: allowedHarness,
    grantStore: { schema_version: 1, grants: [] },
    sensoriumSubscriber: subscriber,
  });

  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/subscriptions",
    body: {
      capability: "perception.sensorium.color.subscribe",
      topic: "sensor/jetsorano/realsense/color",
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "sensorium_subscription_no_grant");
  // Verify the subscriber was NOT invoked — policy denial happens
  // before the subscriber so the helper is never reached.
  assert.equal(subscriber.calls.length, 0);
});

test("POST /sensorium/subscriptions fails closed when grant recovery is degraded", async () => {
  const subscriber = makeFakeSensoriumSubscriber();
  const handler = makeHandler({
    harness: allowedHarness,
    grantStore: SENSORIUM_TEST_GRANT_STORE,
    grantRecoveryReport: {
      ok: false,
      degraded: true,
      findings: [
        {
          code: "missing_grant_created_provenance",
          grant_id: "grant-sensorium-color-test",
          capability: "perception.sensorium.color.subscribe",
          provider: "soma.provider.sensorium.jetsorano",
          scope: "session",
          authorizing_safe: false,
        },
      ],
    },
    sensoriumSubscriber: subscriber,
  });

  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/subscriptions",
    body: {
      capability: "perception.sensorium.color.subscribe",
      topic: "sensor/jetsorano/realsense/color",
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "sensorium_subscription_grant_recovery_required");
  assert.equal(response.body.findings[0].code, "missing_grant_created_provenance");
  assert.equal(subscriber.calls.length, 0);
});

test("POST /sensorium/subscriptions fails closed on unsupported grant-store schema", async () => {
  const subscriber = makeFakeSensoriumSubscriber();
  const handler = makeHandler({
    harness: allowedHarness,
    grantStore: {
      schema_version: 2,
      grants: SENSORIUM_TEST_GRANT_STORE.grants,
    },
    sensoriumSubscriber: subscriber,
  });

  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/subscriptions",
    body: {
      capability: "perception.sensorium.color.subscribe",
      topic: "sensor/jetsorano/realsense/color",
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "sensorium_subscription_grant_store_schema_unsupported");
  assert.equal(subscriber.calls.length, 0);
});

test("POST /sensorium/subscriptions returns 400 when capability is missing", async () => {
  const handler = makeHandler({
    harness: allowedHarness,
    grantStore: SENSORIUM_TEST_GRANT_STORE,
    sensoriumSubscriber: makeFakeSensoriumSubscriber(),
  });
  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/subscriptions",
    body: { topic: "sensor/jetsorano/realsense/color" },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "sensorium_subscription_request_invalid");
});

test("POST /sensorium/subscriptions returns 403 when grant provider cannot support capability", async () => {
  const subscriber = makeFakeSensoriumSubscriber();
  const handler = makeHandler({
    harness: allowedHarness,
    grantStore: {
      schema_version: 1,
      grants: [
        {
          ...SENSORIUM_TEST_GRANT_STORE.grants[0],
          provider: "soma.provider.local-model",
        },
      ],
    },
    sensoriumSubscriber: subscriber,
  });

  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/subscriptions",
    body: {
      capability: "perception.sensorium.color.subscribe",
      topic: "sensor/jetsorano/realsense/color",
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "sensorium_subscription_provider_not_authorized");
  assert.equal(subscriber.calls.length, 0);
});

test("POST /sensorium/subscriptions returns 403 when topic host is outside provider grant", async () => {
  const subscriber = makeFakeSensoriumSubscriber();
  const handler = makeHandler({
    harness: allowedHarness,
    grantStore: SENSORIUM_TEST_GRANT_STORE,
    sensoriumSubscriber: subscriber,
  });

  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/subscriptions",
    body: {
      capability: "perception.sensorium.color.subscribe",
      topic: "sensor/othernode/realsense/color",
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "sensorium_subscription_topic_not_authorized");
  assert.equal(subscriber.calls.length, 0);
});

test("POST /sensorium/subscriptions succeeds when an active grant exists", async () => {
  const subscriber = makeFakeSensoriumSubscriber({ subscriptionId: "sub-color-1" });
  const handler = makeHandler({
    harness: allowedHarness,
    grantStore: SENSORIUM_TEST_GRANT_STORE,
    sensoriumSubscriber: subscriber,
  });

  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/subscriptions",
    body: {
      capability: "perception.sensorium.color.subscribe",
      scope: "session",
      topic: "sensor/jetsorano/realsense/color",
      constraints: { max_seconds: 60, max_fps: 5, format_required: "jpeg" },
    },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.subscription_id, "sub-color-1");
  assert.equal(response.body.topic, "sensor/jetsorano/realsense/color");
  assert.equal(response.body.grant_id, "grant-sensorium-color-test");
  assert.equal(response.body.activation_performed, true);
  assert.match(response.body.provenance_id, /^[0-9a-f-]{36}$/);

  assert.equal(subscriber.calls.length, 1);
  assert.equal(subscriber.calls[0].method, "start");
  assert.equal(subscriber.calls[0].args.capability, "perception.sensorium.color.subscribe");
  assert.equal(subscriber.calls[0].args.provider, "soma.provider.sensorium.jetsorano");
  assert.equal(subscriber.calls[0].args.grantId, "grant-sensorium-color-test");
  assert.deepEqual(subscriber.calls[0].args.body.constraints, {
    max_seconds: 60,
    max_fps: 5,
    format_required: "jpeg",
    downsample_to: [640, 480],
  });
});

test("POST /sensorium/subscriptions rejects topic mismatch before subscriber invocation", async () => {
  const subscriber = makeFakeSensoriumSubscriber();
  const handler = makeHandler({
    harness: allowedHarness,
    grantStore: SENSORIUM_TEST_GRANT_STORE,
    sensoriumSubscriber: subscriber,
  });
  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/subscriptions",
    body: {
      capability: "perception.sensorium.color.subscribe",
      topic: "sensor/jetsorano/realsense/depth",
    },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "sensorium_subscription_request_invalid");
  assert.equal(subscriber.calls.length, 0);
});

test("POST /sensorium/subscriptions rejects constraints beyond grant before subscriber invocation", async () => {
  const cases = [
    {
      name: "too long",
      constraints: { max_seconds: 61, max_fps: 5, format_required: "jpeg" },
    },
    {
      name: "too fast",
      constraints: { max_seconds: 60, max_fps: 11, format_required: "jpeg" },
    },
    {
      name: "wrong format",
      constraints: { max_seconds: 60, max_fps: 5, format_required: "jpeg" },
      grantConstraints: {
        max_seconds: 60,
        max_fps: 10,
        format_required: "png",
        downsample_to: [640, 480],
      },
    },
    {
      name: "oversized downsample",
      constraints: {
        max_seconds: 60,
        max_fps: 5,
        format_required: "jpeg",
        downsample_to: [800, 480],
      },
    },
  ];

  for (const { name, constraints, grantConstraints } of cases) {
    const subscriber = makeFakeSensoriumSubscriber();
    const handler = makeHandler({
      harness: allowedHarness,
      grantStore: grantConstraints
        ? {
            schema_version: 1,
            grants: [
              {
                ...SENSORIUM_TEST_GRANT_STORE.grants[0],
                constraints: grantConstraints,
              },
            ],
          }
        : SENSORIUM_TEST_GRANT_STORE,
      sensoriumSubscriber: subscriber,
    });
    const response = await invokeHandler(handler, {
      method: "POST",
      url: "/sensorium/subscriptions",
      body: {
        capability: "perception.sensorium.color.subscribe",
        topic: "sensor/jetsorano/realsense/color",
        constraints,
      },
    });

    assert.equal(response.statusCode, 403, name);
    assert.equal(response.body.error, "sensorium_subscription_grant_constraints_exceeded", name);
    assert.equal(subscriber.calls.length, 0, name);
  }
});

test("POST /sensorium/subscriptions maps subscriber.start errors to HTTP statuses", async () => {
  const subscriber = {
    async start() {
      const err = new Error("helper unavailable");
      err.code = "sensorium_subscription_start_failed";
      err.statusCode = 503;
      throw err;
    },
    async stop() { throw new Error("unused"); },
    describeActive() { return { family: "perception.sensorium", active_count: 0, summary: "", streams: [], frames_recorded: false }; },
  };
  const handler = makeHandler({
    harness: allowedHarness,
    grantStore: SENSORIUM_TEST_GRANT_STORE,
    sensoriumSubscriber: subscriber,
  });
  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/subscriptions",
    body: {
      capability: "perception.sensorium.color.subscribe",
      topic: "sensor/jetsorano/realsense/color",
    },
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.error, "sensorium_subscription_start_failed");
});

test("DELETE /sensorium/subscriptions/:id returns the end summary", async () => {
  const subscriber = makeFakeSensoriumSubscriber({ subscriptionId: "sub-stop-test" });
  const handler = makeHandler({
    harness: allowedHarness,
    grantStore: SENSORIUM_TEST_GRANT_STORE,
    sensoriumSubscriber: subscriber,
  });

  // Start so the fake's activeCount is set up; not strictly required
  // for the fake but mirrors real flow.
  await invokeHandler(handler, {
    method: "POST",
    url: "/sensorium/subscriptions",
    body: {
      capability: "perception.sensorium.color.subscribe",
      topic: "sensor/jetsorano/realsense/color",
    },
  });

  const response = await invokeHandler(handler, {
    method: "DELETE",
    url: "/sensorium/subscriptions/sub-stop-test",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.subscription_id, "sub-stop-test");
  assert.equal(response.body.end_summary.termination_reason, "clean_stop");
  assert.match(response.body.provenance_id, /^[0-9a-f-]{36}$/);

  const stopCall = subscriber.calls.find((c) => c.method === "stop");
  assert.ok(stopCall);
  assert.equal(stopCall.args.id, "sub-stop-test");
});

test("DELETE /sensorium/subscriptions/:id returns 404 when subscription_not_found", async () => {
  const subscriber = {
    async start() { throw new Error("unused"); },
    async stop() {
      const err = new Error("not tracked");
      err.code = "subscription_not_found";
      throw err;
    },
    describeActive() { return { family: "perception.sensorium", active_count: 0, summary: "", streams: [], frames_recorded: false }; },
  };
  const handler = makeHandler({
    harness: allowedHarness,
    grantStore: SENSORIUM_TEST_GRANT_STORE,
    sensoriumSubscriber: subscriber,
  });
  const response = await invokeHandler(handler, {
    method: "DELETE",
    url: "/sensorium/subscriptions/no-such",
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error, "subscription_not_found");
});

test("GET /sensorium/subscriptions returns the disclosure shape", async () => {
  const subscriber = makeFakeSensoriumSubscriber();
  const handler = makeHandler({
    harness: allowedHarness,
    grantStore: SENSORIUM_TEST_GRANT_STORE,
    sensoriumSubscriber: subscriber,
  });
  const response = await invokeHandler(handler, {
    method: "GET",
    url: "/sensorium/subscriptions",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.family, "perception.sensorium");
  assert.equal(response.body.active_count, 0);
  assert.equal(response.body.frames_recorded, false);
});

function makeHandler({
  harness = allowedHarness,
  capabilityCatalog: catalog = capabilityCatalog,
  providerRegistry: providers = providerRegistry,
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
  grantRecoveryReport,
  runtimeWritePosture,
  desktopDisclosureRegistry,
  sensoriumSubscriber,
  capabilityProposals,
} = {}) {
  return createRequestHandler({
    harness,
    capabilityCatalog: catalog,
    providerRegistry: providers,
    moduleRegistry: modules,
    runtimeProfiles: profiles,
    modelClient,
    grantStore: grants,
    grantRecoveryReport,
    runtimeWritePosture,
    desktopDisclosureRegistry,
    sensoriumSubscriber,
    capabilityProposals,
    logger: { info() {} },
  });
}

function makeApprovedRemoteGraphicalProposal() {
  const constraints = {
    target_host: "soma-agent-desktop.local.sthnet.org",
    mode: "view_only",
    locality: "lan",
    attended: true,
    requested_channels: ["video"],
    max_seconds: 120,
    max_fps: 30,
    max_width: 1280,
    max_height: 720,
  };
  return {
    id: "proposal-remote-video",
    status: "approved",
    type: "capability_proposal",
    requested_by: "assistant",
    capability: "perception.remote_desktop.video.subscribe",
    requested_scope: "session",
    reason: "Need a bounded view of the graphical lab.",
    decision: {
      decision: "approved",
      approved_scope: "session",
      decided_by: "user",
      decided_at: "2026-05-24T12:00:00.000Z",
      provenance_id: "prov-remote-approval",
      activation_performed: false,
    },
    review_context: {
      capability: "perception.remote_desktop.video.subscribe",
      provider: "soma.provider.remote_desktop.sunshine",
      target_host: "soma-agent-desktop.local.sthnet.org",
      mode: "view_only",
      authority: "video",
      risk_class: "high",
      scope: "session",
      locality: "lan",
      attended: true,
      constraints: { ...constraints },
      requested_channels: ["video"],
      excluded_channels: ["keyboard", "pointer", "recording"],
      active_disclosure: "remote graphical video authority for soma-agent-desktop.local.sthnet.org, expires in 120 seconds",
      revocation: {
        summary: "Revoking this grant stops video authority for soma-agent-desktop.local.sthnet.org.",
        immediate_stop: true,
      },
      recording_posture: "No screenshots or frames are retained by default.",
      model_boundary_warning: "Remote desktop frames can be stopped later.",
      provenance_posture: "Record metadata only.",
    },
    grant_intent: {
      capability: "perception.remote_desktop.video.subscribe",
      provider: "soma.provider.remote_desktop.sunshine",
      scope: "session",
      constraints: { ...constraints },
      reason: "Need a bounded view of the graphical lab.",
      activation_performed: false,
    },
  };
}

function createDesktopDisclosureRegistrySpy() {
  return {
    accessibilityTreeCalls: [],
    focusedInspectionCalls: [],
    authorizeRootRefCalls: [],
    recordFromAccessibilityTree(args) {
      this.accessibilityTreeCalls.push(args);
      return [];
    },
    recordFromFocusedInspection(args) {
      this.focusedInspectionCalls.push(args);
      return [];
    },
    authorizeRootRef(args) {
      this.authorizeRootRefCalls.push(args);
      return { ok: false, error: "desktop_traversal_root_not_disclosed" };
    },
    revokeByCapability() {},
  };
}

function createTraversalActivationRegistrySpy(scenario) {
  const base = createDesktopDisclosureRegistrySpy();
  return {
    ...base,
    authorizeRootRef(args) {
      this.authorizeRootRefCalls.push(args);
      const rootRef = args.rootRef;
      const errors = {
        "desktop-ref-unknown": "desktop_traversal_root_not_disclosed",
        "desktop-ref-expired": "desktop_traversal_root_expired",
        "desktop-ref-revoked": "desktop_traversal_root_revoked",
        "desktop-ref-inactive": "desktop_traversal_root_capability_inactive",
        "desktop-ref-module-revoked": "desktop_traversal_root_revoked",
      };
      if (errors[rootRef]) {
        return { ok: false, error: errors[rootRef] };
      }
      return {
        ok: true,
        service: ":1.42",
        path: "/org/a11y/atspi/accessible/root",
        source_event_id: "prov-tree",
        source_type: scenario.expected_path === "unavailable"
          ? "root_child_sample"
          : "application_root",
      };
    },
  };
}

function desktopTraversalActivationHelperScript({ commandsPath, baseInspection, traversal }) {
  return `#!/usr/bin/env sh
printf '%s\\n' "$1" >> "${commandsPath}"
if [ "$1" = "inspect-atspi" ]; then
  printf '%s\\n' '${JSON.stringify(baseInspection)}'
elif [ "$1" = "inspect-atspi-traversal" ]; then
  printf '%s\\n' '${JSON.stringify(traversal)}'
else
  exit 2
fi
`;
}

async function readHelperCommands(commandsPath) {
  try {
    const commands = await readFile(commandsPath, "utf8");
    return commands.trim().length === 0 ? [] : commands.trim().split("\n");
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function traversalOutputForActivationScenario(scenario) {
  if (scenario.helper_output) {
    return scenario.helper_output;
  }
  if (scenario.expected_path === "unavailable") {
    return unavailableEndpointTraversalOutput();
  }
  return successfulEndpointTraversalOutput();
}

function traversalBaseInspection() {
  return {
    mode: "read_only_atspi_probe",
    broker_source: "rust_helper",
    platform: "linux",
    release: "test",
    desktop_session: "GNOME",
    session_type: "wayland",
    dbus_session_bus_available: true,
    atspi_likely_available: true,
    atspi_bus_address_available: true,
    application_count: 1,
    root_object_available_count: 1,
    window_count: 0,
    tree: {
      applications: [
        {
          service: ":1.42",
          pid: 123,
          process: "test-app",
          registry: false,
          root_object: {
            path: "/org/a11y/atspi/accessible/root",
            name: "test-app",
            role: "application",
            child_count: 1,
            children_sample: [],
            child_metadata_sample: [],
          },
          root_object_error: null,
        },
      ],
      windows: [],
      bounded: true,
      text_content_included: false,
    },
    tree_available: true,
  };
}

function successfulEndpointTraversalOutput() {
  return {
    root: { service: ":1.42", path: "/org/a11y/atspi/accessible/root" },
    nodes: [
      {
        id: "n0",
        service: ":1.42",
        path: "/org/a11y/atspi/accessible/root",
        role: "application",
        child_count: 0,
        depth: 0,
        children: [],
      },
    ],
    limits: {
      max_depth: 2,
      max_nodes: 64,
      max_children_per_node: 8,
    },
    truncated: false,
    text_content_included: false,
    withheld_fields: ["name", "description", "text", "states", "actions"],
  };
}

function unavailableEndpointTraversalOutput() {
  return {
    root: { service: ":1.42", path: "/org/a11y/atspi/accessible/root" },
    nodes: [],
    limits: {
      max_depth: 2,
      max_nodes: 64,
      max_children_per_node: 8,
    },
    truncated: false,
    unavailable_reason: "atspi_bus_address_unavailable",
    text_content_included: false,
    withheld_fields: ["name", "description", "text", "states", "actions"],
  };
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

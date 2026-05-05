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
    },
  );
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
  body,
} = {}) {
  return invokeHandler(makeHandler({ harness, runtimeProfiles: profiles, modelClient }), {
    method,
    url,
    body,
  });
}

function makeHandler({
  harness = allowedHarness,
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
} = {}) {
  return createRequestHandler({
    harness,
    moduleRegistry: modules,
    runtimeProfiles: profiles,
    modelClient,
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

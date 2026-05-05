import assert from "node:assert/strict";
import test from "node:test";

import { parseCli, runCli } from "../src/cli.js";

test("parseCli reads command, flags, and default URL", () => {
  const parsed = parseCli([
    "node",
    "soma",
    "chat",
    "hello",
    "--memory",
    "--max-tokens",
    "12",
    "--url",
    "http://127.0.0.1:9999",
  ]);

  assert.equal(parsed.command, "chat");
  assert.equal(parsed.subcommand, "hello");
  assert.equal(parsed.flags.memory, true);
  assert.equal(parsed.flags["max-tokens"], "12");
  assert.equal(parsed.baseUrl, "http://127.0.0.1:9999");
});

test("runCli status gathers operator summary", async () => {
  const writes = [];
  const code = await runCli(parseCli(["node", "soma", "status"]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, _method, path) => {
      if (path === "/health") {
        return { status: "ok" };
      }
      if (path === "/harness") {
        return {
          harness_id: "soma.base",
          mode: "local_text",
          runtime_profiles: { default_profile: "local-test" },
        };
      }
      if (path === "/harness-modules") {
        return { active_modules: ["pause-local-chat"], pending_capability_proposals: 2 };
      }
      if (path === "/provenance/summary") {
        return { summary: { total: 3 } };
      }
      throw new Error(`Unexpected path ${path}`);
    },
  });

  assert.equal(code, 0);
  const payload = JSON.parse(writes.join(""));
  assert.equal(payload.health.status, "ok");
  assert.equal(payload.harness_id, "soma.base");
  assert.deepEqual(payload.active_modules, ["pause-local-chat"]);
  assert.equal(payload.pending_capability_proposals, 2);
  assert.equal(payload.provenance_summary.total, 3);
});

test("runCli chat sends expected request body", async () => {
  let captured;
  const writes = [];

  const code = await runCli(parseCli([
    "node",
    "soma",
    "chat",
    "hello world",
    "--memory",
    "--write-memory",
    "--assess-load",
    "--max-tokens",
    "10",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return { text: "ok" };
    },
  });

  assert.equal(code, 0);
  assert.equal(writes.join(""), "ok\n");
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/chat");
  assert.deepEqual(captured.body.messages, [{ role: "user", content: "hello world" }]);
  assert.equal(captured.body.use_session_memory, true);
  assert.equal(captured.body.write_session_memory, true);
  assert.equal(captured.body.assess_cognitive_load, true);
  assert.equal(captured.body.max_tokens, 10);
});

test("runCli provenance list builds filters", async () => {
  let capturedPath = "";
  const writes = [];
  await runCli(parseCli([
    "node",
    "soma",
    "provenance",
    "list",
    "--allowed",
    "false",
    "--event-type",
    "harness.module.adopted",
    "--limit",
    "5",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, _method, path) => {
      capturedPath = path;
      return {
        entries: [
          {
            id: "prov-1",
            timestamp: "2026-05-05T00:00:00.000Z",
            event_type: "desktop.inspect.accessibility_tree",
            capability: "desktop.inspect.accessibility_tree",
            allowed: true,
            inspection_mode: "read_only_atspi_probe",
            requested_mode: "atspi",
            requested_max_apps: 2,
            requested_max_children: 1,
            application_count: 2,
            root_object_available_count: 2,
          },
        ],
      };
    },
  });

  assert.equal(capturedPath, "/provenance?allowed=false&event_type=harness.module.adopted&limit=5");
  assert.match(writes.join(""), /Provenance entries/);
  assert.match(writes.join(""), /desktop\.inspect\.accessibility_tree/);
  assert.match(writes.join(""), /max_apps=2/);
  assert.match(writes.join(""), /apps=2/);
});

test("runCli provenance summary prints operator summary", async () => {
  const writes = [];
  const code = await runCli(parseCli(["node", "soma", "provenance", "summary"]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path) => {
      assert.equal(method, "GET");
      assert.equal(path, "/provenance/summary");
      return {
        summary: {
          total: 4,
          allowed: 3,
          denied: 1,
          memory_read: 1,
          memory_written: 2,
          remote_service_used: 0,
          cognitive_load_assessed: 1,
          by_capability: {
            "desktop.inspect.accessibility_tree": 1,
            "model.local.chat": 2,
          },
          by_event_type: {
            "desktop.inspect.accessibility_tree": 1,
          },
        },
      };
    },
  });

  assert.equal(code, 0);
  assert.match(writes.join(""), /Provenance summary/);
  assert.match(writes.join(""), /total: 4/);
  assert.match(writes.join(""), /denied: 1/);
  assert.match(writes.join(""), /desktop\.inspect\.accessibility_tree: 1/);
});

test("runCli proposals list prints pending proposals", async () => {
  let capturedPath = "";
  const writes = [];
  const code = await runCli(parseCli(["node", "soma", "proposals", "list", "--status", "pending"]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path) => {
      assert.equal(method, "GET");
      capturedPath = path;
      return {
        proposals: [
          {
            id: "proposal-1",
            status: "pending",
            requested_by: "assistant",
            capability: "desktop.inspect.focus",
            requested_scope: "session",
            reason: "Need focused object role.",
            risk: "May reveal active application context.",
            fallback: "Continue with desktop summary.",
            data_exposed: ["focused object role"],
          },
        ],
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(capturedPath, "/capability-proposals?status=pending");
  assert.match(writes.join(""), /Capability proposals/);
  assert.match(writes.join(""), /desktop\.inspect\.focus/);
  assert.match(writes.join(""), /reason: Need focused object role\./);
});

test("runCli proposals approve sends decision request", async () => {
  let captured;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "proposals",
    "approve",
    "proposal-1",
    "--scope",
    "session",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        proposal: { id: "proposal-1", status: "approved", capability: "desktop.inspect.focus" },
        decision: { decision: "approved", approved_scope: "session" },
        activation_performed: false,
        provenance_id: "prov-1",
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/capability-proposals/proposal-1/approve");
  assert.deepEqual(captured.body, { approved_scope: "session", decided_by: "user" });
  assert.match(writes.join(""), /status: approved/);
  assert.match(writes.join(""), /activation performed: no/);
});

test("runCli proposals deny sends decision request", async () => {
  let captured;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "proposals",
    "deny",
    "proposal-1",
    "--reason",
    "Not needed.",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        proposal: { id: "proposal-1", status: "denied", capability: "desktop.inspect.focus" },
        decision: { decision: "denied", denial_reason: "Not needed." },
        activation_performed: false,
        provenance_id: "prov-1",
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/capability-proposals/proposal-1/deny");
  assert.deepEqual(captured.body, { reason: "Not needed.", decided_by: "user" });
  assert.match(writes.join(""), /status: denied/);
  assert.match(writes.join(""), /denial reason: Not needed\./);
});

test("runCli files read sends expected request body", async () => {
  let captured;
  const writes = [];

  const code = await runCli(parseCli(["node", "soma", "files", "read", "README.md"]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, requestPath, body) => {
      captured = { method, requestPath, body };
      return { content: "readme text" };
    },
  });

  assert.equal(code, 0);
  assert.equal(writes.join(""), "readme text\n");
  assert.equal(captured.method, "POST");
  assert.equal(captured.requestPath, "/files/read");
  assert.deepEqual(captured.body, { path: "README.md" });
});

test("runCli desktop inspect calls accessibility-tree endpoint", async () => {
  let captured;
  const writes = [];

  await runCli(parseCli([
    "node",
    "soma",
    "desktop",
    "inspect",
    "--mode",
    "atspi",
    "--max-apps",
    "2",
    "--max-children",
    "1",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, requestPath, body) => {
      captured = { method, requestPath, body };
      return {
        provenance_id: "prov-1",
        inspection: {
          mode: "read_only_atspi_probe",
          broker_source: "rust_helper",
          desktop_session: "GNOME",
          session_type: "wayland",
          application_count: 2,
          root_object_available_count: 1,
          window_count: 0,
          tree_available: true,
          tree: {
            text_content_included: false,
            applications: [
              {
                root_object: {
                  child_metadata_sample: [
                    { role: "frame", child_count: 0 },
                  ],
                },
              },
              { root_object: null },
            ],
          },
        },
      };
    },
  });

  assert.equal(captured.method, "POST");
  assert.equal(captured.requestPath, "/desktop/inspect/accessibility-tree");
  assert.deepEqual(captured.body, { mode: "atspi", max_apps: 2, max_children: 1 });
  assert.match(writes.join(""), /Desktop inspection/);
  assert.match(writes.join(""), /applications: 2/);
  assert.match(writes.join(""), /root objects: 1/);
  assert.match(writes.join(""), /shallow child metadata: 1/);
  assert.match(writes.join(""), /text content included: no/);
  assert.match(writes.join(""), /provenance: prov-1/);
});

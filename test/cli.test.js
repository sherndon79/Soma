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
        return { active_modules: ["pause-local-chat"] };
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

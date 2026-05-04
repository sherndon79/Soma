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
    stdout: { write() {} },
    request: async (_baseUrl, _method, path) => {
      capturedPath = path;
      return { entries: [] };
    },
  });

  assert.equal(capturedPath, "/provenance?allowed=false&event_type=harness.module.adopted&limit=5");
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

  await runCli(parseCli(["node", "soma", "desktop", "inspect"]), {
    stdout: { write() {} },
    request: async (_baseUrl, method, requestPath, body) => {
      captured = { method, requestPath, body };
      return { inspection: { mode: "read_only_environment_probe" } };
    },
  });

  assert.equal(captured.method, "POST");
  assert.equal(captured.requestPath, "/desktop/inspect/accessibility-tree");
  assert.deepEqual(captured.body, {});
});

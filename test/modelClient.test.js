import assert from "node:assert/strict";
import test from "node:test";

import { ModelClient } from "../src/modelClient.js";

test("ModelClient maps anthropic-messages chat without logging or configuring the key", async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  const previousVersion = process.env.ANTHROPIC_VERSION;
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  process.env.ANTHROPIC_VERSION = "2026-01-01";
  try {
    let captured;
    const client = new ModelClient({
      baseUrl: "https://api.anthropic.test/",
      model: "claude-test-model",
      runtime: "anthropic-messages",
      async fetchImpl(url, options) {
        captured = { url, options };
        return {
          ok: true,
          async json() {
            return {
              model: "claude-test-model",
              stop_reason: "end_turn",
              content: [
                { type: "text", text: "hello" },
                { type: "tool_use", name: "not-enabled" },
                { type: "text", text: " world" },
              ],
              usage: {
                input_tokens: 3,
                output_tokens: 4,
              },
            };
          },
        };
      },
    });

    const result = await client.chat({
      messages: [
        { role: "system", content: "system posture" },
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ],
      maxTokens: 32,
      temperature: 0.2,
    });

    assert.equal(captured.url, "https://api.anthropic.test/v1/messages");
    assert.equal(captured.options.method, "POST");
    assert.equal(captured.options.headers["x-api-key"], "test-anthropic-key");
    assert.equal(captured.options.headers["anthropic-version"], "2026-01-01");
    const body = JSON.parse(captured.options.body);
    assert.equal(body.system, "system posture");
    assert.equal(body.model, "claude-test-model");
    assert.equal(body.max_tokens, 32);
    assert.equal(body.temperature, 0.2);
    assert.deepEqual(body.messages, [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
    assert.equal(result.text, "hello world");
    assert.equal(result.model, "claude-test-model");
    assert.equal(result.finish_reason, "end_turn");
    assert.equal(result.tokens_used, 7);
  } finally {
    restoreEnv("ANTHROPIC_API_KEY", previousKey);
    restoreEnv("ANTHROPIC_VERSION", previousVersion);
  }
});

test("ModelClient refuses anthropic-messages chat when ANTHROPIC_API_KEY is missing", async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    let calls = 0;
    const client = new ModelClient({
      baseUrl: "https://api.anthropic.test",
      model: "claude-test-model",
      runtime: "anthropic-messages",
      async fetchImpl() {
        calls += 1;
        return { ok: true };
      },
    });

    await assert.rejects(
      () => client.chat({ messages: [{ role: "user", content: "hello" }] }),
      (error) => {
        assert.equal(error.code, "anthropic_api_key_missing");
        assert.equal(error.statusCode, 503);
        return true;
      },
    );
    assert.equal(calls, 0);
  } finally {
    restoreEnv("ANTHROPIC_API_KEY", previousKey);
  }
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

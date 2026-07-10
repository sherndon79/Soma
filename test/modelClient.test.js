import assert from "node:assert/strict";
import test from "node:test";

import { ModelClient } from "../src/modelClient.js";

test("ModelClient coalesces system messages for openai-compatible chat templates", async () => {
  let captured;
  const client = new ModelClient({
    baseUrl: "http://model.test/",
    model: "strict-template-model",
    async fetchImpl(url, options) {
      captured = { url, options };
      return {
        ok: true,
        async json() {
          return {
            model: "strict-template-model",
            choices: [
              {
                message: { content: "ok" },
                finish_reason: "stop",
              },
            ],
            usage: { total_tokens: 9 },
          };
        },
      };
    },
  });

  const result = await client.chat({
    messages: [
      { role: "system", content: "briefing" },
      { role: "system", content: "held grants" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
      { role: "user", content: "task" },
    ],
    maxTokens: 64,
    temperature: 0.3,
  });

  assert.equal(captured.url, "http://model.test/v1/chat/completions");
  const body = JSON.parse(captured.options.body);
  assert.deepEqual(body.messages, [
    { role: "system", content: "briefing\n\nheld grants" },
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi" },
    { role: "user", content: "task" },
  ]);
  assert.equal(body.max_tokens, 64);
  assert.equal(body.temperature, 0.3);
  assert.equal(result.text, "ok");
  assert.equal(result.tokens_used, 9);
});

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
    assert.ok(!("temperature" in body), "temperature must be omitted on the Anthropic path (deprecated for newer models)");
    assert.deepEqual(body.messages, [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
    assert.equal(result.text, "hello world");
    assert.equal(result.model, "claude-test-model");
    assert.equal(result.finish_reason, "end_turn");
    assert.equal(result.tokens_used, 7);
    assert.deepEqual(result.transport_telemetry, {
      upstream_stop_reason: "end_turn",
      content_block_count: 3,
      content_block_types: { text: 2, tool_use: 1 },
      assembled_text_length: 11,
      input_tokens: 3,
      output_tokens: 4,
    });
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

test("ModelClient sends color attachments as typed OpenAI-compatible image content", async () => {
  let captured;
  const client = new ModelClient({
    baseUrl: "http://model.test/",
    model: "vision-model",
    async fetchImpl(url, options) {
      captured = { url, options };
      return {
        ok: true,
        async json() {
          return {
            model: "vision-model",
            choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
            usage: { total_tokens: 5 },
          };
        },
      };
    },
  });

  const result = await client.chatWithVisualAttachments({
    messages: [{ role: "user", content: "look once" }],
    attachments: [
      {
        modality: "color",
        media_type: "image/jpeg",
        payload_bytes: Uint8Array.from([1, 2, 3]),
      },
    ],
    visualAttachmentSchema: "openai_chat_image_url",
  });

  assert.equal(captured.url, "http://model.test/v1/chat/completions");
  const body = JSON.parse(captured.options.body);
  assert.deepEqual(body.messages, [
    {
      role: "user",
      content: [
        { type: "text", text: "look once" },
        {
          type: "image_url",
          image_url: {
            url: "data:image/jpeg;base64,AQID",
            detail: "auto",
          },
        },
      ],
    },
  ]);
  assert.equal(result.text, "ok");
});

test("ModelClient sends depth attachments only through explicit Soma typed multimodal schema", async () => {
  let captured;
  const client = new ModelClient({
    baseUrl: "http://model.test/",
    model: "depth-model",
    async fetchImpl(url, options) {
      captured = { url, options };
      return {
        ok: true,
        async json() {
          return {
            model: "depth-model",
            choices: [{ message: { content: "depth ok" }, finish_reason: "stop" }],
            usage: { total_tokens: 6 },
          };
        },
      };
    },
  });

  await client.chatWithVisualAttachments({
    messages: [{ role: "user", content: "depth once" }],
    attachments: [
      {
        modality: "depth",
        media_type: "application/vnd.soma.depth+png",
        payload_bytes: Uint8Array.from([4, 5, 6]),
      },
    ],
    visualAttachmentSchema: "soma_typed_multimodal",
  });

  const body = JSON.parse(captured.options.body);
  assert.deepEqual(body.messages[0].content, [
    { type: "text", text: "depth once" },
    {
      type: "input_depth",
      source: {
        type: "base64",
        media_type: "application/vnd.soma.depth+png",
        data: "BAUG",
      },
    },
  ]);
});

test("ModelClient sends colorized depth PNG as an image block for Anthropic schemas", async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  try {
    let captured;
    const client = new ModelClient({
      runtime: "anthropic-messages",
      model: "claude-depth",
      async fetchImpl(url, options) {
        captured = { url, options };
        return {
          ok: true,
          async json() {
            return {
              model: "claude-depth",
              content: [{ type: "text", text: "depth ok" }],
              stop_reason: "end_turn",
              usage: { input_tokens: 3, output_tokens: 4 },
            };
          },
        };
      },
    });

    await client.chatWithVisualAttachments({
      messages: [{ role: "user", content: "depth once" }],
      attachments: [
        {
          modality: "depth",
          media_type: "image/png",
          payload_bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
        },
      ],
      visualAttachmentSchema: "anthropic_messages_image",
    });

    const body = JSON.parse(captured.options.body);
    assert.deepEqual(body.messages[0].content, [
      { type: "text", text: "depth once" },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "iVBORw==",
        },
      },
    ]);
  } finally {
    restoreEnv("ANTHROPIC_API_KEY", previousKey);
  }
});

test("ModelClient sends pose JSON as a separate labeled Anthropic text block", async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  try {
    let captured;
    const client = new ModelClient({
      runtime: "anthropic-messages",
      model: "claude-pose",
      async fetchImpl(url, options) {
        captured = { url, options };
        return {
          ok: true,
          async json() {
            return {
              model: "claude-pose",
              content: [{ type: "text", text: "pose ok" }],
              stop_reason: "end_turn",
              usage: { input_tokens: 3, output_tokens: 4 },
            };
          },
        };
      },
    });

    await client.chatWithVisualAttachments({
      messages: [{ role: "user", content: "pose once" }],
      attachments: [
        {
          modality: "pose",
          media_type: "application/vnd.soma.pose+json",
          payload_bytes: new TextEncoder().encode("{\"schema\":\"perception.pose.contract.v0.2\"}"),
        },
      ],
      visualAttachmentSchema: "anthropic_messages_image",
    });

    const body = JSON.parse(captured.options.body);
    assert.equal(body.messages[0].content.length, 2);
    assert.deepEqual(body.messages[0].content[0], { type: "text", text: "pose once" });
    assert.equal(body.messages[0].content[1].type, "text");
    assert.match(body.messages[0].content[1].text, /^SOMA_VISUAL_ATTACHMENT_BEGIN\nrepresentation: pose_json/m);
    assert.match(body.messages[0].content[1].text, /media_type: application\/vnd\.soma\.pose\+json/);
    assert.match(body.messages[0].content[1].text, /identity-adjacent body, face, and hand keypoints/);
    assert.match(body.messages[0].content[1].text, /payload_json:\n\{"schema":"perception\.pose\.contract\.v0\.2"\}/);
    assert.match(body.messages[0].content[1].text, /SOMA_VISUAL_ATTACHMENT_END$/);
  } finally {
    restoreEnv("ANTHROPIC_API_KEY", previousKey);
  }
});

test("ModelClient refuses depth attachments on image-url schemas before fetch", async () => {
  let calls = 0;
  const client = new ModelClient({
    async fetchImpl() {
      calls += 1;
      return { ok: true };
    },
  });

  await assert.rejects(
    () => client.chatWithVisualAttachments({
      messages: [{ role: "user", content: "depth once" }],
      attachments: [
        {
          modality: "depth",
          media_type: "application/vnd.soma.depth+png",
          payload_bytes: Uint8Array.from([4, 5, 6]),
        },
      ],
      visualAttachmentSchema: "openai_chat_image_url",
    }),
    (error) => {
      assert.equal(error.code, "visual_attachment_schema_unsupported");
      return true;
    },
  );
  assert.equal(calls, 0);
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

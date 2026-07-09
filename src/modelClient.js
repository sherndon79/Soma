const DEFAULT_MODEL_URL = "http://127.0.0.1:8000";
const DEFAULT_MODEL = "ciocan/gemma-4-E4B-it-W4A16";
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

export class ModelClient {
  constructor({
    baseUrl = process.env.SOMA_LLM_URL ?? DEFAULT_MODEL_URL,
    model = process.env.SOMA_LLM_MODEL ?? DEFAULT_MODEL,
    runtime = "openai-compatible-http",
    fetchImpl = fetch,
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.runtime = runtime;
    this.fetch = fetchImpl;
  }

  async chat({ messages, maxTokens = 512, temperature = 0.7, model = this.model }) {
    if (this.runtime === "anthropic-messages") {
      return this.#anthropicMessagesChat({ messages, maxTokens, temperature, model });
    }
    return this.#openAiCompatibleChat({ messages, maxTokens, temperature, model });
  }

  async chatWithVisualAttachments({
    messages,
    attachments,
    maxTokens = 512,
    temperature = 0.7,
    model = this.model,
    visualAttachmentSchema = "",
  }) {
    const normalizedAttachments = normalizeVisualAttachments(attachments);
    const schema = String(visualAttachmentSchema ?? "").trim();
    if (this.runtime === "anthropic-messages") {
      if (schema !== "anthropic_messages_image") {
        throw unsupportedVisualSchema(schema);
      }
      return this.#anthropicMessagesChat({
        messages: buildAnthropicVisualMessages(messages, normalizedAttachments),
        maxTokens,
        temperature,
        model,
        contentAlreadyTyped: true,
      });
    }
    if (schema === "openai_chat_image_url") {
      return this.#openAiCompatibleChat({
        messages: buildOpenAiImageUrlMessages(messages, normalizedAttachments),
        maxTokens,
        temperature,
        model,
        contentAlreadyTyped: true,
      });
    }
    if (schema === "soma_typed_multimodal") {
      return this.#openAiCompatibleChat({
        messages: buildSomaTypedVisualMessages(messages, normalizedAttachments),
        maxTokens,
        temperature,
        model,
        contentAlreadyTyped: true,
      });
    }
    throw unsupportedVisualSchema(schema);
  }

  async #openAiCompatibleChat({ messages, maxTokens, temperature, model, contentAlreadyTyped = false }) {
    const normalizedMessages = contentAlreadyTyped ? messages : coalesceSystemMessages(messages);
    const response = await this.fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer not-needed",
      },
      body: JSON.stringify({
        model,
        messages: normalizedMessages,
        max_tokens: maxTokens,
        temperature,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const error = new Error(`Local model request failed with HTTP ${response.status}.`);
      error.statusCode = 502;
      error.code = "local_model_error";
      error.detail = body;
      throw error;
    }

    const data = await response.json();
    return {
      text: data.choices?.[0]?.message?.content ?? "",
      model: data.model ?? model,
      finish_reason: data.choices?.[0]?.finish_reason ?? "unknown",
      tokens_used: data.usage?.total_tokens ?? 0,
    };
  }

  async #anthropicMessagesChat({ messages, maxTokens, model, contentAlreadyTyped = false }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      const error = new Error("Anthropic API key is not configured.");
      error.statusCode = 503;
      error.code = "anthropic_api_key_missing";
      throw error;
    }

    const { system, messages: anthropicMessages } = contentAlreadyTyped
      ? toAnthropicTypedMessages(messages)
      : toAnthropicMessages(messages);
    // Newer Anthropic models (e.g. Opus 4.8) reject the deprecated `temperature`
    // parameter, returning HTTP 400. Omit it on the Anthropic path.
    const body = {
      model,
      messages: anthropicMessages,
      max_tokens: maxTokens,
    };
    if (system) {
      body.system = system;
    }

    const response = await this.fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": process.env.ANTHROPIC_VERSION ?? DEFAULT_ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      const error = new Error(`Anthropic model request failed with HTTP ${response.status}.`);
      error.statusCode = 502;
      error.code = "anthropic_model_error";
      error.detail = bodyText;
      throw error;
    }

    const data = await response.json();
    const text = anthropicText(data.content);
    return {
      text,
      model: data.model ?? model,
      finish_reason: data.stop_reason ?? "unknown",
      tokens_used: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      // Content-free transport telemetry (drawer-run finding: emission losses must be
      // diagnosable at the seam, never default-attributed to occupant attention).
      transport_telemetry: {
        upstream_stop_reason: data.stop_reason ?? "unknown",
        content_block_count: Array.isArray(data.content) ? data.content.length : 0,
        content_block_types: anthropicBlockTypeCounts(data.content),
        assembled_text_length: text.length,
        input_tokens: data.usage?.input_tokens ?? 0,
        output_tokens: data.usage?.output_tokens ?? 0,
      },
    };
  }

  withProfile(profile) {
    return new ModelClient({
      baseUrl: profile.endpoint ?? this.baseUrl,
      model: profile.model ?? this.model,
      runtime: profile.runtime ?? this.runtime,
      fetchImpl: this.fetch,
    });
  }
}

function toAnthropicMessages(messages = []) {
  const normalizedMessages = coalesceSystemMessages(messages);
  const system = [];
  const mapped = [];
  for (const message of normalizedMessages) {
    const role = String(message?.role ?? "").trim();
    const content = String(message?.content ?? "");
    if (role === "system") {
      system.push(content);
      continue;
    }
    mapped.push({
      role: role === "assistant" ? "assistant" : "user",
      content,
    });
  }
  return {
    system: system.join("\n\n"),
    messages: mapped,
  };
}

function toAnthropicTypedMessages(messages = []) {
  const system = [];
  const mapped = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const role = String(message?.role ?? "").trim();
    if (role === "system") {
      const text = textFromTypedContent(message.content);
      if (text) {
        system.push(text);
      }
      continue;
    }
    mapped.push({
      role: role === "assistant" ? "assistant" : "user",
      content: Array.isArray(message?.content) ? message.content : [{ type: "text", text: String(message?.content ?? "") }],
    });
  }
  return {
    system: system.join("\n\n"),
    messages: mapped,
  };
}

export function coalesceSystemMessages(messages = []) {
  const systemContents = [];
  const nonSystemMessages = [];
  let firstSystemIndex = -1;
  for (const [index, message] of (Array.isArray(messages) ? messages : []).entries()) {
    const role = String(message?.role ?? "").trim();
    const content = String(message?.content ?? "");
    if (role === "system") {
      if (firstSystemIndex < 0) {
        firstSystemIndex = index;
      }
      systemContents.push(content);
      continue;
    }
    nonSystemMessages.push({
      role,
      content,
    });
  }
  if (systemContents.length === 0) {
    return nonSystemMessages;
  }
  const systemMessage = {
    role: "system",
    content: systemContents.join("\n\n"),
  };
  if (firstSystemIndex <= 0) {
    return [systemMessage, ...nonSystemMessages];
  }
  const beforeSystem = messages
    .slice(0, firstSystemIndex)
    .filter((message) => String(message?.role ?? "").trim() !== "system")
    .map((message) => ({
      role: String(message?.role ?? "").trim(),
      content: String(message?.content ?? ""),
    }));
  const afterSystem = nonSystemMessages.slice(beforeSystem.length);
  return [...beforeSystem, systemMessage, ...afterSystem];
}

function normalizeVisualAttachments(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length !== 1) {
    throw invalidVisualAttachment("exactly one visual attachment is required");
  }
  const attachment = attachments[0];
  const modality = String(attachment?.modality ?? "").trim();
  const mediaType = String(attachment?.media_type ?? "").trim();
  const payload = attachment?.payload_bytes;
  if (!["color", "depth", "pose"].includes(modality)) {
    throw invalidVisualAttachment("visual attachment modality must be color, depth, or pose");
  }
  if (!(payload instanceof Uint8Array) || payload.byteLength === 0) {
    throw invalidVisualAttachment("visual attachment payload must be non-empty bytes");
  }
  if (!mediaType) {
    throw invalidVisualAttachment("visual attachment media_type is required");
  }
  return [
    {
      modality,
      media_type: mediaType,
      payload_bytes: new Uint8Array(payload),
    },
  ];
}

function buildOpenAiImageUrlMessages(messages = [], attachments = []) {
  const attachment = attachments[0];
  if (attachment.modality !== "color") {
    throw unsupportedVisualSchema("openai_chat_image_url");
  }
  return appendTypedContentToLastUserMessage(messages, {
    type: "image_url",
    image_url: {
      url: dataUrl(attachment),
      detail: "auto",
    },
  });
}

function buildAnthropicVisualMessages(messages = [], attachments = []) {
  const attachment = attachments[0];
  if (attachment.modality !== "color") {
    throw unsupportedVisualSchema("anthropic_messages_image");
  }
  return appendTypedContentToLastUserMessage(messages, {
    type: "image",
    source: {
      type: "base64",
      media_type: attachment.media_type,
      data: base64Payload(attachment.payload_bytes),
    },
  });
}

function buildSomaTypedVisualMessages(messages = [], attachments = []) {
  const attachment = attachments[0];
  const blockType = attachment.modality === "depth"
    ? "input_depth"
    : attachment.modality === "pose"
      ? "input_pose"
      : "input_image";
  return appendTypedContentToLastUserMessage(messages, {
    type: blockType,
    source: {
      type: "base64",
      media_type: attachment.media_type,
      data: base64Payload(attachment.payload_bytes),
    },
  });
}

function appendTypedContentToLastUserMessage(messages = [], visualBlock) {
  const normalized = coalesceSystemMessages(messages).map((message) => ({
    role: String(message?.role ?? "").trim(),
    content: [{ type: "text", text: String(message?.content ?? "") }],
  }));
  const lastUserIndex = normalized.map((message) => message.role).lastIndexOf("user");
  if (lastUserIndex < 0) {
    throw invalidVisualAttachment("a user message is required for visual attachment");
  }
  return normalized.map((message, index) => (
    index === lastUserIndex
      ? { ...message, content: [...message.content, visualBlock] }
      : message
  ));
}

function textFromTypedContent(content) {
  if (Array.isArray(content)) {
    return content
      .filter((block) => block?.type === "text")
      .map((block) => String(block.text ?? ""))
      .join("\n");
  }
  return String(content ?? "");
}

function dataUrl(attachment) {
  return `data:${attachment.media_type};base64,${base64Payload(attachment.payload_bytes)}`;
}

function base64Payload(payload) {
  return Buffer.from(payload).toString("base64");
}

function invalidVisualAttachment(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = "invalid_visual_attachment";
  return error;
}

function unsupportedVisualSchema(schema) {
  const error = new Error(`Visual attachment schema ${schema || "(missing)"} is not supported for this runtime.`);
  error.statusCode = 400;
  error.code = "visual_attachment_schema_unsupported";
  return error;
}

function anthropicText(content = []) {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((block) => block?.type === "text")
    .map((block) => String(block.text ?? ""))
    .join("");
}

function anthropicBlockTypeCounts(content = []) {
  if (!Array.isArray(content)) {
    return {};
  }
  const counts = {};
  for (const block of content) {
    const type = String(block?.type ?? "unknown");
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

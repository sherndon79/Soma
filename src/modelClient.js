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

  async #openAiCompatibleChat({ messages, maxTokens, temperature, model }) {
    const response = await this.fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer not-needed",
      },
      body: JSON.stringify({
        model,
        messages,
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

  async #anthropicMessagesChat({ messages, maxTokens, model }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      const error = new Error("Anthropic API key is not configured.");
      error.statusCode = 503;
      error.code = "anthropic_api_key_missing";
      throw error;
    }

    const { system, messages: anthropicMessages } = toAnthropicMessages(messages);
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
  const system = [];
  const mapped = [];
  for (const message of messages) {
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

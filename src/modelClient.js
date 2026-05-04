const DEFAULT_MODEL_URL = "http://127.0.0.1:8000";
const DEFAULT_MODEL = "ciocan/gemma-4-E4B-it-W4A16";

export class ModelClient {
  constructor({
    baseUrl = process.env.SOMA_LLM_URL ?? DEFAULT_MODEL_URL,
    model = process.env.SOMA_LLM_MODEL ?? DEFAULT_MODEL,
    fetchImpl = fetch,
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.fetch = fetchImpl;
  }

  async chat({ messages, maxTokens = 512, temperature = 0.7, model = this.model }) {
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

  withProfile(profile) {
    return new ModelClient({
      baseUrl: profile.endpoint ?? this.baseUrl,
      model: profile.model ?? this.model,
      fetchImpl: this.fetch,
    });
  }
}

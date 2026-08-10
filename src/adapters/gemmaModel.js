/**
 * I-3b Gemma model adapter — transcript (text) -> {answerText} via vLLM OpenAI-compatible API.
 * Fail-closed: non-2xx / timeout / network / malformed -> typed throw.
 * Text-in only, never PCM.
 */
import { getLocalServiceEndpoints } from "../localServiceHealth.js";

const DEFAULT_MODEL = "ciocan/gemma-4-E4B-it-W4A16";
const DEFAULT_SYSTEM_PROMPT = "You are Soma, a helpful local assistant. Answer concisely.";

export function createGemmaModelAdapter({ fetchImpl = fetch, endpoint, model, systemPrompt, maxTokens = 512, temperature = 0.7 } = {}) {
  const endpoints = getLocalServiceEndpoints();
  const ep = endpoint ?? endpoints.gemma ?? endpoints.llm;
  const url = typeof ep === "string" ? ep : ep?.url ?? "http://127.0.0.1:8000";
  const base = String(url).replace(/\/$/, "");
  const modelId = model ?? (typeof ep === "object" && ep?.model ? ep.model : endpoints.llmModel ?? DEFAULT_MODEL) ?? DEFAULT_MODEL;
  const sysPrompt = systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  async function modelFn(transcript, { utteranceId, signal, timeoutMs = 15000, maxTokens: mt, temperature: temp } = {}) {
    if (typeof transcript !== "string") {
      const e = new Error("Gemma model adapter requires transcript text, never PCM");
      e.code = "model_failed";
      throw e;
    }
    // guard against PCM being passed accidentally (Buffer / Uint8Array)
    if (Buffer.isBuffer(transcript) || transcript instanceof Uint8Array) {
      const e = new Error("Gemma model adapter must not receive PCM bytes");
      e.code = "model_failed";
      throw e;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    const messages = [
      { role: "system", content: sysPrompt },
      { role: "user", content: String(transcript) },
    ];

    let res;
    try {
      res = await fetchImpl(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: modelId,
          messages,
          max_tokens: mt ?? maxTokens,
          temperature: temp ?? temperature,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const e = new Error(`Gemma model unavailable: ${String(err.message ?? err)}`);
      e.code = err && err.name === "AbortError" ? "model_unavailable" : "model_unavailable";
      e.cause = err;
      throw e;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const e = new Error(`Gemma model failed: HTTP ${res.status} ${body}`);
      e.code = res.status >= 500 || res.status === 429 ? "model_unavailable" : "model_failed";
      e.status = res.status;
      throw e;
    }

    let json;
    try {
      json = await res.json();
    } catch (err) {
      const e = new Error(`Gemma model malformed response: ${String(err.message)}`);
      e.code = "model_failed";
      throw e;
    }
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      const e = new Error("Gemma model malformed response: missing content");
      e.code = "model_failed";
      throw e;
    }
    // empty content is allowed as valid (could be model returned empty), but fail-closed tests check for missing content, not empty string
    return { answerText: content, raw: json, utteranceId, model: json.model ?? modelId };
  }

  return modelFn;
}

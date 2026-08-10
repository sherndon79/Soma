/**
 * I-2 local service reachability — endpoint config + health check.
 * Endpoints are config-driven (env), not hard-coded. Fail-closed if any down.
 */

const DEFAULT_WHISPER_URL = "http://127.0.0.1:4001";
const DEFAULT_KOKORO_URL = "http://127.0.0.1:4010";
const DEFAULT_LLM_URL = "http://127.0.0.1:8000";

export function getLocalServiceEndpoints(env = process.env) {
  const whisperUrl = (env.SOMA_WHISPER_URL ?? env.WHISPER_URL ?? DEFAULT_WHISPER_URL).replace(/\/$/, "");
  const kokoroUrl = (env.SOMA_KOKORO_URL ?? env.KOKORO_URL ?? DEFAULT_KOKORO_URL).replace(/\/$/, "");
  const llmUrl = (env.SOMA_LLM_URL ?? DEFAULT_LLM_URL).replace(/\/$/, "");
  const llmModel = env.SOMA_LLM_MODEL ?? env.LLM_MODEL ?? "ciocan/gemma-4-E4B-it-W4A16";
  return {
    whisper: { url: whisperUrl, healthPath: "/health" },
    kokoro: { url: kokoroUrl, healthPath: "/health" },
    gemma: { url: llmUrl, healthPath: "/health", model: llmModel },
  };
}

function healthUrl(endpoint) {
  return `${endpoint.url}${endpoint.healthPath}`;
}

/**
 * Check all three local services. Returns { ok, services: {whisper,kokoro,gemma}, errors }.
 * Fail-closed: ok is false if any service is not 2xx.
 * Does not throw on failure except for programmer errors; errors are collected.
 * fetchImpl defaults to global fetch.
 */
export async function checkLocalServiceHealth({ fetchImpl = fetch, endpoints = getLocalServiceEndpoints(), timeoutMs = 3000, signal } = {}) {
  const services = ["whisper", "kokoro", "gemma"];
  const entries = await Promise.all(
    services.map(async (name) => {
      const ep = endpoints[name];
      const url = healthUrl(ep);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      // combine external signal if provided
      if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener("abort", () => controller.abort(), { once: true });
      }
      try {
        const res = await fetchImpl(url, { method: "GET", signal: controller.signal });
        if (!res.ok) {
          return [name, { ok: false, url, status: res.status, error: `HTTP ${res.status}` }];
        }
        return [name, { ok: true, url, status: res.status }];
      } catch (err) {
        const isAbort = err && (err.name === "AbortError" || String(err.message).includes("aborted"));
        return [name, { ok: false, url, error: isAbort ? "timeout or aborted" : String(err.message ?? err) }];
      } finally {
        clearTimeout(timer);
      }
    })
  );
  const servicesResult = Object.fromEntries(entries);
  const errors = Object.entries(servicesResult)
    .filter(([, v]) => !v.ok)
    .map(([k, v]) => `${k}: ${v.error ?? `HTTP ${v.status}` } at ${v.url}`);
  return {
    ok: errors.length === 0,
    services: servicesResult,
    errors,
    // fail-closed error for callers that want a single message
    error: errors.length ? `local services unhealthy: ${errors.join("; ")}` : null,
  };
}

/**
 * Convenience: throw if not healthy (fail-closed).
 */
export async function assertLocalServicesHealthy(opts) {
  const result = await checkLocalServiceHealth(opts);
  if (!result.ok) {
    const err = new Error(result.error);
    err.code = "local_services_unhealthy";
    err.details = result;
    throw err;
  }
  return result;
}

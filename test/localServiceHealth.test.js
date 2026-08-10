import assert from "node:assert/strict";
import test from "node:test";
import { getLocalServiceEndpoints, checkLocalServiceHealth, assertLocalServicesHealthy } from "../src/localServiceHealth.js";

function mockFetch(map) {
  return async (url) => {
    const entry = map[url];
    if (!entry) throw new Error(`unmocked ${url}`);
    if (entry.throws) throw new Error(entry.throws);
    return {
      ok: entry.ok ?? (entry.status >= 200 && entry.status < 300),
      status: entry.status ?? 200,
    };
  };
}

test("endpoints are config-driven with host defaults", () => {
  const eps = getLocalServiceEndpoints({});
  assert.equal(eps.whisper.url, "http://127.0.0.1:4001");
  assert.equal(eps.kokoro.url, "http://127.0.0.1:4010");
  assert.equal(eps.gemma.url, "http://127.0.0.1:8000");
  const eps2 = getLocalServiceEndpoints({ SOMA_WHISPER_URL: "http://whisper-stt:4001", SOMA_KOKORO_URL: "http://kokoro-tts:4010", SOMA_LLM_URL: "http://gemma4-llm:8000" });
  assert.equal(eps2.whisper.url, "http://whisper-stt:4001");
  assert.equal(eps2.kokoro.url, "http://kokoro-tts:4010");
  assert.equal(eps2.gemma.url, "http://gemma4-llm:8000");
});

test("health check reaches all three (2xx)", async () => {
  const endpoints = getLocalServiceEndpoints({});
  const fetchImpl = mockFetch({
    "http://127.0.0.1:4001/health": { status: 200 },
    "http://127.0.0.1:4010/health": { status: 200 },
    "http://127.0.0.1:8000/health": { status: 200 },
  });
  const res = await checkLocalServiceHealth({ fetchImpl, endpoints, timeoutMs: 1000 });
  assert.equal(res.ok, true);
  assert.equal(res.errors.length, 0);
  assert.equal(res.services.whisper.ok, true);
  assert.equal(res.services.kokoro.ok, true);
  assert.equal(res.services.gemma.ok, true);
});

test("unavailable endpoint yields fail-closed error, not crash", async () => {
  const endpoints = getLocalServiceEndpoints({});
  // whisper down, others up
  const fetchImpl = mockFetch({
    "http://127.0.0.1:4001/health": { throws: "ECONNREFUSED" },
    "http://127.0.0.1:4010/health": { status: 200 },
    "http://127.0.0.1:8000/health": { status: 200 },
  });
  const res = await checkLocalServiceHealth({ fetchImpl, endpoints, timeoutMs: 1000 });
  assert.equal(res.ok, false);
  assert.ok(res.error.includes("whisper"));
  assert.ok(res.errors.some((e) => e.includes("whisper")));
  assert.equal(res.services.whisper.ok, false);
  // assertLocalServicesHealthy throws fail-closed
  await assert.rejects(() => assertLocalServicesHealthy({ fetchImpl, endpoints, timeoutMs: 1000 }), (err) => {
    assert.equal(err.code, "local_services_unhealthy");
    return true;
  });
});

test("non-2xx is unhealthy", async () => {
  const endpoints = getLocalServiceEndpoints({});
  const fetchImpl = mockFetch({
    "http://127.0.0.1:4001/health": { status: 200 },
    "http://127.0.0.1:4010/health": { status: 503 },
    "http://127.0.0.1:8000/health": { status: 200 },
  });
  const res = await checkLocalServiceHealth({ fetchImpl, endpoints, timeoutMs: 1000 });
  assert.equal(res.ok, false);
  assert.ok(res.services.kokoro.ok === false);
  assert.equal(res.services.kokoro.status, 503);
});

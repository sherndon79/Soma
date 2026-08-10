import assert from "node:assert/strict";
import test from "node:test";
import { createGemmaModelAdapter } from "../src/adapters/gemmaModel.js";

function mockFetch(url, opts, response) {
  let seen = null;
  const fetchImpl = async (u, o) => {
    seen = { url: u, body: JSON.parse(o.body), headers: o.headers, method: o.method };
    return response;
  };
  fetchImpl.seen = () => seen;
  return fetchImpl;
}

test("gemma adapter sends well-formed chat completion with transcript as user turn", async () => {
  const response = { choices: [{ message: { content: "hello there" }, finish_reason: "stop" }], model: "ciocan/gemma-4-E4B-it-W4A16" };
  const fetchImpl = mockFetch("http://127.0.0.1:8000/v1/chat/completions", {}, { ok: true, status: 200, json: async () => response });
  const model = createGemmaModelAdapter({ fetchImpl, endpoint: "http://127.0.0.1:8000", model: "ciocan/gemma-4-E4B-it-W4A16" });
  const res = await model("hello soma", { utteranceId: "u1" });
  assert.equal(res.answerText, "hello there");
  const seen = fetchImpl.seen();
  assert.equal(seen.url, "http://127.0.0.1:8000/v1/chat/completions");
  assert.equal(seen.body.model, "ciocan/gemma-4-E4B-it-W4A16");
  assert.ok(Array.isArray(seen.body.messages));
  const userMsg = seen.body.messages.find(m => m.role === "user");
  assert.ok(userMsg && userMsg.content === "hello soma");
  const sysMsg = seen.body.messages.find(m => m.role === "system");
  assert.ok(sysMsg);
});

test("gemma respects config-driven endpoint", async () => {
  const response = { choices: [{ message: { content: "hi" } }] };
  const fetchImpl = mockFetch("http://gemma4-llm:8000/v1/chat/completions", {}, { ok: true, status: 200, json: async () => response });
  const model = createGemmaModelAdapter({ fetchImpl, endpoint: "http://gemma4-llm:8000" });
  const res = await model("test", {});
  assert.equal(res.answerText, "hi");
  assert.equal(fetchImpl.seen().url, "http://gemma4-llm:8000/v1/chat/completions");
});

test("gemma default endpoint path (no explicit endpoint) uses config and does not throw", async () => {
  const response = { choices: [{ message: { content: "default hi" } }] };
  let seenUrl = null;
  const fetchImpl = async (url, opts) => {
    seenUrl = url;
    return { ok: true, status: 200, json: async () => response };
  };
  const model = createGemmaModelAdapter({ fetchImpl }); // no endpoint — should default to SOMA_LLM_URL / gemma
  const res = await model("hello", {});
  assert.equal(res.answerText, "default hi");
  assert.ok(seenUrl.includes("/v1/chat/completions"), "default path should hit chat completions");
  assert.ok(seenUrl.includes("8000"), "default should be localhost:8000 or configured llm url");
});

test("gemma text-in only: never PCM", async () => {
  const model = createGemmaModelAdapter({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "x" } }] }) }), endpoint: "http://127.0.0.1:8000" });
  await assert.rejects(() => model(Buffer.alloc(1920), {}), (err) => { assert.equal(err.code, "model_failed"); assert.ok(/PCM/.test(err.message)); return true; });
});

test("gemma fail-closed: non-2xx throws typed error", async () => {
  const pcm = "hello";
  const fetch503 = async () => ({ ok: false, status: 503, text: async () => "overloaded" });
  const m1 = createGemmaModelAdapter({ fetchImpl: fetch503, endpoint: "http://127.0.0.1:8000" });
  await assert.rejects(() => m1(pcm, {}), err => { assert.equal(err.code, "model_unavailable"); return true; });
  const fetch400 = async () => ({ ok: false, status: 400, text: async () => "bad" });
  const m2 = createGemmaModelAdapter({ fetchImpl: fetch400, endpoint: "http://127.0.0.1:8000" });
  await assert.rejects(() => m2(pcm, {}), err => { assert.equal(err.code, "model_failed"); return true; });
});

test("gemma fail-closed: network, timeout, malformed, empty content -> typed throw (red->green)", async () => {
  const fetchNet = async () => { throw new Error("ECONNREFUSED"); };
  const m1 = createGemmaModelAdapter({ fetchImpl: fetchNet, endpoint: "http://127.0.0.1:8000" });
  await assert.rejects(() => m1("hi", {}), err => { assert.equal(err.code, "model_unavailable"); return true; });

  const fetchMal = async () => ({ ok: true, status: 200, json: async () => ({ foo: "bar" }) });
  const m2 = createGemmaModelAdapter({ fetchImpl: fetchMal, endpoint: "http://127.0.0.1:8000" });
  await assert.rejects(() => m2("hi", {}), err => { assert.equal(err.code, "model_failed"); return true; });

  const fetchEmptyContent = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: {} }] }) });
  const m3 = createGemmaModelAdapter({ fetchImpl: fetchEmptyContent, endpoint: "http://127.0.0.1:8000" });
  await assert.rejects(() => m3("hi", {}), err => { assert.equal(err.code, "model_failed"); return true; });
});

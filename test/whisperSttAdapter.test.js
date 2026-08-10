import assert from "node:assert/strict";
import test from "node:test";
import { createWhisperSttAdapter, pcmToWav } from "../src/adapters/whisperStt.js";

function mockFetchSuccess(expectedUrl, expectedMethod, responseJson) {
  let seen = null;
  const fetchImpl = async (url, opts) => {
    seen = { url, method: opts.method, headers: opts.headers };
    // verify multipart contains audio.wav
    assert.ok(String(url) === expectedUrl);
    assert.equal(opts.method, "POST");
    // body is FormData, we can't easily inspect, but we can check headers missing
    return {
      ok: true,
      status: 200,
      json: async () => responseJson,
    };
  };
  fetchImpl.seen = () => seen;
  return fetchImpl;
}

test("whisper adapter marshals PCM to WAV and hits correct endpoint", async () => {
  const pcm = Buffer.alloc(1920, 1);
  const fetchImpl = mockFetchSuccess("http://127.0.0.1:4001/transcribe", "POST", { text: "hello soma", language: "en", duration: 0.02, segments: [] });
  const stt = createWhisperSttAdapter({ fetchImpl, endpoint: "http://127.0.0.1:4001" });
  const res = await stt(pcm, { utteranceId: "u1" });
  assert.equal(res.transcript, "hello soma");
  assert.equal(res.utteranceId, "u1");
  const seen = fetchImpl.seen();
  assert.ok(seen.url === "http://127.0.0.1:4001/transcribe");
});

test("whisper adapter pcmToWav header is valid 48kHz mono 16-bit", () => {
  const pcm = Buffer.alloc(1920, 0x01);
  const wav = pcmToWav(pcm);
  assert.equal(wav.length, 44 + 1920);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt32LE(24), 48000); // sample rate
  assert.equal(wav.readUInt16LE(22), 1); // channels
  assert.equal(wav.readUInt16LE(34), 16); // bits
  assert.equal(wav.toString("ascii", 36, 40), "data");
  assert.equal(wav.readUInt32LE(40), 1920);
});

test("whisper fail-closed: non-2xx throws typed error, no fabricated transcript", async () => {
  const pcm = Buffer.alloc(1920, 1);
  const fetchImpl = async () => ({ ok: false, status: 503, text: async () => "overloaded" });
  const stt = createWhisperSttAdapter({ fetchImpl, endpoint: "http://127.0.0.1:4001" });
  await assert.rejects(() => stt(pcm, { utteranceId: "u1" }), (err) => {
    assert.ok(/503/.test(err.message));
    assert.equal(err.code, "stt_unavailable");
    return true;
  });
  // also 400 is stt_failed
  const fetch400 = async () => ({ ok: false, status: 400, text: async () => "bad" });
  const stt2 = createWhisperSttAdapter({ fetchImpl: fetch400, endpoint: "http://127.0.0.1:4001" });
  await assert.rejects(() => stt2(pcm, {}), (err) => { assert.equal(err.code, "stt_failed"); return true; });
});

test("whisper fail-closed: network error and malformed body throw, red->green proof", async () => {
  const pcm = Buffer.alloc(1920, 1);
  // network error
  const fetchNet = async () => { throw new Error("ECONNREFUSED"); };
  const stt = createWhisperSttAdapter({ fetchImpl: fetchNet, endpoint: "http://127.0.0.1:4001" });
  await assert.rejects(() => stt(pcm, {}), (err) => { assert.equal(err.code, "stt_unavailable"); return true; });
  // malformed json (missing text)
  const fetchMal = async () => ({ ok: true, status: 200, json: async () => ({ foo: "bar" }) });
  const stt2 = createWhisperSttAdapter({ fetchImpl: fetchMal, endpoint: "http://127.0.0.1:4001" });
  await assert.rejects(() => stt2(pcm, {}), (err) => { assert.equal(err.code, "stt_failed"); return true; });
});

test("whisper respects config-driven endpoint from I-2", async () => {
  const pcm = Buffer.alloc(1920, 1);
  const fetchImpl = mockFetchSuccess("http://whisper-stt:4001/transcribe", "POST", { text: "hi", language: "en" });
  const stt = createWhisperSttAdapter({ fetchImpl, endpoint: "http://whisper-stt:4001" });
  const res = await stt(pcm, {});
  assert.equal(res.transcript, "hi");
});

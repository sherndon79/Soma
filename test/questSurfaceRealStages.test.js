// Item I execution path: the three real adapters as the abort-aware pipeline's
// {transcribe, chat, synthesize} stages, exercised through the pipeline with an
// injected fetch (no real services). Proves the real whisper->gemma->kokoro path
// flows through the tested pipeline (VAD, once-sink, panel, ttsChunks, ANSWER_END)
// and fails closed on an adapter error.

import assert from "node:assert/strict";
import test from "node:test";

import { createAudioChunkPayload, QUEST_SURFACE_AUDIO_UPLINK_BYTES } from "../src/questSurfaceProtocol.js";
import { createQuestSurfaceAudioPipeline } from "../src/questSurfaceAudioPipeline.js";
import { createRealAnswerStages } from "../src/questSurfaceRealAnswerProvider.js";

function voicedPcm() {
  const buf = Buffer.alloc(QUEST_SURFACE_AUDIO_UPLINK_BYTES, 0);
  for (let i = 0; i < buf.length; i += 2) buf.writeInt16LE(1000, i);
  return buf;
}

// Minimal mono 48kHz 16-bit WAV the Kokoro adapter can parse.
function makeWav(monoPcm) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + monoPcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(48000, 24); h.writeUInt32LE(48000 * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(monoPcm.length, 40);
  return Buffer.concat([h, monoPcm]);
}

function jsonRes(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } };
}
function wavRes(wav, status = 200) {
  const ab = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength);
  return { ok: status >= 200 && status < 300, status, arrayBuffer: async () => ab, headers: { get: () => null } };
}

function mockFetch(routes) {
  const calls = { chat: [] };
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/transcribe")) return routes.transcribe(opts);
    if (u.includes("/chat/completions")) { calls.chat.push(opts); return routes.chat(opts); }
    if (u.includes("/synthesize")) return routes.synthesize(opts);
    throw new Error(`unexpected url ${u}`);
  };
  return { fetchImpl, calls };
}

const endpoints = { whisper: { url: "http://w" }, llm: { url: "http://l", model: "gemma-test" }, kokoro: { url: "http://k" }, llmModel: "gemma-test" };

function pipelineWithStages(fetchImpl) {
  const stages = createRealAnswerStages({ fetchImpl, endpoints });
  return createQuestSurfaceAudioPipeline({ ...stages, eventSink: () => {}, leaseRefFor: () => "lease-panel" });
}

async function drive(pipeline, { epoch = "1", streamId = 1, utteranceId = "utt-real" } = {}) {
  pipeline.handleUtteranceStart({ sessionEpoch: epoch, streamId, payload: { utterance_id: utteranceId }, leaseRef: "lease-mic" });
  pipeline.handleAudioChunk({ sessionEpoch: epoch, streamId, payload: createAudioChunkPayload({ utteranceId, pcmBytes: voicedPcm(), channels: 1 }) });
  return pipeline.handleUtteranceEnd({ sessionEpoch: epoch, streamId, payload: { utterance_id: utteranceId } });
}

test("I-3 real stages: whisper->gemma->kokoro flows through the pipeline to a real answer", async () => {
  const { fetchImpl, calls } = mockFetch({
    transcribe: () => jsonRes({ text: "turn on the lights" }),
    chat: () => jsonRes({ choices: [{ message: { content: "Sure, lights on." }, finish_reason: "stop" }], model: "gemma-test" }),
    synthesize: () => wavRes(makeWav(Buffer.alloc(3840, 3))), // 40ms mono -> 2 stereo chunks
  });
  const result = await drive(pipelineWithStages(fetchImpl));
  assert.ok(!result.dropped, "voiced utterance is not dropped");
  assert.equal(result.answerText, "Sure, lights on.", "the real model answer flows through");
  assert.equal(result.transcript, "turn on the lights", "the real STT transcript flows through");
  assert.ok(result.panelPayload, "panel produced from the real answer");
  assert.ok(Array.isArray(result.ttsChunks) && result.ttsChunks.length >= 1, "kokoro produced playback chunks from the real answer");
  // the model received the transcript STRING as the user turn (firewall holds through the pipeline)
  const chatBody = JSON.parse(calls.chat[0].body);
  const userTurn = chatBody.messages.find((m) => m.role === "user");
  assert.ok(userTurn && userTurn.content === "turn on the lights", "model received exactly the transcript as the user turn (no PCM)");
});

test("I-3 real stages fail-closed: a model error fails the answer (no fabricated reply)", async () => {
  const { fetchImpl } = mockFetch({
    transcribe: () => jsonRes({ text: "hello" }),
    chat: () => jsonRes({ error: "unavailable" }, 503),
    synthesize: () => wavRes(makeWav(Buffer.alloc(1920, 1))),
  });
  await assert.rejects(
    () => drive(pipelineWithStages(fetchImpl)),
    (err) => err && /local_model_failed/.test(String(err.code ?? err.message)),
    "a 503 from the model must fail closed, not fabricate an answer",
  );
});

test("I-3 real stages fail-closed: an STT error fails before the model", async () => {
  let chatCalled = 0;
  const { fetchImpl } = mockFetch({
    transcribe: () => jsonRes({ error: "down" }, 503),
    chat: () => { chatCalled += 1; return jsonRes({ choices: [{ message: { content: "x" } }] }); },
    synthesize: () => wavRes(makeWav(Buffer.alloc(1920, 1))),
  });
  await assert.rejects(() => drive(pipelineWithStages(fetchImpl)));
  assert.equal(chatCalled, 0, "STT failure must stop before the model call");
});

#!/usr/bin/env node
// Quest v1b LIVE-services loopback — the ultimate pre-Gate-2 proof.
//
// Runs one utterance through the REAL local services (Whisper STT, local Gemma,
// Kokoro TTS) — no mocks, no headset. The mocked `npm run test:quest-v1b-loopback`
// exercises the adapter code with the HTTP faked; this one catches live-service
// behavior (the lesson on this program is that fakes hide live blockers).
//
// Self-contained: it bootstraps the question AUDIO by asking the real Kokoro to
// speak a fixed question, feeds that audio to real Whisper, then Gemma, then
// Kokoro again for the answer audio. Every stage's output is printed as evidence.
//
// Bring the services up first (host-published on 4001/4010/8000), e.g. TheCommons:
//   docker compose -f docker-compose.gpu.yml up -d whisper-stt kokoro-tts gemma4-llm
// Then:  SOMA_QUEST_API_KEY=$INTERNAL_API_KEY npm run quest-v1b-live-loopback
//
// Endpoints: SOMA_WHISPER_URL / SOMA_KOKORO_URL / SOMA_LLM_URL (defaults
// 127.0.0.1:4001/4010/8000). API key: SOMA_QUEST_API_KEY (or INTERNAL_API_KEY).

import { getLocalServiceEndpoints, checkLocalServiceHealth } from "../src/localServiceHealth.js";
import { createWhisperSttAdapter } from "../src/adapters/whisperStt.js";
import { createGemmaModelAdapter } from "../src/adapters/gemmaModel.js";
import { createKokoroTtsAdapter } from "../src/adapters/kokoroTts.js";
import { VOICE_BRIEF_SYSTEM_PROMPT } from "../src/questSurfaceRealAnswerProvider.js";

const QUESTION = "What is two plus two? Answer in one short sentence.";
const apiKey = process.env.SOMA_QUEST_API_KEY ?? process.env.INTERNAL_API_KEY ?? "";

function fail(msg, code = 1) { console.error(`\n[live-loopback] FAIL: ${msg}`); process.exit(code); }
function ok(msg) { console.log(`[live-loopback] ok: ${msg}`); }

// Extract mono S16LE PCM from a WAV (find the 'data' chunk).
function pcmFromWav(wav) {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF") fail("Kokoro did not return a WAV");
  let off = 12;
  while (off + 8 <= wav.length) {
    const id = wav.toString("ascii", off, off + 4);
    const size = wav.readUInt32LE(off + 4);
    if (id === "data") return wav.subarray(off + 8, off + 8 + size);
    off += 8 + size;
  }
  fail("no data chunk in Kokoro WAV");
}

async function main() {
  const endpoints = getLocalServiceEndpoints();
  console.log(`[live-loopback] endpoints: whisper=${endpoints.whisper.url} llm=${endpoints.llm.url} kokoro=${endpoints.kokoro.url}`);

  // 0. Health gate — fail clearly with the bring-up hint.
  const health = await checkLocalServiceHealth({ endpoints, timeoutMs: 3000 });
  if (!health.ok) {
    console.error(`[live-loopback] services not reachable:\n  ${health.errors.join("\n  ")}`);
    fail("bring the services up first, e.g.: (in TheCommons) docker compose -f docker-compose.gpu.yml up -d whisper-stt kokoro-tts gemma4-llm — then re-run.");
  }
  ok("all three services healthy");

  // 1. Bootstrap: real Kokoro speaks the question -> question audio (mono WAV).
  const kUrl = (typeof endpoints.kokoro === "string" ? endpoints.kokoro : endpoints.kokoro.url).replace(/\/$/, "");
  const synthRes = await fetch(`${kUrl}/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(apiKey ? { "X-Api-Key": apiKey } : {}) },
    body: JSON.stringify({ text: QUESTION, voice: "default", speed: 1.0 }),
  }).catch((e) => fail(`Kokoro /synthesize (bootstrap) failed: ${e.message}`));
  if (!synthRes.ok) fail(`Kokoro /synthesize (bootstrap) HTTP ${synthRes.status}`);
  const questionPcm = pcmFromWav(Buffer.from(await synthRes.arrayBuffer()));
  ok(`bootstrapped question audio: ${questionPcm.length} PCM bytes for "${QUESTION}"`);

  // 2-4. The real answer path, stage by stage (visible evidence).
  const stt = createWhisperSttAdapter({ endpoint: endpoints.whisper, apiKey });
  const model = createGemmaModelAdapter({ endpoint: endpoints.llm, model: endpoints.llm.model, systemPrompt: VOICE_BRIEF_SYSTEM_PROMPT });
  const tts = createKokoroTtsAdapter({ endpoint: endpoints.kokoro, apiKey });

  const t0 = Date.now();
  const { transcript } = await stt(questionPcm, { utteranceId: "live" }).catch((e) => fail(`Whisper STT failed (${e.code ?? ""}): ${e.message}`));
  const tStt = Date.now();
  console.log(`[live-loopback] STT transcript (${tStt - t0}ms): "${transcript}"`);
  if (!transcript || !transcript.trim()) fail("Whisper returned an empty transcript");

  const { answerText } = await model(transcript, { utteranceId: "live" }).catch((e) => fail(`Gemma model failed (${e.code ?? ""}): ${e.message}`));
  const tModel = Date.now();
  console.log(`[live-loopback] model answer (${tModel - tStt}ms): "${answerText}"`);
  if (!answerText || !answerText.trim()) fail("model returned an empty answer");

  const chunks = await tts(answerText, { utteranceId: "live", answerId: "live" }).catch((e) => fail(`Kokoro TTS failed (${e.code ?? ""}): ${e.message}`));
  const tTts = Date.now();
  const bytes = chunks.reduce((n, c) => n + c.length, 0);
  console.log(`[live-loopback] TTS answer audio (${tTts - tModel}ms): ${chunks.length} chunks, ${bytes} bytes (48k stereo)`);
  if (chunks.length < 1 || !chunks.every((c) => c.length === 3840)) fail("TTS did not return valid 3840-byte stereo chunks");

  // Retention note: this script holds transcript/answer only in local variables
  // for the duration of the run; it writes nothing to disk. The provider-level
  // no-retention audit (logs/events content-free) is proven by the mocked
  // loopback that runs THROUGH the provider; the on-device run repeats it live.
  console.log(`\n[live-loopback] PASS — real ${(tTts - t0)}ms round trip: heard "${transcript.slice(0, 60)}" -> answered "${answerText.slice(0, 80)}" -> ${chunks.length} audio chunks. No files written.`);
}

main().catch((e) => fail(`unexpected: ${e.stack ?? e.message}`));

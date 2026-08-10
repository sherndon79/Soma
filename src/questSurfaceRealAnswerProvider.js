// Item I-3 seam: the three local adapters (Whisper STT -> Gemma model ->
// Kokoro TTS), local destination only, no remote fallback.
//
// Two shapes over the same adapters:
//   - createRealAnswerStages(): the {transcribe, chat, synthesize} stages for the
//     abort-aware pipeline — the ITEM-I execution path (interruptible generation
//     via the pipeline's per-utterance abortSignal, which propagates to the
//     adapter fetches). Fail-closed: any adapter throw propagates.
//   - createRealTextLocalAnswerProvider(): the streaming respond() provider — the
//     dual-mode foundation (proven; the execution path for the future streaming-
//     to-wire / audio-native slice).
//
// The structural transcript-only firewall holds in both: STT consumes PCM, the
// model receives the transcript string only, and the Gemma adapter itself
// rejects PCM.

import { createTextLocalAnswerProvider } from "./questSurfaceModeMatrix.js";
import { createWhisperSttAdapter } from "./adapters/whisperStt.js";
import { createGemmaModelAdapter } from "./adapters/gemmaModel.js";
import { createKokoroTtsAdapter } from "./adapters/kokoroTts.js";
import { getLocalServiceEndpoints } from "./localServiceHealth.js";

// Voice-brief default: spoken answers must be short. Long text is cumbersome
// over TTS and makes interruption necessary rather than optional. Overridable.
export const VOICE_BRIEF_SYSTEM_PROMPT =
  "You are a local voice assistant speaking aloud to one person. Answer in one " +
  "or two short, conversational sentences suitable for speech. Do not use lists, " +
  "markdown, headings, or code blocks. Be direct; skip preamble. If a full answer " +
  "would be long, give the short version and offer to say more if asked.";

function buildRealAdapters({ fetchImpl, env = process.env, endpoints, apiKey, model, systemPrompt, voice } = {}) {
  const ep = endpoints ?? getLocalServiceEndpoints(env);
  return {
    stt: createWhisperSttAdapter({ fetchImpl, endpoint: ep.whisper, apiKey }),
    model: createGemmaModelAdapter({
      fetchImpl,
      endpoint: ep.llm,
      model: model ?? ep.llmModel,
      systemPrompt: systemPrompt ?? VOICE_BRIEF_SYSTEM_PROMPT,
    }),
    tts: createKokoroTtsAdapter({ fetchImpl, endpoint: ep.kokoro, apiKey, voice }),
  };
}

export function createRealTextLocalAnswerProvider(opts = {}) {
  const { stt, model, tts } = buildRealAdapters(opts);
  return createTextLocalAnswerProvider({ stt, model, tts });
}

// Item-I execution path: real adapters mapped to the abort-aware pipeline's
// stage signatures. abortSignal propagates to the adapter fetches so an aborted
// utterance stops the in-flight stage (interruptible generation).
export function createRealAnswerStages(opts = {}) {
  const { stt, model, tts } = buildRealAdapters(opts);
  return {
    // transcribe(pcmBytes, utteranceId, abortSignal) -> { transcript }
    transcribe: async (pcmBytes, utteranceId, abortSignal) => {
      const r = await stt(pcmBytes, { utteranceId, signal: abortSignal });
      return { transcript: r.transcript };
    },
    // chat(transcript, utteranceId, answerId, abortSignal) -> { answerText }.
    // The model receives the transcript STRING only (firewall). Fail-closed on
    // empty so the pipeline's fixture fallback can never fabricate for real.
    chat: async (transcript, utteranceId, answerId, abortSignal) => {
      const r = await model(transcript, { utteranceId, answerId, signal: abortSignal });
      const answerText = typeof r === "string" ? r : r && r.answerText;
      if (typeof answerText !== "string" || answerText.length === 0) {
        const e = new Error("model returned empty answer");
        e.code = "model_failed";
        throw e;
      }
      return { answerText };
    },
    // synthesize(answerText, answerId, utteranceId, abortSignal) -> Buffer[]
    synthesize: async (answerText, answerId, utteranceId, abortSignal) => {
      return await tts(answerText, { answerId, utteranceId, signal: abortSignal });
    },
  };
}

/**
 * I-1 dual-mode answer matrix enforcement.
 * Armed leaf selects mode; both manifest issuance and provider selection must prove same tuple.
 */

export const ANSWER_MODES = Object.freeze([
  { input_class: "text", destination: "local" },
  { input_class: "text", destination: "remote" },
  { input_class: "raw_audio", destination: "local" },
  { input_class: "raw_audio", destination: "remote" },
]);

const LEAF_FOR = {
  "text:local": "model.context.audio.microphone.local.attach",
  "text:remote": "model.context.audio.microphone.remote.attach",
  "raw_audio:local": "model.context.audio.microphone.raw.local.attach",
  "raw_audio:remote": "model.context.audio.microphone.raw.remote.attach",
};

function modeKey(m) {
  return `${m.input_class}:${m.destination}`;
}

function throwRefusal(code, message) {
  const e = new Error(message);
  e.code = code;
  throw e;
}

function hasLeaseFor(manifest, requiredLeaf) {
  if (!manifest || !manifest.leases || typeof manifest.leases !== "object") return null;
  if (manifest.leases[requiredLeaf]) return manifest.leases[requiredLeaf];
  // real 4-leaf manifest keys: panel, mic_capture, audio_present, local_attach
  const leafToManifestKey = {
    "model.context.audio.microphone.local.attach": "local_attach",
    "model.context.audio.microphone.remote.attach": "remote_attach",
    "model.context.audio.microphone.raw.local.attach": "raw_local_attach",
    "model.context.audio.microphone.raw.remote.attach": "raw_remote_attach",
    "interaction.quest.surface.panel.present": "panel",
    "interaction.quest.surface.microphone.capture": "mic_capture",
    "interaction.quest.surface.audio.wearer_directed.present": "audio_present",
  };
  const mapped = leafToManifestKey[requiredLeaf];
  if (mapped && manifest.leases[mapped]) return manifest.leases[mapped];
  return null;
}

export function matchAnswerProvider({ armedEpisode, providerRegistry, manifest }) {
  if (!armedEpisode || !armedEpisode.mode || typeof armedEpisode.mode.input_class !== "string" || typeof armedEpisode.mode.destination !== "string") {
    throwRefusal("mode_mismatch", "armed episode mode missing or malformed");
  }
  if (!providerRegistry || !Array.isArray(providerRegistry.providers)) {
    throwRefusal("no_matching_provider", "provider registry missing");
  }
  const armedModeKey = modeKey(armedEpisode.mode);
  // find providers matching armed mode
  const candidates = providerRegistry.providers.filter((p) => p && p.answer && modeKey(p.answer) === armedModeKey);
  if (candidates.length === 0) {
    throwRefusal("no_matching_provider", `no provider for mode ${armedModeKey}`);
  }
  if (candidates.length > 1) {
    throwRefusal("ambiguous", `multiple providers for mode ${armedModeKey}: slot violation`);
  }
  const provider = candidates[0];
  // leaf must be armed in manifest
  const requiredLeaf = provider.answer.required_leaf;
  const expectedLeaf = LEAF_FOR[armedModeKey];
  // capability must equal required leaf
  if (armedEpisode.capability !== requiredLeaf) {
    throwRefusal("mode_mismatch", `capability ${armedEpisode.capability} does not match required leaf ${requiredLeaf}`);
  }
  // also ensure leaf matches mode mapping (defensive)
  if (expectedLeaf && requiredLeaf !== expectedLeaf) {
    throwRefusal("mode_mismatch", `provider leaf ${requiredLeaf} does not match mode ${armedModeKey}`);
  }
  // tuple binding: provider id and grant_id
  if (armedEpisode.provider !== provider.id) {
    throwRefusal("provider_mismatch", `episode provider ${armedEpisode.provider} does not match selected provider ${provider.id}`);
  }
  const leaseEntry = hasLeaseFor(manifest, requiredLeaf);
  if (!leaseEntry) {
    throwRefusal("leaf_not_armed", `required leaf ${requiredLeaf} not armed in manifest`);
  }
  // grant_id must match lease's source_grant_id
  if (armedEpisode.grant_id !== leaseEntry.source_grant_id) {
    throwRefusal("grant_mismatch", `episode grant ${armedEpisode.grant_id} does not match manifest grant ${leaseEntry.source_grant_id}`);
  }
  // also grant_id should be grant-<leaf> shape (optional check)
  // remote destination pinning: if destination remote, must have remote_destination
  if (provider.answer.destination === "remote" && !provider.answer.remote_destination) {
    throwRefusal("mode_mismatch", "remote provider must pin remote_destination");
  }
  return provider;
}

export function createTextLocalAnswerProvider({ stt, model, tts } = {}) {
  if (typeof stt !== "function" || typeof model !== "function" || typeof tts !== "function") {
    throw new Error("createTextLocalAnswerProvider requires {stt, model, tts} functions");
  }
  return {
    id: "soma.provider.answer.text-local",
    answer: {
      input_class: "text",
      destination: "local",
      required_leaf: LEAF_FOR["text:local"],
    },
    async *respond({ pcm, utteranceId, answerId, context, signal } = {}) {
      // STT: pcm -> transcript
      const sttResult = await stt(pcm, { utteranceId, answerId, context, signal });
      const transcript = typeof sttResult === "string" ? sttResult : (sttResult && sttResult.transcript) ?? "";
      // structural firewall: model receives transcript only, never PCM
      const modelInput = transcript;
      // model: transcript -> answer text
      const modelResult = await model(modelInput, { utteranceId, answerId, context, signal, transcript });
      const answerText = typeof modelResult === "string" ? modelResult : (modelResult && (modelResult.answerText ?? modelResult.text ?? modelResult.answer)) ?? "";
      // emit answer text
      if (answerText) {
        yield { answerText, utteranceId, answerId };
      }
      // TTS: answer text -> audio chunks
      const ttsResult = await tts(answerText, { utteranceId, answerId, context, signal, transcript });
      const chunks = Array.isArray(ttsResult) ? ttsResult : (ttsResult && ttsResult.chunks) ? ttsResult.chunks : ttsResult ? [ttsResult] : [];
      for (const chunk of chunks) {
        if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) {
          yield { audioChunk: chunk, utteranceId, answerId };
        } else if (chunk && (chunk.pcm || chunk.audioChunk)) {
          yield { audioChunk: chunk.pcm ?? chunk.audioChunk, utteranceId, answerId };
        }
      }
      yield { terminal: true, utteranceId, answerId };
    },
  };
}

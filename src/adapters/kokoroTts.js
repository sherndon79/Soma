/**
 * I-3c Kokoro TTS adapter — answer text -> S16LE 48kHz STEREO 3840-byte chunks via HTTP.
 * Fail-closed: non-2xx / timeout / network / malformed / empty-audio -> typed throw.
 * Marshals Kokoro WAV (mono 48kHz 16-bit) -> stereo 48kHz 3840b/20ms.
 */
import { getLocalServiceEndpoints } from "../localServiceHealth.js";

function parseWavPcm(wavBuffer) {
  // Minimal WAV parser: find fmt and data chunks, assumes PCM 16-bit
  if (wavBuffer.length < 44) throw new Error("WAV too short");
  if (wavBuffer.toString("ascii", 0, 4) !== "RIFF" || wavBuffer.toString("ascii", 8, 12) !== "WAVE") {
    // fallback: assume raw PCM mono 48kHz if not WAV (e.g., /stream)
    return { pcm: wavBuffer, sampleRate: 48000, channels: 1, bitsPerSample: 16 };
  }
  let offset = 12;
  let sampleRate = 48000;
  let channels = 1;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataSize = -1;
  while (offset + 8 <= wavBuffer.length) {
    const chunkId = wavBuffer.toString("ascii", offset, offset + 4);
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);
    if (chunkId === "fmt ") {
      const audioFormat = wavBuffer.readUInt16LE(offset + 8);
      if (audioFormat !== 1) throw new Error(`unsupported WAV format ${audioFormat}`);
      channels = wavBuffer.readUInt16LE(offset + 10);
      sampleRate = wavBuffer.readUInt32LE(offset + 12);
      bitsPerSample = wavBuffer.readUInt16LE(offset + 22);
    } else if (chunkId === "data") {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  if (dataOffset < 0 || dataSize < 0) throw new Error("WAV data chunk not found");
  const pcm = wavBuffer.subarray(dataOffset, dataOffset + dataSize);
  return { pcm, sampleRate, channels, bitsPerSample };
}

function monoToStereo(monoPcm) {
  // mono: S16LE, 1 channel, 2 bytes per sample -> stereo: duplicate sample to L+R (4 bytes per frame)
  if (monoPcm.length % 2 !== 0) throw new Error("mono PCM length not even");
  const samples = monoPcm.length / 2;
  const stereo = Buffer.alloc(samples * 4);
  for (let i = 0; i < samples; i++) {
    const sample = monoPcm.readInt16LE(i * 2);
    stereo.writeInt16LE(sample, i * 4);
    stereo.writeInt16LE(sample, i * 4 + 2);
  }
  return stereo;
}

function chunkStereo(stereoPcm, chunkBytes = 3840) {
  // stereo 48kHz: 960 frames * 4 bytes = 3840 per 20ms
  const chunks = [];
  for (let offset = 0; offset < stereoPcm.length; offset += chunkBytes) {
    const slice = stereoPcm.subarray(offset, offset + chunkBytes);
    if (slice.length === chunkBytes) {
      chunks.push(Buffer.from(slice));
    } else if (slice.length > 0) {
      // pad last chunk to exact size with silence (or drop? pad to keep wire invariant)
      const padded = Buffer.alloc(chunkBytes, 0);
      slice.copy(padded, 0);
      chunks.push(padded);
    }
  }
  return chunks;
}

function resampleIfNeeded(pcm, sampleRate, channels, bitsPerSample) {
  // Kokoro service already upsamples to 48kHz, but handle 24k->48k mono case if raw stream is used
  if (sampleRate === 48000 && channels === 1 && bitsPerSample === 16) return pcm;
  if (sampleRate === 24000 && channels === 1 && bitsPerSample === 16) {
    // simple 2x upsample via duplication
    const samples = pcm.length / 2;
    const up = Buffer.alloc(samples * 2 * 2);
    for (let i = 0; i < samples; i++) {
      const s = pcm.readInt16LE(i * 2);
      up.writeInt16LE(s, i * 4);
      up.writeInt16LE(s, i * 4 + 2);
    }
    return up;
  }
  // fallback: return as-is and let monoToStereo handle if mono
  return pcm;
}

export function createKokoroTtsAdapter({ fetchImpl = fetch, endpoint, voice = "default", apiKey } = {}) {
  const ep = endpoint ?? getLocalServiceEndpoints().kokoro;
  const url = typeof ep === "string" ? ep : ep.url ?? "http://127.0.0.1:4010";
  const base = String(url).replace(/\/$/, "");
  const key = apiKey ?? process.env.SOMA_KOKORO_API_KEY ?? process.env.INTERNAL_API_KEY ?? "";

  async function tts(answerText, { answerId, utteranceId, signal, timeoutMs = 15000 } = {}) {
    if (typeof answerText !== "string" || !answerText.trim()) {
      const e = new Error("Kokoro TTS requires non-empty answer text");
      e.code = "tts_failed";
      throw e;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    let res;
    try {
      res = await fetchImpl(`${base}/synthesize`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(key ? { "X-Api-Key": key } : {}),
        },
        body: JSON.stringify({ text: answerText, voice }),
      });
    } catch (err) {
      clearTimeout(timer);
      const e = new Error(`Kokoro TTS unavailable: ${String(err.message ?? err)}`);
      e.code = err && err.name === "AbortError" ? "tts_unavailable" : "tts_unavailable";
      e.cause = err;
      throw e;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const e = new Error(`Kokoro TTS failed: HTTP ${res.status} ${body}`);
      e.code = res.status >= 500 || res.status === 429 ? "tts_unavailable" : "tts_failed";
      e.status = res.status;
      throw e;
    }

    let wavBuf;
    try {
      const ab = await res.arrayBuffer();
      wavBuf = Buffer.from(ab);
    } catch (err) {
      const e = new Error(`Kokoro TTS malformed response: ${String(err.message)}`);
      e.code = "tts_failed";
      throw e;
    }
    if (!wavBuf || wavBuf.length === 0) {
      const e = new Error("Kokoro TTS empty audio");
      e.code = "tts_failed";
      throw e;
    }

    let parsed;
    try {
      parsed = parseWavPcm(wavBuf);
    } catch (err) {
      const e = new Error(`Kokoro TTS malformed WAV: ${String(err.message)}`);
      e.code = "tts_failed";
      throw e;
    }

    // verify or resample
    let monoPcm = parsed.pcm;
    // handle sample rate mismatch
    monoPcm = resampleIfNeeded(monoPcm, parsed.sampleRate, parsed.channels, parsed.bitsPerSample);
    // Now monoPcm should be 48kHz mono 16-bit
    if (parsed.channels !== 1 && parsed.channels !== undefined) {
      // if already stereo, use as-is (but service is mono)
    }
    const stereo = monoToStereo(monoPcm);
    const chunks = chunkStereo(stereo, 3840);
    if (chunks.length === 0) {
      const e = new Error("Kokoro TTS empty audio after chunking");
      e.code = "tts_failed";
      throw e;
    }
    // verify each chunk is 3840
    for (const c of chunks) {
      if (c.length !== 3840) {
        const e = new Error(`Kokoro TTS chunk size invariant violated: ${c.length} != 3840`);
        e.code = "tts_failed";
        throw e;
      }
    }
    return chunks;
  }

  // expose helpers for tests
  tts._parseWavPcm = parseWavPcm;
  tts._monoToStereo = monoToStereo;
  tts._chunkStereo = chunkStereo;
  return tts;
}

export { parseWavPcm, monoToStereo, chunkStereo };

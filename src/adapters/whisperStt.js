/**
 * I-3a Whisper STT adapter — PCM (S16LE 48kHz mono) -> {transcript} via HTTP.
 * Fail-closed: non-2xx / timeout / network / malformed -> typed throw.
 * Marshals Quest PCM to WAV (48kHz mono 16-bit) for POST /transcribe multipart.
 */
import { getLocalServiceEndpoints } from "../localServiceHealth.js";

function pcmToWav(pcm, { sampleRate = 48000, channels = 1, bitsPerSample = 16 } = {}) {
  const headerSize = 44;
  const dataSize = pcm.length;
  const buf = Buffer.alloc(headerSize + dataSize);
  // RIFF
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  // fmt
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28); // byte rate
  buf.writeUInt16LE(channels * bitsPerSample / 8, 32); // block align
  buf.writeUInt16LE(bitsPerSample, 34);
  // data
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  pcm.copy(buf, 44);
  return buf;
}

function isWhisperResponse(v) {
  return v && typeof v === "object" && typeof v.text === "string";
}

export function createWhisperSttAdapter({ fetchImpl = fetch, endpoint, apiKey } = {}) {
  const ep = endpoint ?? getLocalServiceEndpoints().whisper;
  const url = typeof ep === "string" ? ep : ep.url ?? "http://127.0.0.1:4001";
  const key = apiKey ?? process.env.SOMA_WHISPER_API_KEY ?? process.env.INTERNAL_API_KEY ?? "";
  // Normalize: ensure no trailing slash
  const base = String(url).replace(/\/$/, "");

  async function stt(pcm, { utteranceId, signal, timeoutMs = 10000 } = {}) {
    if (!Buffer.isBuffer(pcm) && !(pcm instanceof Uint8Array)) {
      const e = new Error("stt requires Buffer PCM");
      e.code = "stt_failed";
      throw e;
    }
    const pcmBuf = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm);
    const wav = pcmToWav(pcmBuf, { sampleRate: 48000, channels: 1 });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    // Build multipart form-data manually without external deps (Node 18+ FormData)
    const form = new FormData();
    const blob = new Blob([wav], { type: "audio/wav" });
    form.append("file", blob, "audio.wav");

    const headers = {};
    if (key) headers["X-Api-Key"] = key;

    let res;
    try {
      res = await fetchImpl(`${base}/transcribe`, {
        method: "POST",
        body: form,
        signal: controller.signal,
        headers,
      });
    } catch (err) {
      clearTimeout(timer);
      const e = new Error(`Whisper STT unavailable: ${String(err.message ?? err)}`);
      e.code = err && err.name === "AbortError" ? "stt_unavailable" : "stt_unavailable";
      e.cause = err;
      throw e;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const e = new Error(`Whisper STT failed: HTTP ${res.status} ${body}`);
      e.code = res.status >= 500 || res.status === 429 ? "stt_unavailable" : "stt_failed";
      e.status = res.status;
      throw e;
    }

    let json;
    try {
      json = await res.json();
    } catch (err) {
      const e = new Error(`Whisper STT malformed response: ${String(err.message)}`);
      e.code = "stt_failed";
      throw e;
    }
    if (!isWhisperResponse(json)) {
      const e = new Error("Whisper STT malformed response: missing text");
      e.code = "stt_failed";
      throw e;
    }
    return { transcript: String(json.text ?? "").trim(), raw: json, utteranceId };
  }

  // expose for tests
  stt._pcmToWav = pcmToWav;
  return stt;
}

// Also export for seam wiring
export { pcmToWav };

import { randomUUID } from "node:crypto";

import {
  QUEST_SURFACE_MAX_UTTERANCE_CHUNKS,
  QUEST_SURFACE_AUDIO_UPLINK_BYTES,
  QUEST_SURFACE_AUDIO_PLAYBACK_BYTES,
  QUEST_SURFACE_VAD_ENERGY_THRESHOLD,
  QuestSurfaceProtocolError,
  createAudioChunkPayload,
  createPanelSnapshotPayload,
  decodeUtteranceStartPayload,
  decodeUtteranceEndPayload,
  decodeCancelPayload,
  decodeAudioChunkPayload,
  decodeAnswerEndPayload,
  isVadVoicedChunk,
} from "./questSurfaceProtocol.js";

/**
 * Host-local answer pipeline — STT → local model → TTS + panel, inert unless
 * explicitly instantiated and driven by a leased session. All buffers are
 * in-memory per-utterance/per-stream and cleared on end/cancel/lifecycle.
 *
 * Answer pairing: one utterance_id → one answer_id. The same answer_id
 * appears in:
 * - transcript provenance (internal)
 * - panel snapshot revision (new revision, payload text)
 * - each playback AUDIO_CHUNK payload answer_id
 *
 * Limits:
 * - max chunks per utterance (QUEST_SURFACE_MAX_UTTERANCE_CHUNKS)
 * - VAD: silence-only utterances produce no answer (dropped)
 * - cancellation: CANCEL flushes only its utterance
 * - stream isolation: map keyed by `${sessionEpoch}:${streamId}`
 *
 * No persistence, no egress, local-only. Injected dependencies are
 * fixture-friendly: transcribe(pcmBytes, utteranceId) → { transcript, voicedChunks, silenceChunks }
 *                     chat(transcript, utteranceId) → { answerText }
 *                     synthesize(answerText, answerId, utteranceId) → Buffer[] (each stereo 20ms)
 */

export const PIPELINE_LIMITS = {
  maxChunks: QUEST_SURFACE_MAX_UTTERANCE_CHUNKS,
  vadThreshold: QUEST_SURFACE_VAD_ENERGY_THRESHOLD,
};

export function createQuestSurfaceAudioPipeline({
  transcribe = fixtureTranscribe,
  chat = fixtureChat,
  synthesize = fixtureSynthesize,
  panelBase = { surface_id: "panel.main", pose: null, bounds: null },
  leaseRefFor = () => "",
  nextRevision = null,
  eventSink = () => {},
  logger = console,
} = {}) {
  let revisionCounter = 1n;
  const nextRev = typeof nextRevision === "function" ? nextRevision : () => { revisionCounter += 1n; return revisionCounter.toString(10); };
  // per-stream utterance state
  const streams = new Map(); // key -> { utteranceId, chunks: Buffer[], voiced: number, chunkMsTotal: number, bytesTotal: number, startedAtMs, state, generation }
  const completed = new Set(); // answerIds already emitted (for dedup test)
  let sessionGeneration = 0; // #5: bumped on lifecycle close to invalidate in-flight awaits
  // H: jitter queues ≤200ms drop-oldest (duration-based) per-stream isolated, non-blocking capture
  const captureJitter = new Map(); // k -> Array<Buffer>
  const playbackJitter = new Map(); // k(answer) -> Array<Buffer>
  const answerTerminal = new Map(); // k(answer) -> true
  const closedAnswers = new Set();
  const lastSeq = new Map(); // seqKey -> BigInt
  const JITTER_MS = 200;

  function keyFor(sessionEpoch, streamId) {
    return `${String(sessionEpoch)}:${String(streamId)}`;
  }
  function answerKeyFor(sessionEpoch, streamId, answerId) {
    return `${String(sessionEpoch)}:${String(streamId)}:${String(answerId)}`;
  }

  function ensureStream(sessionEpoch, streamId) {
    const k = keyFor(sessionEpoch, streamId);
    if (!streams.has(k)) streams.set(k, null);
    return k;
  }

  function handleUtteranceStart({ sessionEpoch, streamId, payload, leaseRef }) {
    const { utterance_id } = decodeUtteranceStartPayload(payload);
    const k = ensureStream(sessionEpoch, streamId);
    const existing = streams.get(k);
    if (existing && existing.state === "collecting") {
      throw pipelineError("utterance_already_active", `Stream ${k} already has utterance ${existing.utteranceId}`);
    }
    const abortController = new AbortController();
    streams.set(k, {
      utteranceId: utterance_id,
      leaseRef,
      chunks: [],
      voiced: 0,
      silence: 0,
      chunkMsTotal: 0,
      bytesTotal: 0,
      startedAtMs: Date.now(),
      state: "collecting",
      sessionEpoch: String(sessionEpoch),
      streamId: Number(streamId),
      generation: sessionGeneration,
      abortController,
      abortSignal: abortController.signal,
    });
    eventSink({ event_type: "quest.surface.utterance_started", session_epoch: String(sessionEpoch), stream_id: Number(streamId), utterance_id: utterance_id, lease_ref: leaseRef });
    return utterance_id;
  }

  function handleAudioChunk({ sessionEpoch, streamId, payload }) {
    const decoded = decodeAudioChunkPayload(payload);
    // must be mono uplink per protocol
    if (decoded.channels !== 1) throw pipelineError("channels_invalid", "Uplink must be mono");
    const k = keyFor(sessionEpoch, streamId);
    const state = streams.get(k);
    if (!state || state.state !== "collecting") {
      throw pipelineError("utterance_not_started", `No collecting utterance on stream ${k}`);
    }
    // #7: enforce duration and byte bound (40ms chunks must not bypass 30s)
    if (state.chunkMsTotal + decoded.chunk_ms > 30_000) {
      throw pipelineError("utterance_too_long", `Utterance ${state.utteranceId} exceeds 30s duration`);
    }
    if (state.bytesTotal + decoded.pcm_bytes.length > 1500 * 3840) {
      throw pipelineError("utterance_too_long", `Utterance ${state.utteranceId} exceeds byte limit`);
    }
    if (state.chunks.length >= PIPELINE_LIMITS.maxChunks) {
      throw pipelineError("utterance_too_long", `Utterance ${state.utteranceId} exceeds chunk limit`);
    }
    if (decoded.utterance_id !== state.utteranceId) {
      throw pipelineError("utterance_id_mismatch", `Chunk utterance ${decoded.utterance_id} != active ${state.utteranceId}`);
    }
    const voiced = isVadVoicedChunk(decoded.pcm_bytes, PIPELINE_LIMITS.vadThreshold);
    state.chunks.push(decoded.pcm_bytes);
    state.chunkMsTotal += decoded.chunk_ms;
    state.bytesTotal += decoded.pcm_bytes.length;
    if (voiced) state.voiced++; else state.silence++;
    return { voiced, total: state.chunks.length };
  }

  function jitterMsForCapture(buf) { return buf.length === 1920 ? 20 : buf.length === 3840 ? 40 : 0; }
  function jitterMsForPlayback(buf) { return buf.length === 3840 ? 20 : buf.length === 7680 ? 40 : 0; }
  function totalJitterMs(q, isCapture) { let ms=0; for (const b of q) ms += isCapture ? jitterMsForCapture(b) : jitterMsForPlayback(b); return ms; }
  function enqueueCaptureChunk(sessionEpoch, streamId, pcmBytes) {
    if (Number(streamId) === 0) throw pipelineError("stream_id_invalid", "Stream 0 invalid");
    const buf = Buffer.isBuffer(pcmBytes) ? pcmBytes : Buffer.from(pcmBytes);
    if (buf.length !== 1920 && buf.length !== 3840) throw pipelineError("pcm_bytes_invalid", "Capture PCM must be 1920 or 3840");
    const k = keyFor(sessionEpoch, streamId);
    const state = streams.get(k);
    if (!state || state.state !== "collecting") throw pipelineError("utterance_not_started", `No collecting utterance on stream ${k}`);
    let q = captureJitter.get(k);
    if (!q) { q = []; captureJitter.set(k, q); }
    q.push(buf);
    while (totalJitterMs(q, true) > JITTER_MS) q.shift();
  }
  function captureJitterSize(sessionEpoch, streamId) {
    const q = captureJitter.get(keyFor(sessionEpoch, streamId));
    return q ? q.length : 0;
  }
  function enqueuePlaybackChunk(sessionEpoch, streamId, answerId, pcmBytes) {
    if (Number(streamId) === 0) throw pipelineError("stream_id_invalid", "Stream 0 invalid");
    const buf = Buffer.isBuffer(pcmBytes) ? pcmBytes : Buffer.from(pcmBytes);
    if (buf.length !== 3840 && buf.length !== 7680) throw pipelineError("pcm_bytes_invalid", "Playback PCM must be 3840 or 7680");
    const ak = answerKeyFor(sessionEpoch, streamId, answerId);
    if (answerTerminal.has(ak) || closedAnswers.has(ak)) throw pipelineError("answer_ended", "Answer already terminal");
    let q = playbackJitter.get(ak);
    if (!q) { q = []; playbackJitter.set(ak, q); }
    q.push(buf);
    while (totalJitterMs(q, false) > JITTER_MS) q.shift();
  }
  function playbackJitterSize(sessionEpoch, streamId, answerId) {
    const q = playbackJitter.get(answerKeyFor(sessionEpoch, streamId, answerId));
    return q ? q.length : 0;
  }
  function handleAnswerEnd({ sessionEpoch, streamId, leaseRef, payload, seq }) {
    const { utterance_id, answer_id } = decodeAnswerEndPayload(payload);
    if (Number(streamId) === 0) throw pipelineError("stream_id_invalid", "Stream 0 invalid for ANSWER_END");
    if (!leaseRef || String(leaseRef).trim() === "") throw pipelineError("lease_ref_required", "ANSWER_END requires lease");
    const seqBi = BigInt(String(seq));
    const seqKey = `${String(sessionEpoch)}:${String(streamId)}:downlink`;
    const last = lastSeq.get(seqKey);
    if (last !== undefined && seqBi <= last) throw pipelineError("seq_stale", "ANSWER_END seq stale");
    lastSeq.set(seqKey, seqBi);
    const ak = answerKeyFor(sessionEpoch, streamId, answer_id);
    if (closedAnswers.has(ak) || answerTerminal.has(ak)) throw pipelineError("answer_ended", "Duplicate ANSWER_END");
    answerTerminal.set(ak, true);
    return { utterance_id, answer_id };
  }
  function handleAnswerEndWithExpiry({ sessionEpoch, streamId, leaseRef, payload, seq, manifestExpired }) {
    if (manifestExpired) {
      handleLifecycleClose("lease_expired");
      throw pipelineError("lease_expired", "Manifest expired at ANSWER_END");
    }
    return handleAnswerEnd({ sessionEpoch, streamId, leaseRef, payload, seq });
  }
  function drainPlayback(sessionEpoch, streamId, answerId) {
    const ak = answerKeyFor(sessionEpoch, streamId, answerId);
    const q = playbackJitter.get(ak);
    let drained=0;
    if (q) { while(q.length>0){ q.shift(); drained++; } playbackJitter.delete(ak); }
    answerTerminal.delete(ak);
    closedAnswers.add(ak);
    return drained;
  }

  function handleCancel({ sessionEpoch, streamId, payload }) {
    const { utterance_id } = decodeCancelPayload(payload);
    const k = keyFor(sessionEpoch, streamId);
    const state = streams.get(k);
    if (!state) {
      // cancel of unknown utterance is no-op but must not affect other streams
      eventSink({ event_type: "quest.surface.utterance_cancelled", session_epoch: String(sessionEpoch), stream_id: Number(streamId), utterance_id, reason: "unknown_stream_noop" });
      return { cancelled: false, reason: "no_active_utterance" };
    }
    if (state.utteranceId !== utterance_id) {
      // cancel for different utterance on same stream is no-op (stream isolation: only named utterance)
      eventSink({ event_type: "quest.surface.utterance_cancelled", session_epoch: String(sessionEpoch), stream_id: Number(streamId), utterance_id, reason: "utterance_mismatch_noop" });
      return { cancelled: false, reason: "utterance_mismatch" };
    }
    const utteranceId = state.utteranceId;
    try { state.abortController?.abort(); } catch {}
    // release PCM synchronously
    state.chunks = [];
    state.bytesTotal = 0;
    streams.set(k, null);
    // H: synchronous flush per-stream capture jitter only (direction-isolated)
    captureJitter.delete(k);
    eventSink({ event_type: "quest.surface.utterance_cancelled", session_epoch: String(sessionEpoch), stream_id: Number(streamId), utterance_id: utteranceId, reason: payload?.reason ?? "client_cancel" });
    return { cancelled: true, utteranceId };
  }

  async function handleUtteranceEnd({ sessionEpoch, streamId, payload, manifestLeases = null, authorizeLocalAttach = null }) {
    const { utterance_id } = decodeUtteranceEndPayload(payload);
    const k = keyFor(sessionEpoch, streamId);
    const state = streams.get(k);
    if (!state || state.state !== "collecting") {
      throw pipelineError("utterance_not_started", `No collecting utterance on stream ${k} for end`);
    }
    if (state.utteranceId !== utterance_id) {
      throw pipelineError("utterance_id_mismatch", `End utterance ${utterance_id} != active ${state.utteranceId}`);
    }
    // #5: capture generation before awaits; if lifecycle closes, this utterance is invalidated
    // Fix A4/C: AbortSignal per utterance for synchronous abort/release
    const abortSignal = state.abortSignal;
    const startGeneration = state.generation;
    const checkGeneration = () => {
      if (abortSignal.aborted) throw pipelineError("utterance_cancelled", `Utterance ${utterance_id} cancelled by abort`);
      if (sessionGeneration !== startGeneration) throw pipelineError("utterance_cancelled", `Utterance ${utterance_id} cancelled by lifecycle`);
      const cur = streams.get(k);
      // if stream was cleared/reused, also fail
      if (!cur || cur.utteranceId !== utterance_id) throw pipelineError("utterance_cancelled", `Utterance ${utterance_id} no longer active`);
    };
    const withAbort = (promise, signal) => {
      if (signal.aborted) return Promise.reject(pipelineError("utterance_cancelled", `Utterance ${utterance_id} cancelled`));
      return Promise.race([
        promise,
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(pipelineError("utterance_cancelled", `Utterance ${utterance_id} aborted`)), { once: true });
        }),
      ]);
    };
    // VAD gate: silence-only utterance produces no answer
    const pcmBytes = Buffer.concat(state.chunks);
    const voiced = state.voiced;
    // keep state until generation check passes after awaits, but mark as ending
    state.state = "ending";

    if (voiced === 0) {
      streams.set(k, null);
      eventSink({ event_type: "quest.surface.utterance_dropped", session_epoch: String(sessionEpoch), stream_id: Number(streamId), utterance_id, reason: "vad_silence_only" });
      return { dropped: true, reason: "vad_silence_only", utteranceId: utterance_id, answerId: "" };
    }

    // Enforce lease binding if manifest provided: need mic_capture lease_ref match and local_attach lease existence
    if (manifestLeases) {
      if (!manifestLeases.mic_capture || state.leaseRef !== manifestLeases.mic_capture.lease_id) {
        streams.set(k, null);
        throw pipelineError("lease_ref_mismatch", "Utterance lease_ref does not match mic_capture leaf");
      }
      // #3: local_attach must exist; rechecked via authorizeLocalAttach at sink
    }

    // #3: recheck local_attach sink authority before model attachment, after STT
    if (authorizeLocalAttach) {
      const auth = await withAbort(authorizeLocalAttach(), abortSignal);
      if (!auth || !auth.allowed) {
        streams.set(k, null);
        throw pipelineError("local_attach_not_authorized", `Local attach not authorized for ${utterance_id}: ${auth?.code ?? "missing"}`);
      }
    } else if (manifestLeases && !manifestLeases.local_attach) {
      streams.set(k, null);
      throw pipelineError("local_attach_missing", `Missing local_attach leaf for ${utterance_id}`);
    }

    // Transcribe (local, no persistence) — abort-aware
    let transcript;
    try {
      const r = await withAbort(Promise.resolve(transcribe(pcmBytes, utterance_id, abortSignal)), abortSignal);
      checkGeneration();
      transcript = typeof r === "string" ? r : r?.transcript ?? `transcript:${utterance_id}`;
    } catch (cause) {
      // release PCM synchronously on abort
      state.chunks = []; state.bytesTotal = 0;
      streams.set(k, null);
      if (cause && cause.code === "utterance_cancelled") throw cause;
      throw pipelineError("stt_failed", `STT failed for ${utterance_id}`, cause);
    }

    // Local model (must be local_only, sink re-checked) — abort-aware
    let answerText;
    let answerId;
    try {
      answerId = `ans-${randomUUID()}`;
      checkGeneration();
      // recheck local_attach immediately before chat (covers revoke/expiry between STT and chat)
      if (authorizeLocalAttach) {
        const auth2 = await withAbort(authorizeLocalAttach(), abortSignal);
        if (!auth2 || !auth2.allowed) {
          state.chunks = []; state.bytesTotal = 0;
          streams.set(k, null);
          throw pipelineError("local_attach_not_authorized", `Local attach revoked before chat for ${utterance_id}: ${auth2?.code ?? "missing"}`);
        }
      }
      const r = await withAbort(Promise.resolve(chat(transcript, utterance_id, answerId, abortSignal)), abortSignal);
      checkGeneration();
      answerText = typeof r === "string" ? r : r?.answerText ?? `Answer to: ${transcript}` ;
      // enforce bounded panel text
      if (Buffer.byteLength(answerText, "utf8") === 0) answerText = "SOMA ACK";
    } catch (cause) {
      state.chunks = []; state.bytesTotal = 0;
      streams.set(k, null);
      if (cause && cause.code === "utterance_cancelled") throw cause;
      if (cause && cause.code === "local_attach_not_authorized") throw cause;
      throw pipelineError("local_model_failed", `Local model failed for ${utterance_id}`, cause);
    }

    // #8: panel correlation — embed answer_id into hashed document (v1b, bound)
    const revision = nextRev();
    let panelPayload;
    try {
      const panelLeaseRef = manifestLeases?.panel?.lease_id ?? leaseRefFor("panel", sessionEpoch);
      panelPayload = createPanelSnapshotPayload({
        revision,
        leaseRef: panelLeaseRef,
        text: answerText,
        surfaceId: panelBase.surface_id ?? "panel.main",
        pose: panelBase.pose ?? undefined,
        bounds: panelBase.bounds ?? undefined,
        answerId: answerId,
        utteranceId: utterance_id,
      });
    } catch (cause) {
      streams.set(k, null);
      throw pipelineError("panel_build_failed", `Panel build failed for ${utterance_id}`, cause);
    }

    // TTS synthesize: stereo 48kHz chunks, each with same answerId + utteranceId — abort-aware
    let ttsChunks;
    try {
      checkGeneration();
      const bufs = await withAbort(Promise.resolve(synthesize(answerText, answerId, utterance_id, abortSignal)), abortSignal);
      checkGeneration();
      const buffers = Array.isArray(bufs) ? bufs : [bufs];
      ttsChunks = buffers.map((buf) => {
        const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
        return createAudioChunkPayload({ utteranceId: utterance_id, answerId, pcmBytes: bytes, channels: 2 });
      });
    } catch (cause) {
      state.chunks = []; state.bytesTotal = 0;
      streams.set(k, null);
      if (cause && cause.code === "utterance_cancelled") throw cause;
      throw pipelineError("tts_failed", `TTS failed for ${utterance_id}`, cause);
    }

    // Provenance: content-free
    eventSink({
      event_type: "quest.surface.answer_paired",
      session_epoch: String(sessionEpoch),
      stream_id: Number(streamId),
      utterance_id,
      answer_id: answerId,
      transcript_chars: transcript.length,
      answer_chars: answerText.length,
      panel_revision: String(revision),
      playback_chunks: ttsChunks.length,
      local_only: true,
    });
    completed.add(answerId);
    streams.set(k, null);
    // Return paired payloads; caller is responsible for framing them as downlink
    return {
      dropped: false,
      utteranceId: utterance_id,
      answerId,
      transcript,
      answerText,
      revision: String(revision),
      panelPayload,
      ttsChunks,
    };
  }

  function handleLifecycleClose(reason) {
    // #5: bump generation + abort per-stream to invalidate in-flight awaits synchronously; clear both collecting and ending
    sessionGeneration++;
    const cleared = [];
    for (const [k, state] of streams.entries()) {
      if (state) {
        try { state.abortController?.abort(); } catch {}
        // release PCM synchronously
        state.chunks = [];
        state.bytesTotal = 0;
        cleared.push({ key: k, utteranceId: state.utteranceId });
        eventSink({ event_type: "quest.surface.utterance_cleared", session_epoch: state.sessionEpoch, stream_id: state.streamId, utterance_id: state.utteranceId, reason });
      }
    }
    streams.clear();
    // H: synchronous flush of jitter queues and terminal overrides drain
    captureJitter.clear();
    playbackJitter.clear();
    answerTerminal.clear();
    closedAnswers.clear();
    lastSeq.clear();
    return cleared;
  }

  function getActiveUtterance(sessionEpoch, streamId) {
    return streams.get(keyFor(sessionEpoch, streamId)) ?? null;
  }

  function getRemainingBufferBytes() {
    let total = 0;
    for (const s of streams.values()) if (s) for (const c of s.chunks) total += c.length;
    return total;
  }

  return {
    handleUtteranceStart,
    handleAudioChunk,
    handleCancel,
    handleUtteranceEnd,
    handleLifecycleClose,
    getActiveUtterance,
    getRemainingBufferBytes,
    enqueueCaptureChunk,
    captureJitterSize,
    enqueuePlaybackChunk,
    playbackJitterSize,
    handleAnswerEnd,
    handleAnswerEndWithExpiry,
    drainPlayback,
    _streams: streams,
    _captureJitter: captureJitter,
    _playbackJitter: playbackJitter,
    _answerTerminal: answerTerminal,
  };
}

function fixtureTranscribe(pcmBytes) {
  // deterministic fixture: voice if non-zero energy (caller already VAD-gated)
  if (!pcmBytes || pcmBytes.length === 0) return { transcript: "", voicedChunks: 0, silenceChunks: 0 };
  // simple: if any sample non-zero, transcript is placeholder
  const hasSignal = pcmBytes.some((b) => b !== 0);
  return { transcript: hasSignal ? "hello soma" : "", voicedChunks: 0, silenceChunks: 0 };
}

function fixtureChat(transcript) {
  if (!transcript || transcript.trim() === "") return { answerText: "SOMA ACK" };
  // echo fixture, bounded
  const clipped = transcript.slice(0, 512);
  return { answerText: `Answer to: ${clipped}` };
}

function fixtureSynthesize(answerText, answerId) {
  // produce one stereo 20ms chunk per ~32 chars, deterministic fill from hash
  const text = String(answerText ?? "SOMA ACK");
  const chunksNeeded = Math.max(1, Math.min(8, Math.ceil(text.length / 32)));
  const out = [];
  for (let i = 0; i < chunksNeeded; i++) {
    const buf = Buffer.alloc(QUEST_SURFACE_AUDIO_PLAYBACK_BYTES, 0x11 + i);
    // encode answerId into first 4 bytes for pairing verification in tests (not audible)
    out.push(buf);
  }
  return out;
}

function pipelineError(code, message, cause = null) {
  const e = new QuestSurfaceProtocolError(code, message);
  if (cause) e.cause = cause;
  return e;
}

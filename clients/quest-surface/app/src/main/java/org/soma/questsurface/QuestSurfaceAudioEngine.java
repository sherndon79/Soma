package org.soma.questsurface;

import java.util.HashMap;
import java.util.Map;

/**
 * Inert, latch-gated audio capture/playback coordinator.
 *
 * Disabled-first: capture never starts unless {@link #startCapture} is
 * explicitly called with an active lease and while the latch is clear.
 * Focus loss, suspend, disconnect, or lease expiry latches the engine; only
 * {@link #deliberateResume(String, boolean)} with a fresh epoch and explicit
 * user action can clear it. Re-don alone never clears.
 *
 * Stream isolation: each (sessionEpoch, streamId) utterance is tracked
 * independently; cancel or failure on one stream never affects another.
 * Buffers are in-memory per utterance and cleared on end/cancel/lifecycle.
 *
 * G ships no AudioRecord/AudioTrack implementation or microphone permission; this class models
 * the state machine with no-op/fake hardware. Any later real hardware path must be injected through
 * {@code hardware}, remains gated by the latch, and requires the separate device gate.
 */
final class QuestSurfaceAudioEngine {
    private static final int MAX_CHUNKS = 1500;
    private static final int MAX_BYTES = 1500 * 3840;
    private static final int JITTER_QUEUE_MS = 200;
    private static final int JITTER_QUEUE_CAPACITY = 10; // 200ms /20ms

    private boolean latched = false;
    private String latchReason = "";
    private String latchedEpoch = "";
    private final Map<String, Utterance> active = new HashMap<>();
    private final Hardware hardware;
    private final Map<String, Playback> playbacks = new HashMap<>();
    // H: bounded jitter queues per-stream, drop-oldest, per-stream isolation (duration-based ≤200ms)
    private final Map<String, java.util.ArrayDeque<byte[]>> captureJitter = new HashMap<>();
    private final Map<String, java.util.ArrayDeque<byte[]>> playbackJitter = new HashMap<>();
    // ANSWER_END terminal tracking: per answer stream key -> closed admission (durable even after drain)
    private final Map<String, Boolean> answerTerminal = new HashMap<>();
    private final java.util.Set<String> closedAnswers = new java.util.HashSet<>();
    // seq per (epoch,stream,direction) for AUDIO_CHUNK/ANSWER_END ordering — BigInteger decimal
    private final Map<String, java.math.BigInteger> lastSeq = new HashMap<>();

    private static final class Playback {
        final String sessionEpoch;
        final long streamId;
        final String leaseRef;
        final String answerId;
        final String utteranceId;
        Playback(String epoch, long sid, String lease, String ans, String utt) {
            sessionEpoch = epoch; streamId = sid; leaseRef = lease; answerId = ans; utteranceId = utt == null ? "" : utt;
        }
    }

    interface Hardware {
        void startHardwareCapture(String sessionEpoch, long streamId, String leaseRef) throws Exception;
        void stopHardwareCapture(String sessionEpoch, long streamId);
        void startHardwarePlayback(String sessionEpoch, long streamId, String leaseRef, byte[] pcm) throws Exception;
        void stopHardwarePlayback(String sessionEpoch, long streamId, String answerId);
    }

    private static final class Utterance {
        final String utteranceId;
        final String sessionEpoch;
        final long streamId;
        final String leaseRef;
        int chunks = 0;
        int durationMs = 0;
        int bytesTotal = 0;
        int voiced = 0;
        Utterance(String uid, String epoch, long sid, String lease) {
            utteranceId = uid; sessionEpoch = epoch; streamId = sid; leaseRef = lease;
        }
    }

    static final class EngineException extends Exception {
        final String code;
        EngineException(String code, String msg) { super(msg); this.code = code; }
    }

    QuestSurfaceAudioEngine(Hardware hardware) {
        this.hardware = hardware != null ? hardware : new NoopHardware();
    }

    QuestSurfaceAudioEngine() { this(null); }

    synchronized boolean isLatched() { return latched; }
    synchronized String latchReason() { return latchReason; }
    synchronized String latchedEpoch() { return latchedEpoch; }

    synchronized void latch(String reason, String epoch) {
        if (latched) return;
        latched = true;
        latchReason = reason == null ? "latch" : reason;
        latchedEpoch = epoch == null ? "" : epoch;
        // immediate stop: stop every active capture and playback hardware stream before clearing
        if (hardware != null) {
            for (Utterance u : active.values()) {
                try { hardware.stopHardwareCapture(u.sessionEpoch, u.streamId); } catch (Exception ignored) {}
            }
            for (Playback p : playbacks.values()) {
                try { hardware.stopHardwarePlayback(p.sessionEpoch, p.streamId, p.answerId); } catch (Exception ignored) {}
            }
        }
        active.clear();
        playbacks.clear();
        // H: synchronous flush of jitter queues and terminal state overrides drain
        captureJitter.clear();
        playbackJitter.clear();
        answerTerminal.clear();
        closedAnswers.clear();
        lastSeq.clear();
    }
    synchronized void latch(String reason) { latch(reason, ""); }

    /** Deliberate resume: requires fresh different epoch and explicit flag. */
    synchronized boolean deliberateResume(String freshEpoch, boolean explicit) {
        if (!latched) return true;
        if (!explicit) return false;
        String fe = freshEpoch == null ? "" : freshEpoch.trim();
        if (fe.isEmpty() || fe.equals("0")) return false;
        if (fe.equals(latchedEpoch)) return false;
        latched = false;
        latchReason = "";
        latchedEpoch = "";
        return true;
    }

    synchronized void startCapture(String sessionEpoch, long streamId, String utteranceId, String leaseRef) throws EngineException {
        if (latched) throw new EngineException("mic_latch_active", "Mic is latched off");
        if (leaseRef == null || leaseRef.trim().isEmpty()) throw new EngineException("lease_ref_required", "Capture requires lease");
        String key = sessionEpoch + ":" + streamId;
        if (active.containsKey(key)) throw new EngineException("utterance_already_active", "Stream already has utterance");
        Utterance u = new Utterance(utteranceId, sessionEpoch, streamId, leaseRef);
        active.put(key, u);
        try {
            hardware.startHardwareCapture(sessionEpoch, streamId, leaseRef);
        } catch (Exception e) {
            active.remove(key);
            throw new EngineException("capture_start_failed", e.getMessage());
        }
    }

    synchronized void pushChunk(String sessionEpoch, long streamId, String utteranceId, byte[] pcm) throws EngineException {
        if (latched) throw new EngineException("mic_latch_active", "Mic latched");
        if (pcm == null || pcm.length == 0) throw new EngineException("pcm_bytes_invalid", "Bad pcm");
        if (pcm.length % 2 != 0) throw new EngineException("pcm_bytes_invalid", "PCM must be even");
        if (pcm.length != 1920 && pcm.length != 3840) throw new EngineException("pcm_bytes_invalid", "PCM must be 1920 or 3840");
        String key = sessionEpoch + ":" + streamId;
        Utterance u = active.get(key);
        if (u == null) throw new EngineException("utterance_not_started", "No utterance on stream");
        if (!u.utteranceId.equals(utteranceId)) throw new EngineException("utterance_id_mismatch", "Chunk id mismatch");
        // #7: enforce cumulative duration (20ms vs 40ms) and byte limit
        int chunkMs = pcm.length == 1920 ? 20 : pcm.length == 3840 ? 40 : -1;
        if (u.durationMs + chunkMs > 30000) throw new EngineException("utterance_too_long", "Exceeds 30s");
        if (u.chunks >= MAX_CHUNKS) throw new EngineException("utterance_too_long", "Too many chunks");
        if (u.bytesTotal + pcm.length > MAX_BYTES) throw new EngineException("utterance_too_long", "Exceeds byte limit");
        u.chunks++;
        u.durationMs += chunkMs;
        u.bytesTotal += pcm.length;
        // VAD stub: non-zero byte means voiced
        boolean voiced = false;
        for (byte b : pcm) if (b != 0) { voiced = true; break; }
        if (voiced) u.voiced++;
    }

    synchronized void startPlayback(String sessionEpoch, long streamId, String leaseRef, String answerId, byte[] pcm) throws EngineException {
        startPlayback(sessionEpoch, streamId, leaseRef, answerId, "", pcm);
    }
    synchronized void startPlayback(String sessionEpoch, long streamId, String leaseRef, String answerId, String utteranceId, byte[] pcm) throws EngineException {
        if (latched) throw new EngineException("mic_latch_active", "Latch blocks playback");
        if (leaseRef == null || leaseRef.trim().isEmpty()) throw new EngineException("lease_ref_required", "Playback requires lease");
        if (answerId == null || answerId.trim().isEmpty()) throw new EngineException("answer_id_invalid", "Playback requires answer_id");
        if (pcm == null || pcm.length == 0) throw new EngineException("pcm_bytes_invalid", "Bad playback pcm");
        if (pcm.length != 3840 && pcm.length != 7680) throw new EngineException("pcm_bytes_invalid", "Playback must be 3840 or 7680");
        String key = sessionEpoch + ":" + streamId + ":" + answerId;
        if (closedAnswers.contains(key) || answerTerminal.containsKey(key)) throw new EngineException("answer_ended", "Answer already closed");
        playbacks.put(key, new Playback(sessionEpoch, streamId, leaseRef, answerId, utteranceId));
        try {
            hardware.startHardwarePlayback(sessionEpoch, streamId, leaseRef, pcm);
        } catch (Exception e) {
            playbacks.remove(key);
            throw new EngineException("playback_start_failed", e.getMessage());
        }
    }
    synchronized void stopPlayback(String sessionEpoch, long streamId, String answerId) {
        Playback p = playbacks.remove(sessionEpoch + ":" + streamId + ":" + answerId);
        if (p != null) {
            try { hardware.stopHardwarePlayback(p.sessionEpoch, p.streamId, p.answerId); } catch (Exception ignored) {}
        }
    }

    /** End utterance: returns true if VAD would have emitted (voiced>0). Clears state. */
    synchronized boolean endCapture(String sessionEpoch, long streamId, String utteranceId) throws EngineException {
        String key = sessionEpoch + ":" + streamId;
        Utterance u = active.get(key);
        if (u == null) throw new EngineException("utterance_not_started", "No utterance to end");
        if (!u.utteranceId.equals(utteranceId)) throw new EngineException("utterance_id_mismatch", "End id mismatch");
        active.remove(key);
        try { hardware.stopHardwareCapture(sessionEpoch, streamId); } catch (Exception ignored) {}
        // H reshaped: successful end must clear capture jitter (no PCM retained)
        captureJitter.remove(key);
        return u.voiced > 0;
    }

    /** Cancel only its named utterance/stream; other streams unaffected. */
    synchronized boolean cancel(String sessionEpoch, long streamId, String utteranceId) {
        String key = sessionEpoch + ":" + streamId;
        Utterance u = active.get(key);
        if (u == null) return false;
        if (!u.utteranceId.equals(utteranceId)) return false;
        active.remove(key);
        try { hardware.stopHardwareCapture(sessionEpoch, streamId); } catch (Exception ignored) {}
        // H: synchronous flush of per-stream capture jitter only (direction-isolated)
        captureJitter.remove(key);
        // do not delete playback jitter: different direction, same numeric streamId is isolated
        return true;
    }

    synchronized void stopCaptureStream(String sessionEpoch, long streamId) {
        Utterance capture = active.remove(sessionEpoch + ":" + streamId);
        if (capture != null) {
            try { hardware.stopHardwareCapture(capture.sessionEpoch, capture.streamId); }
            catch (Exception ignored) {}
        }
        String key = sessionEpoch + ":" + streamId;
        captureJitter.remove(key);
        // playback is downlink direction: isolated, do not flush here
    }

    synchronized void stopPlaybackStream(String sessionEpoch, long streamId) {
        java.util.Iterator<Map.Entry<String, Playback>> iterator = playbacks.entrySet().iterator();
        while (iterator.hasNext()) {
            Playback playback = iterator.next().getValue();
            if (playback.sessionEpoch.equals(sessionEpoch) && playback.streamId == streamId) {
                iterator.remove();
                try {
                    hardware.stopHardwarePlayback(
                            playback.sessionEpoch, playback.streamId, playback.answerId);
                } catch (Exception ignored) {}
            }
        }
        // H reshaped: stream rejection must NOT erase durable terminal tombstones for active epoch
        String prefix = sessionEpoch + ":" + streamId + ":";
        playbackJitter.entrySet().removeIf(e -> e.getKey().startsWith(prefix));
        answerTerminal.entrySet().removeIf(e -> e.getKey().startsWith(prefix));
        // closedAnswers durable: do not remove on stream reject; latch/expiry clears it
    }

    // H: bounded jitter queues ≤200ms drop-oldest (duration-based), per-stream isolation, non-blocking capture
    synchronized void enqueueCaptureChunk(String sessionEpoch, long streamId, byte[] pcm) throws EngineException {
        if (latched) throw new EngineException("mic_latch_active", "Mic latched");
        if (pcm == null || pcm.length == 0) throw new EngineException("pcm_bytes_invalid", "Bad pcm");
        if (pcm.length != 1920 && pcm.length != 3840) throw new EngineException("pcm_bytes_invalid", "Capture PCM must be 1920 or 3840");
        if (streamId == 0) throw new EngineException("stream_id_invalid", "Stream 0 invalid");
        String key = sessionEpoch + ":" + streamId;
        Utterance u = active.get(key);
        if (u == null) throw new EngineException("utterance_not_started", "No utterance on stream");
        java.util.ArrayDeque<byte[]> q = captureJitter.computeIfAbsent(key, k -> new java.util.ArrayDeque<>());
        q.addLast(pcm.clone());
        // duration-bound drop-oldest: total ms > JITTER_QUEUE_MS
        while (jitterDurationMs(q, true) > JITTER_QUEUE_MS) q.removeFirst();
    }
    private static int jitterDurationMs(java.util.ArrayDeque<byte[]> q, boolean capture) {
        int ms = 0;
        for (byte[] b : q) {
            if (capture) ms += (b.length == 1920 ? 20 : 40);
            else ms += (b.length == 3840 ? 20 : 40);
        }
        return ms;
    }
    synchronized int captureJitterSize(String sessionEpoch, long streamId) {
        java.util.ArrayDeque<byte[]> q = captureJitter.get(sessionEpoch + ":" + streamId);
        return q == null ? 0 : q.size();
    }
    synchronized byte[] peekCaptureChunk(String sessionEpoch, long streamId) {
        java.util.ArrayDeque<byte[]> q = captureJitter.get(sessionEpoch + ":" + streamId);
        return q == null || q.isEmpty() ? null : q.peekFirst();
    }
    synchronized byte[] pollCaptureChunk(String sessionEpoch, long streamId) {
        java.util.ArrayDeque<byte[]> q = captureJitter.get(sessionEpoch + ":" + streamId);
        if (q == null || q.isEmpty()) return null;
        byte[] v = q.removeFirst();
        if (q.isEmpty()) captureJitter.remove(sessionEpoch + ":" + streamId);
        return v;
    }
    synchronized void enqueuePlaybackChunk(String sessionEpoch, long streamId, String answerId, byte[] pcm) throws EngineException {
        if (latched) throw new EngineException("mic_latch_active", "Latch blocks playback");
        if (streamId == 0) throw new EngineException("stream_id_invalid", "Stream 0 invalid");
        if (answerId == null || answerId.trim().isEmpty()) throw new EngineException("answer_id_invalid", "Playback requires answer_id");
        if (pcm == null || pcm.length == 0) throw new EngineException("pcm_bytes_invalid", "Bad pcm");
        if (pcm.length != 3840 && pcm.length != 7680) throw new EngineException("pcm_bytes_invalid", "Playback PCM must be 3840 or 7680");
        String key = sessionEpoch + ":" + streamId + ":" + answerId;
        if (answerTerminal.containsKey(key) || closedAnswers.contains(key)) throw new EngineException("answer_ended", "Answer already terminal");
        java.util.ArrayDeque<byte[]> q = playbackJitter.computeIfAbsent(key, k -> new java.util.ArrayDeque<>());
        q.addLast(pcm.clone());
        while (jitterDurationMs(q, false) > JITTER_QUEUE_MS) q.removeFirst();
    }
    synchronized int playbackJitterSize(String sessionEpoch, long streamId, String answerId) {
        java.util.ArrayDeque<byte[]> q = playbackJitter.get(sessionEpoch + ":" + streamId + ":" + answerId);
        return q == null ? 0 : q.size();
    }
    synchronized void handleAnswerEnd(String sessionEpoch, long streamId, String leaseRef, String utteranceId, String answerId, long seq) throws EngineException {
        handleAnswerEnd(sessionEpoch, streamId, leaseRef, utteranceId, answerId, Long.toUnsignedString(seq));
    }
    synchronized void handleAnswerEnd(String sessionEpoch, long streamId, String leaseRef, String utteranceId, String answerId, String seqDecimal) throws EngineException {
        if (latched) throw new EngineException("mic_latch_active", "Latch blocks answer_end");
        if (streamId == 0) throw new EngineException("stream_id_invalid", "Stream 0 invalid for ANSWER_END");
        if (leaseRef == null || leaseRef.trim().isEmpty()) throw new EngineException("lease_ref_required", "ANSWER_END requires lease");
        if (utteranceId == null || utteranceId.trim().isEmpty()) throw new EngineException("utterance_id_invalid", "ANSWER_END requires utterance_id");
        if (answerId == null || answerId.trim().isEmpty()) throw new EngineException("answer_id_invalid", "ANSWER_END requires answer_id");
        java.math.BigInteger seq;
        try { seq = new java.math.BigInteger(seqDecimal); if (seq.signum()<0) throw new NumberFormatException(); } catch (Exception e) { throw new EngineException("seq_invalid", "seq invalid"); }
        String seqKey = sessionEpoch + ":" + streamId + ":downlink";
        java.math.BigInteger last = lastSeq.get(seqKey);
        if (last != null && seq.compareTo(last) <= 0) throw new EngineException("seq_stale", "ANSWER_END seq stale");
        lastSeq.put(seqKey, seq);
        String key = sessionEpoch + ":" + streamId + ":" + answerId;
        if (closedAnswers.contains(key) || answerTerminal.containsKey(key)) throw new EngineException("answer_ended", "Duplicate ANSWER_END");
        Playback p = playbacks.get(key);
        if (p == null) throw new EngineException("playback_not_started", "No playback for ANSWER_END");
        // exact lease equality (audio_present) and utterance correlation
        if (!p.leaseRef.equals(leaseRef)) throw new EngineException("lease_ref_mismatch", "ANSWER_END lease mismatch");
        if (!p.utteranceId.equals(utteranceId)) throw new EngineException("answer_correlation_mismatch", "utterance mismatch");
        if (!p.sessionEpoch.equals(sessionEpoch) || p.streamId != streamId) throw new EngineException("answer_correlation_mismatch", "Epoch/stream mismatch");
        answerTerminal.put(key, Boolean.TRUE);
        // drain-then-clear deferred: caller must drainPlayback (which will consume then close durably)
    }
    synchronized void handleAnswerEndWithExpiry(String sessionEpoch, long streamId, String leaseRef, String utteranceId, String answerId, long seq, boolean manifestExpired) throws EngineException {
        if (manifestExpired) {
            latch("lease_expired", sessionEpoch);
            throw new EngineException("lease_expired", "Manifest expired at ANSWER_END");
        }
        handleAnswerEnd(sessionEpoch, streamId, leaseRef, utteranceId, answerId, Long.toUnsignedString(seq));
    }
    synchronized void handleAnswerEndWithExpiry(String sessionEpoch, long streamId, String leaseRef, String utteranceId, String answerId, String seqDecimal, boolean manifestExpired) throws EngineException {
        if (manifestExpired) {
            latch("lease_expired", sessionEpoch);
            throw new EngineException("lease_expired", "Manifest expired at ANSWER_END");
        }
        handleAnswerEnd(sessionEpoch, streamId, leaseRef, utteranceId, answerId, seqDecimal);
    }
    synchronized int drainPlayback(String sessionEpoch, long streamId, String answerId) {
        String key = sessionEpoch + ":" + streamId + ":" + answerId;
        java.util.ArrayDeque<byte[]> q = playbackJitter.get(key);
        int drained = 0;
        if (q != null) {
            // consume-to-empty: poll each queued PCM before cleanup
            while (!q.isEmpty()) { q.removeFirst(); drained++; }
            playbackJitter.remove(key);
        }
        Playback p = playbacks.remove(key);
        answerTerminal.remove(key);
        // durable closure: further AUDIO_CHUNK or ANSWER_END for same answer must stay refused
        closedAnswers.add(key);
        if (p != null) {
            try { hardware.stopHardwarePlayback(p.sessionEpoch, p.streamId, p.answerId); } catch (Exception ignored) {}
        }
        return drained;
    }
    synchronized boolean isAnswerTerminal(String sessionEpoch, long streamId, String answerId) {
        return answerTerminal.containsKey(sessionEpoch + ":" + streamId + ":" + answerId);
    }
    synchronized void ensurePlaybackEntry(String sessionEpoch, long streamId, String leaseRef, String answerId, String utteranceId) throws EngineException {
        if (latched) throw new EngineException("mic_latch_active", "Latch blocks playback");
        if (leaseRef == null || leaseRef.trim().isEmpty()) throw new EngineException("lease_ref_required", "Playback requires lease");
        if (answerId == null || answerId.trim().isEmpty()) throw new EngineException("answer_id_invalid", "Playback requires answer_id");
        String key = sessionEpoch + ":" + streamId + ":" + answerId;
        if (closedAnswers.contains(key) || answerTerminal.containsKey(key)) throw new EngineException("answer_ended", "Answer already closed");
        playbacks.computeIfAbsent(key, k -> new Playback(sessionEpoch, streamId, leaseRef, answerId, utteranceId));
    }
    synchronized byte[] pollPlaybackChunk(String sessionEpoch, long streamId, String answerId) {
        java.util.ArrayDeque<byte[]> q = playbackJitter.get(sessionEpoch + ":" + streamId + ":" + answerId);
        if (q == null || q.isEmpty()) return null;
        byte[] v = q.removeFirst();
        if (q.isEmpty()) playbackJitter.remove(sessionEpoch + ":" + streamId + ":" + answerId);
        return v;
    }
    synchronized void startHardwareForPolledPlayback(String sessionEpoch, long streamId, String answerId, byte[] pcm) throws EngineException {
        if (latched) throw new EngineException("mic_latch_active", "Latch blocks playback");
        String key = sessionEpoch + ":" + streamId + ":" + answerId;
        Playback p = playbacks.get(key);
        if (p == null) throw new EngineException("playback_not_started", "No playback for answer");
        try { hardware.startHardwarePlayback(sessionEpoch, streamId, p.leaseRef, pcm); } catch (Exception e) { throw new EngineException("playback_start_failed", e.getMessage()); }
    }
    synchronized void recordDownlinkSeq(String sessionEpoch, long streamId, long seq) throws EngineException {
        recordDownlinkSeq(sessionEpoch, streamId, Long.toUnsignedString(seq));
    }
    synchronized void recordDownlinkSeq(String sessionEpoch, long streamId, String seqDecimal) throws EngineException {
        java.math.BigInteger seq = new java.math.BigInteger(seqDecimal);
        String seqKey = sessionEpoch + ":" + streamId + ":downlink";
        java.math.BigInteger last = lastSeq.get(seqKey);
        if (last != null && seq.compareTo(last) <= 0) throw new EngineException("seq_stale", "seq stale");
        lastSeq.put(seqKey, seq);
    }

    synchronized int activeCount() { return active.size(); }
    synchronized int playbackCount() { return playbacks.size(); }
    synchronized int activeChunks(String epoch, long sid) {
        Utterance u = active.get(epoch + ":" + sid);
        return u == null ? 0 : u.chunks;
    }
    synchronized int activeDurationMs(String epoch, long sid) {
        Utterance u = active.get(epoch + ":" + sid);
        return u == null ? 0 : u.durationMs;
    }
    synchronized int remainingBufferBytes() {
        int sum = 0;
        for (Utterance u : active.values()) sum += u.bytesTotal;
        return sum;
    }

    private static final class NoopHardware implements Hardware {
        public void startHardwareCapture(String e, long s, String l) {}
        public void stopHardwareCapture(String e, long s) {}
        public void startHardwarePlayback(String e, long s, String l, byte[] p) {}
        public void stopHardwarePlayback(String e, long s, String a) {}
    }
}

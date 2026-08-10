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

    private boolean latched = false;
    private String latchReason = "";
    private String latchedEpoch = "";
    private final Map<String, Utterance> active = new HashMap<>();
    private final Hardware hardware;
    private final Map<String, Playback> playbacks = new HashMap<>();

    private static final class Playback {
        final String sessionEpoch;
        final long streamId;
        final String leaseRef;
        final String answerId;
        Playback(String epoch, long sid, String lease, String ans) {
            sessionEpoch = epoch; streamId = sid; leaseRef = lease; answerId = ans;
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
        if (latched) throw new EngineException("mic_latch_active", "Latch blocks playback");
        if (leaseRef == null || leaseRef.trim().isEmpty()) throw new EngineException("lease_ref_required", "Playback requires lease");
        if (answerId == null || answerId.trim().isEmpty()) throw new EngineException("answer_id_invalid", "Playback requires answer_id");
        if (pcm == null || pcm.length == 0) throw new EngineException("pcm_bytes_invalid", "Bad playback pcm");
        if (pcm.length != 3840 && pcm.length != 7680) throw new EngineException("pcm_bytes_invalid", "Playback must be 3840 or 7680");
        String key = sessionEpoch + ":" + streamId + ":" + answerId;
        playbacks.put(key, new Playback(sessionEpoch, streamId, leaseRef, answerId));
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
        return true;
    }

    synchronized void stopCaptureStream(String sessionEpoch, long streamId) {
        Utterance capture = active.remove(sessionEpoch + ":" + streamId);
        if (capture != null) {
            try { hardware.stopHardwareCapture(capture.sessionEpoch, capture.streamId); }
            catch (Exception ignored) {}
        }
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

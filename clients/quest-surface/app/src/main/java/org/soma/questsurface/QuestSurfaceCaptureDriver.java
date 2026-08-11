package org.soma.questsurface;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;

/**
 * Continuous microphone capture driver — owns {@link AudioRecord}, runs {@link QuestSurfaceVad},
 * and drives the transport's uplink API. This lives <b>above</b> the transport, not behind the
 * {@code Hardware} interface: capture PCM has no return path through {@code Hardware} (see the
 * device-audio scope doc's asymmetric finding), so the mic is opened here, continuously, and the
 * VAD decides utterance boundaries that call down into {@code sendUtteranceStart / sendAudioChunk /
 * sendUtteranceEnd}.
 *
 * <p><b>Gated, disabled-first.</b> The read loop runs only while {@link Gate#captureEligible()} —
 * focused + affirmative presence + armed episode with the {@code mic_capture} leaf + not latched +
 * mute clear. Eligibility is re-checked every 20 ms frame and immediately before each frame reaches
 * the VAD, so loss of focus/lease/presence stops capture within one frame; the lifecycle also calls
 * {@link #stop} explicitly. On any stop an in-flight utterance is <b>abandoned silently</b>
 * ({@code vad.reset()}) — no trailing {@code UTTERANCE_END}, no trailing audio (runbook P2).
 *
 * <p>Gate 2 (arming the episode) is the operator's act; this driver only makes capture <i>possible</i>
 * once armed. Constructing it captures nothing.
 */
final class QuestSurfaceCaptureDriver {

    /** Source of 20 ms mono S16LE frames. Real impl wraps AudioRecord; tests inject a fake. */
    interface MicSource {
        void open() throws Exception;
        /** Blocking read of up to {@code len} bytes into {@code buf} at {@code offset}. Returns bytes read, 0, or <0 on error. */
        int read(byte[] buf, int offset, int len) throws Exception;
        void close();
    }

    /** Eligibility gate: true only when capture is authorized right now. */
    interface Gate {
        boolean captureEligible();
    }

    /** Narrow uplink surface (the transport adapts its send* methods onto this). */
    interface UplinkSink {
        void utteranceStart(long streamId, String utteranceId) throws Exception;
        void audioChunk(long streamId, String utteranceId, byte[] pcm) throws Exception;
        void utteranceEnd(long streamId, String utteranceId) throws Exception;
        void cancel(long streamId, String utteranceId, String reason);
    }

    /** Capture segmentation mode — client-local, no protocol change. Default PTT. */
    enum Mode { PTT, VAD }

    /** PTT hold signal (native trigger or fake for JVM tests). */
    interface PttSignal {
        boolean held();
    }

    /** Client-local status push to native for on-panel display. */
    interface StatusSink {
        void onStatus(Mode mode, String state);
    }

    private final MicSource mic;
    private final Gate gate;
    private final UplinkSink uplink;
    private final QuestSurfaceVad.Config vadConfig;
    private final PttSignal pttSignal;
    private final StatusSink statusSink;

    private Thread thread;
    private volatile boolean running = false;
    private long streamCounter = 0;

    private volatile Mode desiredMode = Mode.PTT;
    private volatile boolean pttHeldState = false;
    private volatile Mode lastStatusMode = null;
    private volatile String lastStatusState = null;

    QuestSurfaceCaptureDriver(MicSource mic, Gate gate, UplinkSink uplink) {
        this(mic, gate, uplink, QuestSurfaceVad.Config.defaults(), () -> false, null);
    }

    QuestSurfaceCaptureDriver(MicSource mic, Gate gate, UplinkSink uplink, QuestSurfaceVad.Config vadConfig) {
        this(mic, gate, uplink, vadConfig, () -> false, null);
    }

    QuestSurfaceCaptureDriver(MicSource mic, Gate gate, UplinkSink uplink, QuestSurfaceVad.Config vadConfig, PttSignal pttSignal, StatusSink statusSink) {
        if (mic == null || gate == null || uplink == null) throw new IllegalArgumentException("mic, gate, uplink required");
        this.mic = mic;
        this.gate = gate;
        this.uplink = uplink;
        this.vadConfig = vadConfig != null ? vadConfig : QuestSurfaceVad.Config.defaults();
        this.pttSignal = pttSignal != null ? pttSignal : () -> pttHeldState;
        this.statusSink = statusSink;
    }

    // Mode/PTT public surface (client-local, no protocol, not authority). Bounded by Gate.
    Mode mode() { return desiredMode; }
    void setMode(Mode m) {
        if (m == null) return;
        desiredMode = m;
    }
    void toggleMode() { setMode(desiredMode == Mode.PTT ? Mode.VAD : Mode.PTT); }
    void setPttHeld(boolean held) { pttHeldState = held; }
    boolean pttHeld() { return pttHeldState; }

    private volatile boolean inUtterancePtt = false;
    private void pushStatusDeduped(Mode mode, String state) {
        if (statusSink == null || state == null) return;
        Mode prevMode = lastStatusMode;
        String prevState = lastStatusState;
        if (mode == prevMode && state.equals(prevState)) return;
        lastStatusMode = mode;
        lastStatusState = state;
        try { statusSink.onStatus(mode, state); } catch (Exception ignored) {}
    }
    private void pushStatus(String state) {
        pushStatusDeduped(desiredMode, state);
    }

    /** Real AudioRecord-backed mic source (device only). VOICE_RECOGNITION source is tuned for ASR. */
    static MicSource audioRecordSource() {
        return new AudioRecordMicSource();
    }

    synchronized void start() {
        if (running) return;
        running = true;
        thread = new Thread(this::runLoop, "quest-capture");
        thread.setDaemon(true);
        thread.start();
    }

    synchronized void stop(String reason) {
        running = false;
        Thread t = thread;
        thread = null;
        if (t != null) {
            t.interrupt();
            try { t.join(500); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        }
    }

    boolean isRunning() {
        return running;
    }

    private void runLoop() {
        // Per-utterance identity, assigned in the VAD sink callbacks.
        final long[] curStream = {0};
        final String[] curUtt = {""};
        QuestSurfaceVad vad = new QuestSurfaceVad(vadConfig, new QuestSurfaceVad.Sink() {
            @Override public void onUtteranceStart() throws Exception {
                curStream[0] = ++streamCounter;                 // nonzero, monotonic per session
                curUtt[0] = "utt-" + curStream[0];
                uplink.utteranceStart(curStream[0], curUtt[0]);
            }
            @Override public void onVoicedFrame(byte[] frame) throws Exception {
                uplink.audioChunk(curStream[0], curUtt[0], frame);
            }
            @Override public void onUtteranceEnd() throws Exception {
                uplink.utteranceEnd(curStream[0], curUtt[0]);
            }
        });

        try {
            if (!gate.captureEligible()) return;
            mic.open();
            pushStatusDeduped(desiredMode, "idle");
            byte[] acc = new byte[QuestSurfaceVad.FRAME_BYTES];
            int filled = 0;
            Mode appliedMode = desiredMode;
            while (running && gate.captureEligible()) {
                int n;
                try {
                    n = mic.read(acc, filled, QuestSurfaceVad.FRAME_BYTES - filled);
                } catch (Exception readError) {
                    break;
                }
                if (n < 0) break;
                if (n == 0) continue;
                filled += n;
                if (filled < QuestSurfaceVad.FRAME_BYTES) continue;
                filled = 0;
                if (!gate.captureEligible()) break;
                Mode desired = desiredMode;
                if (desired != appliedMode) {
                    if (appliedMode == Mode.PTT && inUtterancePtt) {
                        try {
                            uplink.utteranceEnd(curStream[0], curUtt[0]);
                        } catch (Exception endError) {
                            try { uplink.cancel(curStream[0], curUtt[0], "mode_switch_end_failed"); } catch (Exception ignored) {}
                            inUtterancePtt = false;
                            break; // fail closed: do not enter new mode/stream on failed END
                        }
                        inUtterancePtt = false;
                    } else if (appliedMode == Mode.VAD && vad.inUtterance()) {
                        try { uplink.cancel(curStream[0], curUtt[0], "mode_switch"); } catch (Exception ignored) {}
                        vad.reset();
                    }
                    appliedMode = desired;
                    pushStatusDeduped(appliedMode, inUtterancePtt || vad.inUtterance() ? "capturing" : "idle");
                }
                byte[] frame = acc.clone();
                try {
                    if (appliedMode == Mode.PTT) {
                        boolean held = false;
                        try { held = pttSignal.held(); } catch (Exception ignored) {}
                        if (!held) {
                            if (inUtterancePtt) {
                                uplink.utteranceEnd(curStream[0], curUtt[0]);
                                inUtterancePtt = false;
                                pushStatusDeduped(appliedMode, "idle");
                            }
                            continue;
                        }
                        if (!inUtterancePtt) {
                            curStream[0] = ++streamCounter;
                            curUtt[0] = "utt-" + curStream[0];
                            uplink.utteranceStart(curStream[0], curUtt[0]);
                            inUtterancePtt = true;
                            pushStatusDeduped(appliedMode, "capturing");
                        }
                        uplink.audioChunk(curStream[0], curUtt[0], frame);
                    } else {
                        vad.feed(frame);
                        if (vad.inUtterance()) pushStatusDeduped(appliedMode, "capturing"); else pushStatusDeduped(appliedMode, "idle");
                    }
                } catch (Exception feedError) {
                    if (appliedMode == Mode.PTT && inUtterancePtt) {
                        try { uplink.cancel(curStream[0], curUtt[0], "capture_fault"); } catch (Exception ignored) {}
                        inUtterancePtt = false;
                    } else if (appliedMode == Mode.VAD && vad.inUtterance()) {
                        try { uplink.cancel(curStream[0], curUtt[0], "capture_fault"); } catch (Exception ignored) {}
                    }
                    break;
                }
            }
            // Abnormal exit (stop/gate loss/read failure) while PTT held must NOT send END (P2/N2: no answer on abort).
            // Only observed trigger release while running+eligible and deliberate PTT->VAD switch may END normally.
            if (inUtterancePtt) {
                try { uplink.cancel(curStream[0], curUtt[0], "abandon"); } catch (Exception ignored) {}
                inUtterancePtt = false;
            }
        } catch (Exception openError) {
            // open failed -> fail closed
        } finally {
            vad.reset();
            inUtterancePtt = false;
            pushStatusDeduped(desiredMode, "idle");
            try { mic.close(); } catch (Exception ignored) {}
            running = false;
        }
    }

    private static final class AudioRecordMicSource implements MicSource {
        private static final int SAMPLE_RATE = 48000;
        private static final int CHANNEL = AudioFormat.CHANNEL_IN_MONO;
        private static final int ENCODING = AudioFormat.ENCODING_PCM_16BIT;

        private AudioRecord record;

        @Override
        public void open() throws Exception {
            int minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL, ENCODING);
            if (minBuf <= 0) throw new IllegalStateException("audiorecord_min_buffer_unavailable");
            int bufSize = Math.max(minBuf, QuestSurfaceVad.FRAME_BYTES * 8);
            AudioRecord r = new AudioRecord(
                    MediaRecorder.AudioSource.VOICE_RECOGNITION,
                    SAMPLE_RATE, CHANNEL, ENCODING, bufSize);
            if (r.getState() != AudioRecord.STATE_INITIALIZED) {
                r.release();
                throw new IllegalStateException("audiorecord_not_initialized");
            }
            record = r;
            record.startRecording();
        }

        @Override
        public int read(byte[] buf, int offset, int len) throws Exception {
            AudioRecord r = record;
            if (r == null) return -1;
            return r.read(buf, offset, len);
        }

        @Override
        public void close() {
            AudioRecord r = record;
            record = null;
            if (r != null) {
                try { r.stop(); } catch (Exception ignored) {}
                try { r.release(); } catch (Exception ignored) {}
            }
        }
    }
}

package org.soma.questsurface;

import java.util.ArrayDeque;

/**
 * Voice-activity segmenter — the code that decides when the wearer's voice reaches the wire.
 *
 * <p>Pure Java, no Android dependency, fully unit-testable with synthetic PCM. It owns no
 * microphone and no transport: it consumes fixed 20 ms mono S16LE frames (1920 bytes) and emits
 * utterance boundaries through {@link Sink}. The capture driver that owns {@code AudioRecord} feeds
 * frames in and translates the sink callbacks into {@code UTTERANCE_START / AUDIO_CHUNK /
 * UTTERANCE_END}.
 *
 * <p>v1 is energy-based (RMS threshold) with an onset guard, a pre-roll ring so the start of speech
 * is not clipped, and a trailing-silence hangover. This is deliberate <b>scaffolding to revisit</b>
 * (see the device-audio scope doc): the barge-in / streaming follow-on will want a real VAD
 * (Silero/webrtcvad-class) for low false-onset rate and tight turn-gaps.
 *
 * <p>Fail-closed: {@link #reset()} abandons any in-flight utterance <b>without</b> emitting an end,
 * so a latch/focus-loss produces no trailing frames.
 */
final class QuestSurfaceVad {

    /** 20 ms mono S16LE = 960 samples = 1920 bytes. */
    static final int FRAME_BYTES = 1920;

    interface Sink {
        void onUtteranceStart() throws Exception;
        void onVoicedFrame(byte[] frame) throws Exception;
        void onUtteranceEnd() throws Exception;
    }

    static final class Config {
        /** RMS (over int16 samples) at/above which a frame counts as voiced. */
        final double rmsThreshold;
        /** Consecutive voiced frames required to open an utterance (onset guard against transients). */
        final int onsetFrames;
        /** Trailing silent frames that close an utterance (hangover). 20 = 400 ms. */
        final int hangoverFrames;
        /** Frames of lead-in retained before onset so the start is not clipped (includes onset frames). */
        final int preRollFrames;
        /** Hard cap on frames per utterance; force-close below the engine's 30 s / 1500-chunk limit. */
        final int maxFrames;

        Config(double rmsThreshold, int onsetFrames, int hangoverFrames, int preRollFrames, int maxFrames) {
            this.rmsThreshold = rmsThreshold;
            this.onsetFrames = Math.max(1, onsetFrames);
            this.hangoverFrames = Math.max(1, hangoverFrames);
            this.preRollFrames = Math.max(this.onsetFrames, preRollFrames);
            this.maxFrames = Math.max(this.onsetFrames + 1, maxFrames);
        }

        /** Defaults tuned for a first worn functional test (scaffolding; see scope doc). */
        static Config defaults() {
            // threshold 600, onset 60 ms, hangover 400 ms, pre-roll 100 ms, cap 28 s.
            return new Config(600.0, 3, 20, 5, 1400);
        }
    }

    private enum State { IDLE, SPEAKING }

    private final Config cfg;
    private final Sink sink;
    private final ArrayDeque<byte[]> preRoll = new ArrayDeque<>();

    private State state = State.IDLE;
    private int consecutiveVoiced = 0;
    private int trailingSilence = 0;
    private int framesInUtterance = 0;

    QuestSurfaceVad(Sink sink) {
        this(Config.defaults(), sink);
    }

    QuestSurfaceVad(Config cfg, Sink sink) {
        if (sink == null) throw new IllegalArgumentException("sink required");
        this.cfg = cfg != null ? cfg : Config.defaults();
        this.sink = sink;
    }

    boolean inUtterance() {
        return state == State.SPEAKING;
    }

    /**
     * Feed one 20 ms frame (exactly {@link #FRAME_BYTES} bytes). Emits sink callbacks as boundaries
     * are crossed. Callers accumulate partial {@code AudioRecord} reads into full frames first.
     */
    void feed(byte[] frame) throws Exception {
        if (frame == null || frame.length != FRAME_BYTES) {
            throw new IllegalArgumentException("frame must be " + FRAME_BYTES + " bytes");
        }
        boolean voiced = rms(frame) >= cfg.rmsThreshold;

        if (state == State.IDLE) {
            preRoll.addLast(frame.clone());
            while (preRoll.size() > cfg.preRollFrames) preRoll.removeFirst();
            consecutiveVoiced = voiced ? consecutiveVoiced + 1 : 0;
            if (consecutiveVoiced >= cfg.onsetFrames) {
                openUtterance();
            }
            return;
        }

        // SPEAKING
        sink.onVoicedFrame(frame);
        framesInUtterance++;
        trailingSilence = voiced ? 0 : trailingSilence + 1;
        if (trailingSilence >= cfg.hangoverFrames || framesInUtterance >= cfg.maxFrames) {
            closeUtterance();
        }
    }

    /** Abandon any in-flight utterance silently (latch / focus loss): no trailing frames emitted. */
    void reset() {
        state = State.IDLE;
        consecutiveVoiced = 0;
        trailingSilence = 0;
        framesInUtterance = 0;
        preRoll.clear();
    }

    private void openUtterance() throws Exception {
        sink.onUtteranceStart();
        state = State.SPEAKING;
        framesInUtterance = 0;
        trailingSilence = 0;
        // Flush the pre-roll (which includes the onset frames) in capture order so the start of
        // speech is not clipped, then continue streaming live frames.
        for (byte[] f : preRoll) {
            sink.onVoicedFrame(f);
            framesInUtterance++;
        }
        preRoll.clear();
        consecutiveVoiced = 0;
    }

    private void closeUtterance() throws Exception {
        sink.onUtteranceEnd();
        state = State.IDLE;
        consecutiveVoiced = 0;
        trailingSilence = 0;
        framesInUtterance = 0;
        preRoll.clear();
    }

    /** RMS over S16LE samples in the frame. */
    private static double rms(byte[] frame) {
        long sumSq = 0;
        int samples = frame.length / 2;
        for (int i = 0; i + 1 < frame.length; i += 2) {
            int lo = frame[i] & 0xff;
            int hi = frame[i + 1]; // signed high byte -> sign-extends
            int sample = (hi << 8) | lo;
            sumSq += (long) sample * sample;
        }
        if (samples == 0) return 0.0;
        return Math.sqrt((double) sumSq / (double) samples);
    }
}

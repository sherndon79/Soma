package org.soma.questsurface;

import static org.junit.Assert.*;

import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

/**
 * VAD segmenter behavior against synthetic PCM. This is the consent-critical decision — when the
 * wearer's voice reaches the wire — so the tests assert exact boundary counts, not just "it ran".
 */
public final class QuestSurfaceVadTest {

    /** All-zero 20 ms frame: RMS 0, unvoiced. */
    private static byte[] silence() {
        return new byte[QuestSurfaceVad.FRAME_BYTES];
    }

    /** Constant-amplitude 20 ms frame: RMS == |amp|, voiced when amp >= threshold. */
    private static byte[] tone(int amp) {
        byte[] f = new byte[QuestSurfaceVad.FRAME_BYTES];
        for (int i = 0; i + 1 < f.length; i += 2) {
            f[i] = (byte) (amp & 0xff);
            f[i + 1] = (byte) ((amp >> 8) & 0xff);
        }
        return f;
    }

    private static final class Recorder implements QuestSurfaceVad.Sink {
        final List<String> events = new ArrayList<>();
        int starts = 0, ends = 0, voiced = 0;
        @Override public void onUtteranceStart() { starts++; events.add("start"); }
        @Override public void onVoicedFrame(byte[] frame) {
            voiced++; events.add("frame");
            assertEquals("frame must be full 20ms", QuestSurfaceVad.FRAME_BYTES, frame.length);
        }
        @Override public void onUtteranceEnd() { ends++; events.add("end"); }
    }

    private static void feed(QuestSurfaceVad vad, byte[] frame, int times) throws Exception {
        for (int i = 0; i < times; i++) vad.feed(frame);
    }

    @Test
    public void silenceSpeechSilenceProducesExactlyOneUtterance() throws Exception {
        Recorder r = new Recorder();
        QuestSurfaceVad vad = new QuestSurfaceVad(r);
        feed(vad, silence(), 10);      // pre-speech silence -> nothing
        assertEquals(0, r.starts);
        feed(vad, tone(1000), 30);     // 600 ms of speech
        assertEquals(1, r.starts);
        assertFalse(r.events.contains("end"));
        feed(vad, silence(), 25);      // > 400 ms hangover -> close
        assertEquals("exactly one start", 1, r.starts);
        assertEquals("exactly one end", 1, r.ends);
        // Ordering: start ... frames ... end, in that order.
        assertEquals("start", r.events.get(0));
        assertEquals("end", r.events.get(r.events.size() - 1));
        assertTrue("frames were emitted between", r.voiced > 0);
    }

    @Test
    public void onsetGuardRejectsSingleFrameTransient() throws Exception {
        Recorder r = new Recorder();
        QuestSurfaceVad vad = new QuestSurfaceVad(r);
        vad.feed(tone(1000));          // one loud frame (default onset = 3)
        feed(vad, silence(), 5);
        assertEquals("a single transient must not open an utterance", 0, r.starts);
        assertEquals(0, r.voiced);
    }

    @Test
    public void preRollIsNotClipped() throws Exception {
        Recorder r = new Recorder();
        QuestSurfaceVad vad = new QuestSurfaceVad(r);
        // Speak continuously; onset fires after 3 voiced frames but pre-roll (5) must flush so
        // the first frames are not lost. After 3 frames -> start + flush of the buffered frames.
        feed(vad, tone(1000), 3);
        assertEquals(1, r.starts);
        // pre-roll held the 3 frames seen while IDLE; all are flushed as voiced on open.
        assertEquals("onset frames are not dropped", 3, r.voiced);
    }

    @Test
    public void briefInternalSilenceDoesNotEndUtterance() throws Exception {
        Recorder r = new Recorder();
        QuestSurfaceVad vad = new QuestSurfaceVad(r);
        feed(vad, tone(1000), 5);      // open
        feed(vad, silence(), 10);      // 200 ms gap < 400 ms hangover -> stays open
        assertEquals(0, r.ends);
        feed(vad, tone(1000), 5);      // resume
        assertEquals(0, r.ends);
        feed(vad, silence(), 25);      // now close
        assertEquals(1, r.ends);
        assertEquals(1, r.starts);
    }

    @Test
    public void resetMidUtteranceAbandonsSilentlyNoTrailingFrames() throws Exception {
        Recorder r = new Recorder();
        QuestSurfaceVad vad = new QuestSurfaceVad(r);
        feed(vad, tone(1000), 5);      // open
        int voicedBefore = r.voiced;
        assertTrue(vad.inUtterance());
        vad.reset();                    // latch / focus loss
        assertFalse(vad.inUtterance());
        assertEquals("reset must not emit an end", 0, r.ends);
        // After reset, further frames are treated as a fresh IDLE state; no trailing frames leaked.
        feed(vad, silence(), 3);
        assertEquals("no frames after reset from silence", voicedBefore, r.voiced);
    }

    @Test
    public void forceClosesAtMaxFrames() throws Exception {
        Recorder r = new Recorder();
        // small cap to exercise the force-close cheaply: onset 2, hangover 100, preroll 2, max 10
        QuestSurfaceVad.Config cfg = new QuestSurfaceVad.Config(600.0, 2, 100, 2, 10);
        QuestSurfaceVad vad = new QuestSurfaceVad(cfg, r);
        feed(vad, tone(1000), 40);     // never silent, but must force-close at maxFrames
        assertTrue("long continuous speech is force-closed", r.ends >= 1);
    }
}

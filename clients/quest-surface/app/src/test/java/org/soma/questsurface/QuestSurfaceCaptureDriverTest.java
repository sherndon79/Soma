package org.soma.questsurface;

import static org.junit.Assert.*;

import org.junit.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Capture driver gating + segmentation wiring, threaded, with a fake mic and uplink. Asserts the
 * consent-critical behavior: nothing captured unless eligible; loss of eligibility mid-stream stops
 * capture and abandons the in-flight utterance without a trailing end.
 */
public final class QuestSurfaceCaptureDriverTest {

    private static byte[] silence() { return new byte[QuestSurfaceVad.FRAME_BYTES]; }
    private static byte[] tone(int amp) {
        byte[] f = new byte[QuestSurfaceVad.FRAME_BYTES];
        for (int i = 0; i + 1 < f.length; i += 2) { f[i] = (byte) (amp & 0xff); f[i + 1] = (byte) ((amp >> 8) & 0xff); }
        return f;
    }

    /** Flat-stream fake mic: concatenated frames, honoring offset/len; EOF (-1) when exhausted. */
    private static final class FakeMic implements QuestSurfaceCaptureDriver.MicSource {
        private final byte[] data;
        private int cursor = 0;
        boolean opened = false;
        boolean closed = false;
        final CountDownLatch eof = new CountDownLatch(1);
        FakeMic(List<byte[]> frames) {
            int total = 0; for (byte[] f : frames) total += f.length;
            data = new byte[total];
            int o = 0; for (byte[] f : frames) { System.arraycopy(f, 0, data, o, f.length); o += f.length; }
        }
        @Override public void open() { opened = true; }
        @Override public synchronized int read(byte[] buf, int offset, int len) {
            if (cursor >= data.length) { eof.countDown(); return -1; }
            int n = Math.min(len, data.length - cursor);
            System.arraycopy(data, cursor, buf, offset, n);
            cursor += n;
            return n;
        }
        @Override public void close() { closed = true; }
    }

    private static final class RecordingUplink implements QuestSurfaceCaptureDriver.UplinkSink {
        final List<String> events = new ArrayList<>();
        final AtomicInteger starts = new AtomicInteger(), ends = new AtomicInteger(), chunks = new AtomicInteger();
        volatile long lastStream = 0;
        @Override public synchronized void utteranceStart(long s, String u) { starts.incrementAndGet(); lastStream = s; events.add("start:" + s); }
        @Override public synchronized void audioChunk(long s, String u, byte[] pcm) { chunks.incrementAndGet(); events.add("chunk"); }
        @Override public synchronized void utteranceEnd(long s, String u) { ends.incrementAndGet(); events.add("end"); }
        @Override public synchronized void cancel(long s, String u, String r) { events.add("cancel"); }
    }

    private static List<byte[]> frames(byte[] frame, int n) {
        List<byte[]> l = new ArrayList<>(); for (int i = 0; i < n; i++) l.add(frame); return l;
    }

    @Test(timeout = 5000)
    public void eligibleSilenceSpeechSilenceEmitsOneUtterance() throws Exception {
        List<byte[]> script = new ArrayList<>();
        script.addAll(frames(silence(), 10));
        script.addAll(frames(tone(1000), 30));
        script.addAll(frames(silence(), 25));
        FakeMic mic = new FakeMic(script);
        RecordingUplink up = new RecordingUplink();
        QuestSurfaceCaptureDriver d = new QuestSurfaceCaptureDriver(mic, () -> true, up);
        d.setMode(QuestSurfaceCaptureDriver.Mode.VAD);
        d.start();
        assertTrue("mic reached EOF", mic.eof.await(4, TimeUnit.SECONDS));
        d.stop("test");
        assertTrue("mic opened", mic.opened);
        assertTrue("mic closed", mic.closed);
        assertEquals("one utterance start", 1, up.starts.get());
        assertEquals("one utterance end", 1, up.ends.get());
        assertTrue("nonzero stream id", up.lastStream > 0);
        assertEquals("start", up.events.get(0).split(":")[0]);
        assertEquals("end", up.events.get(up.events.size() - 1));
    }

    @Test(timeout = 5000)
    public void ineligibleNeverOpensMic() throws Exception {
        FakeMic mic = new FakeMic(frames(tone(1000), 30));
        RecordingUplink up = new RecordingUplink();
        QuestSurfaceCaptureDriver d = new QuestSurfaceCaptureDriver(mic, () -> false, up);
        d.start();
        // give the thread a moment to run and exit
        for (int i = 0; i < 100 && d.isRunning(); i++) Thread.sleep(5);
        d.stop("test");
        assertFalse("mic must never open when ineligible", mic.opened);
        assertEquals(0, up.starts.get());
        assertEquals(0, up.chunks.get());
    }

    @Test(timeout = 5000)
    public void eligibilityLostMidUtteranceAbandonsWithoutEnd() throws Exception {
        // long continuous speech; gate flips false after a handful of frames -> stop mid-utterance.
        FakeMic mic = new FakeMic(frames(tone(1000), 200));
        RecordingUplink up = new RecordingUplink();
        final AtomicInteger reads = new AtomicInteger(0);
        QuestSurfaceCaptureDriver.Gate flipping = () -> reads.incrementAndGet() < 12; // eligible for first ~11 checks
        QuestSurfaceCaptureDriver d = new QuestSurfaceCaptureDriver(mic, flipping, up);
        d.setMode(QuestSurfaceCaptureDriver.Mode.VAD);
        d.start();
        for (int i = 0; i < 200 && d.isRunning(); i++) Thread.sleep(5);
        d.stop("test");
        assertTrue("utterance opened before loss", up.starts.get() >= 1);
        assertEquals("no trailing end on abandon", 0, up.ends.get());
        assertTrue("mic released", mic.closed);
    }
}

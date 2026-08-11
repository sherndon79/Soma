package org.soma.questsurface;

import static org.junit.Assert.*;

import org.junit.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/** PTT mode with fake PTT signal (injectable), JVM-only. */
public final class QuestSurfaceCaptureDriverPttTest {

    private static byte[] frame(int amp) {
        byte[] f = new byte[QuestSurfaceVad.FRAME_BYTES];
        for (int i = 0; i + 1 < f.length; i += 2) { f[i] = (byte)(amp & 0xff); f[i+1]=(byte)((amp>>8)&0xff); }
        return f;
    }
    private static byte[] silence() { return new byte[QuestSurfaceVad.FRAME_BYTES]; }

    private static final class FakeMic implements QuestSurfaceCaptureDriver.MicSource {
        private final List<byte[]> frames;
        private int idx = 0;
        final CountDownLatch eof = new CountDownLatch(1);
        FakeMic(List<byte[]> frames) { this.frames = frames; }
        @Override public void open() {}
        @Override public synchronized int read(byte[] buf, int offset, int len) {
            if (idx >= frames.size()) { eof.countDown(); return -1; }
            byte[] f = frames.get(idx++);
            System.arraycopy(f, 0, buf, offset, Math.min(len, f.length));
            return f.length;
        }
        @Override public void close() {}
    }

    // Barrier mic: blocks after barrierAfter reads until gate released
    private static final class BarrierMic implements QuestSurfaceCaptureDriver.MicSource {
        private final List<byte[]> frames;
        private int idx = 0;
        final CountDownLatch eof = new CountDownLatch(1);
        final CountDownLatch blocked = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        final int barrierAfter;
        final AtomicInteger reads = new AtomicInteger(0);
        BarrierMic(List<byte[]> frames, int barrierAfter) { this.frames = frames; this.barrierAfter = barrierAfter; }
        @Override public void open() {}
        @Override public synchronized int read(byte[] buf, int offset, int len) throws Exception {
            if (idx >= frames.size()) { eof.countDown(); return -1; }
            int r = reads.incrementAndGet();
            if (r == barrierAfter) {
                blocked.countDown();
                // wait for release, interruptible (driver stop interrupts)
                try { release.await(3, TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); return -1; }
                if (Thread.currentThread().isInterrupted()) return -1;
            }
            if (idx >= frames.size()) { eof.countDown(); return -1; }
            byte[] f = frames.get(idx++);
            System.arraycopy(f, 0, buf, offset, Math.min(len, f.length));
            return f.length;
        }
        @Override public void close() {}
    }

    private static final class RecordingUplink implements QuestSurfaceCaptureDriver.UplinkSink {
        final AtomicInteger starts = new AtomicInteger(), ends = new AtomicInteger(), chunks = new AtomicInteger();
        final List<String> events = new ArrayList<>();
        final List<String> cancels = new ArrayList<>();
        volatile long lastStartStream = 0;
        volatile String lastStartUtt = "";
        @Override public synchronized void utteranceStart(long s, String u) { starts.incrementAndGet(); lastStartStream=s; lastStartUtt=u; events.add("start:" + s + ":" + u); }
        @Override public synchronized void audioChunk(long s, String u, byte[] pcm) { chunks.incrementAndGet(); events.add("chunk:" + s); }
        @Override public synchronized void utteranceEnd(long s, String u) { ends.incrementAndGet(); events.add("end:" + s + ":" + u); }
        @Override public synchronized void cancel(long s, String u, String r) { cancels.add("cancel:" + s + ":" + u + ":" + r); events.add("cancel:" + s); }
    }

    @Test(timeout = 5000)
    public void pttNotHeldDiscardsFrames() throws Exception {
        AtomicBoolean held = new AtomicBoolean(false);
        List<byte[]> script = new ArrayList<>();
        for (int i=0;i<20;i++) script.add(frame(1000));
        FakeMic mic = new FakeMic(script);
        RecordingUplink up = new RecordingUplink();
        QuestSurfaceCaptureDriver d = new QuestSurfaceCaptureDriver(mic, ()->true, up, QuestSurfaceVad.Config.defaults(), held::get, null);
        d.start();
        assertTrue(mic.eof.await(3, TimeUnit.SECONDS));
        d.stop("test");
        Thread.sleep(100);
        assertEquals(0, up.starts.get());
        assertEquals(0, up.chunks.get());
        assertEquals(0, up.ends.get());
        assertEquals(0, up.cancels.size());
    }

    @Test(timeout = 5000)
    public void pttHeldStreamsAllFramesWithoutVadThreshold() throws Exception {
        AtomicBoolean held = new AtomicBoolean(true);
        List<byte[]> script = new ArrayList<>();
        for (int i=0;i<10;i++) script.add(silence());
        FakeMic mic = new FakeMic(script);
        RecordingUplink up = new RecordingUplink();
        QuestSurfaceCaptureDriver d = new QuestSurfaceCaptureDriver(mic, ()->true, up, QuestSurfaceVad.Config.defaults(), held::get, null);
        d.start();
        assertTrue(mic.eof.await(3, TimeUnit.SECONDS));
        d.stop("test");
        Thread.sleep(100);
        assertEquals(1, up.starts.get());
        assertEquals(10, up.chunks.get());
        // Abnormal exit while held must NOT END (P2/N2), must cancel/abandon
        assertEquals(0, up.ends.get());
        assertEquals(1, up.cancels.size());
    }

    @Test(timeout = 5000)
    public void pttPressReleaseDefinesUtterance() throws Exception {
        final List<byte[]> script = new ArrayList<>();
        for (int i=0;i<15;i++) script.add(frame(1000));
        final AtomicBoolean held = new AtomicBoolean(false);
        final AtomicInteger readCount = new AtomicInteger(0);
        QuestSurfaceCaptureDriver.MicSource countingMic = new QuestSurfaceCaptureDriver.MicSource() {
            int idx=0;
            @Override public void open(){}
            @Override public synchronized int read(byte[] buf,int off,int len){
                if(idx>=script.size()) return -1;
                if(readCount.incrementAndGet()==6) held.set(true);
                if(readCount.get()==11) held.set(false);
                byte[] f=script.get(idx++);
                System.arraycopy(f,0,buf,off,f.length);
                return f.length;
            }
            @Override public void close(){}
        };
        RecordingUplink up = new RecordingUplink();
        QuestSurfaceCaptureDriver d = new QuestSurfaceCaptureDriver(countingMic, ()->true, up, QuestSurfaceVad.Config.defaults(), held::get, null);
        d.start();
        for(int i=0;i<200 && d.isRunning();i++) Thread.sleep(10);
        d.stop("test");
        Thread.sleep(100);
        assertEquals(1, up.starts.get());
        assertTrue(up.chunks.get() >= 4 && up.chunks.get() <= 6);
        // Normal release while running+eligible produces END
        assertEquals(1, up.ends.get());
        assertEquals(0, up.cancels.size());
    }

    @Test(timeout = 2000)
    public void toggleFlipsMode() {
        FakeMic mic = new FakeMic(new ArrayList<>());
        RecordingUplink up = new RecordingUplink();
        QuestSurfaceCaptureDriver d = new QuestSurfaceCaptureDriver(mic, ()->true, up);
        assertEquals(QuestSurfaceCaptureDriver.Mode.PTT, d.mode());
        d.toggleMode();
        assertEquals(QuestSurfaceCaptureDriver.Mode.VAD, d.mode());
        d.toggleMode();
        assertEquals(QuestSurfaceCaptureDriver.Mode.PTT, d.mode());
    }

    @Test(timeout = 5000)
    public void pttAbnormalStopWhileHeldCancelsNotEnds() throws Exception {
        AtomicBoolean held = new AtomicBoolean(true);
        List<byte[]> script = new ArrayList<>();
        for (int i=0;i<50;i++) script.add(frame(1000));
        BarrierMic mic = new BarrierMic(script, 5);
        RecordingUplink up = new RecordingUplink();
        QuestSurfaceCaptureDriver d = new QuestSurfaceCaptureDriver(mic, ()->true, up, QuestSurfaceVad.Config.defaults(), held::get, null);
        d.start();
        // wait for PTT START
        for (int i=0;i<50 && up.starts.get()==0; i++) Thread.sleep(20);
        assertEquals(1, up.starts.get());
        long startedStream = up.lastStartStream;
        // block is now waiting at barrierAfter=5, driver is mid-utterance and held
        assertTrue(mic.blocked.await(2, TimeUnit.SECONDS));
        d.stop("focus_lost");
        // release barrier (driver already stopping, but release to let read return)
        mic.release.countDown();
        Thread.sleep(100);
        assertEquals(0, up.ends.get());
        assertEquals(1, up.cancels.size());
        assertTrue(up.cancels.get(0).contains(String.valueOf(startedStream)));
        assertTrue(up.cancels.get(0).contains("abandon"));
    }

    @Test(timeout = 5000)
    public void pttToVadSwitchClosesPttUtteranceBarrier() throws Exception {
        AtomicBoolean held = new AtomicBoolean(true);
        List<byte[]> script = new ArrayList<>();
        for (int i=0;i<50;i++) script.add(frame(1000));
        BarrierMic mic = new BarrierMic(script, 8);
        RecordingUplink up = new RecordingUplink();
        QuestSurfaceCaptureDriver d = new QuestSurfaceCaptureDriver(mic, ()->true, up, QuestSurfaceVad.Config.defaults(), held::get, null);
        d.start();
        for (int i=0;i<50 && up.starts.get()==0; i++) Thread.sleep(20);
        assertEquals(1, up.starts.get());
        long pttStream = up.lastStartStream;
        assertTrue(mic.blocked.await(2, TimeUnit.SECONDS));
        // Switch while PTT utterance is live, before next frame is fed
        d.setMode(QuestSurfaceCaptureDriver.Mode.VAD);
        mic.release.countDown();
        // Wait for END to be emitted due to live transition (not EOF)
        for (int i=0;i<50 && up.ends.get()==0; i++) Thread.sleep(20);
        assertEquals(1, up.ends.get());
        assertTrue(up.events.indexOf("end:" + pttStream + ":" + up.lastStartUtt) >= 0 || up.events.stream().anyMatch(e -> e.startsWith("end:" + pttStream)));
        // No new VAD start should have occurred yet (silence not voiced) or if it did, it must be after END
        int endIdx = -1, nextStartIdx = -1;
        for (int i=0;i<up.events.size();i++) { if (up.events.get(i).startsWith("end:")) endIdx=i; if (up.events.get(i).startsWith("start:") && i>0) nextStartIdx=i; }
        if (nextStartIdx >=0) assertTrue("END before next START", endIdx < nextStartIdx);
        // Cleanup: let remaining frames drain then stop (should not produce extra END)
        held.set(false);
        Thread.sleep(100);
        assertTrue(mic.eof.await(2, TimeUnit.SECONDS) || !d.isRunning());
        d.stop("test");
        assertEquals(1, up.ends.get());
    }

    @Test(timeout = 5000)
    public void vadToPttSwitchCancelsVadUtteranceBarrier() throws Exception {
        List<byte[]> script = new ArrayList<>();
        for (int i=0;i<10;i++) script.add(silence());
        for (int i=0;i<30;i++) script.add(frame(1200));
        for (int i=0;i<30;i++) script.add(frame(1200));
        BarrierMic mic = new BarrierMic(script, 15); // block after VAD utterance is active
        RecordingUplink up = new RecordingUplink();
        AtomicBoolean held = new AtomicBoolean(false);
        QuestSurfaceCaptureDriver d = new QuestSurfaceCaptureDriver(mic, ()->true, up, QuestSurfaceVad.Config.defaults(), held::get, null);
        d.setMode(QuestSurfaceCaptureDriver.Mode.VAD);
        d.start();
        for (int i=0;i<50 && up.starts.get()==0; i++) Thread.sleep(20);
        assertEquals(1, up.starts.get());
        long vadStream = up.lastStartStream;
        String vadUtt = up.lastStartUtt;
        assertTrue(mic.blocked.await(2, TimeUnit.SECONDS));
        d.setMode(QuestSurfaceCaptureDriver.Mode.PTT);
        mic.release.countDown();
        for (int i=0;i<50 && up.cancels.isEmpty(); i++) Thread.sleep(20);
        assertEquals(1, up.cancels.size());
        assertTrue(up.cancels.get(0).contains(String.valueOf(vadStream)));
        assertTrue(up.cancels.get(0).contains(vadUtt));
        assertTrue(up.cancels.get(0).contains("mode_switch"));
        assertEquals(0, up.ends.get());
        // Ensure no END for same stream after cancel
        Thread.sleep(100);
        assertEquals(0, up.ends.get());
        d.stop("test");
    }
}

package org.soma.questsurface;

import static org.junit.Assert.*;

import android.media.AudioFormat;

import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

public final class QuestSurfaceAudioHardwareTest {

    private static final class FakeHandle implements QuestSurfaceAudioHardware.AudioTrackHandle {
        final List<byte[]> writes = new ArrayList<>();
        boolean playing = false;
        boolean stopped = false;
        boolean released = false;
        int releaseCount = 0;

        @Override public void play() { playing = true; }
        @Override public int write(byte[] audioData, int offset, int size) {
            byte[] copy = new byte[size];
            System.arraycopy(audioData, offset, copy, 0, size);
            writes.add(copy);
            return size;
        }
        @Override public void stop() { stopped = true; playing = false; }
        @Override public void flush() {}
        @Override public void release() { released = true; releaseCount++; }
    }

    private static final class FakeFactory implements QuestSurfaceAudioHardware.AudioTrackFactory {
        int lastSampleRate = -1;
        int lastChannelMask = -1;
        int lastEncoding = -1;
        int lastBufferSize = -1;
        int createCount = 0;
        FakeHandle lastHandle = null;
        final List<FakeHandle> handles = new ArrayList<>();

        @Override public int getMinBufferSize(int sr, int cm, int enc) { return 3840 * 2; }

        @Override public QuestSurfaceAudioHardware.AudioTrackHandle create(int sr, int cm, int enc, int buf) {
            lastSampleRate = sr;
            lastChannelMask = cm;
            lastEncoding = enc;
            lastBufferSize = buf;
            createCount++;
            FakeHandle h = new FakeHandle();
            lastHandle = h;
            handles.add(h);
            return h;
        }
    }

    @Test
    public void requestsStereo48000I16AndWritesInOrderThenReleasesOnStop() throws Exception {
        FakeFactory factory = new FakeFactory();
        QuestSurfaceAudioHardware hw = new QuestSurfaceAudioHardware(factory);

        byte[] chunk1 = new byte[3840]; chunk1[0] = 1; chunk1[1] = 2;
        byte[] chunk2 = new byte[3840]; chunk2[0] = 3; chunk2[1] = 4;

        // cause-matched: feed two chunks then stop, assert both written then released
        hw.startHardwarePlayback("10", 5, "lease-audio", chunk1);
        // config asserted after first creation
        assertEquals(48000, factory.lastSampleRate);
        assertEquals(AudioFormat.CHANNEL_OUT_STEREO, factory.lastChannelMask);
        assertEquals(AudioFormat.ENCODING_PCM_16BIT, factory.lastEncoding);
        assertEquals(1, factory.createCount);

        hw.startHardwarePlayback("10", 5, "lease-audio", chunk2);
        // second chunk reuses same AudioTrack, no new creation
        assertEquals(1, factory.createCount);

        FakeHandle h = factory.lastHandle;
        assertNotNull(h);
        assertEquals(2, h.writes.size());
        assertArrayEquals(chunk1, h.writes.get(0));
        assertArrayEquals(chunk2, h.writes.get(1));
        assertFalse(h.released);

        hw.stopHardwarePlayback("10", 5, "ans-1");
        assertTrue(h.released);
        assertEquals(1, h.releaseCount);
        assertTrue(h.stopped);
        assertEquals(0, hw.activeTrackCount());
    }

    @Test
    public void handles7680ChunkAndMultipleStreamsIsolated() throws Exception {
        FakeFactory factory = new FakeFactory();
        QuestSurfaceAudioHardware hw = new QuestSurfaceAudioHardware(factory);

        byte[] chunk3840 = new byte[3840]; chunk3840[0] = 9;
        byte[] chunk7680 = new byte[7680]; chunk7680[0] = 7;

        hw.startHardwarePlayback("10", 1, "lease-a", chunk3840);
        hw.startHardwarePlayback("10", 2, "lease-a", chunk7680);

        assertEquals(2, factory.createCount);
        assertEquals(2, hw.activeTrackCount());

        // verify writes per handle
        FakeHandle h1 = factory.handles.get(0);
        FakeHandle h2 = factory.handles.get(1);
        assertEquals(1, h1.writes.size());
        assertEquals(3840, h1.writes.get(0).length);
        assertEquals(1, h2.writes.size());
        assertEquals(7680, h2.writes.get(0).length);

        hw.stopHardwarePlayback("10", 1, "ans-1");
        assertEquals(1, hw.activeTrackCount());
        assertTrue(h1.released);
        assertFalse(h2.released);

        hw.stopHardwarePlayback("10", 2, "ans-2");
        assertEquals(0, hw.activeTrackCount());
        assertTrue(h2.released);
    }

    @Test
    public void captureIsNoOpAndNoPcmRetainedBeyondWrite() throws Exception {
        FakeFactory factory = new FakeFactory();
        QuestSurfaceAudioHardware hw = new QuestSurfaceAudioHardware(factory);

        // capture no-op must not create tracks
        hw.startHardwareCapture("1", 1, "lease-mic");
        hw.stopHardwareCapture("1", 1);
        assertEquals(0, factory.createCount);
        assertEquals(0, hw.activeTrackCount());

        // playback: ensure pcm is copied, not retained by reference
        byte[] chunk = new byte[3840]; chunk[0] = 42;
        hw.startHardwarePlayback("1", 10, "lease-a", chunk);
        chunk[0] = 99; // mutate original after write
        FakeHandle h = factory.lastHandle;
        assertEquals(42, h.writes.get(0)[0]); // written copy retains original value

        hw.stopHardwarePlayback("1", 10, "ans-1");
        assertTrue(h.released);
    }

    @Test
    public void engineIntegrationReleasesOnLatchSynchronously() throws Exception {
        FakeFactory factory = new FakeFactory();
        QuestSurfaceAudioHardware hw = new QuestSurfaceAudioHardware(factory);
        QuestSurfaceAudioEngine engine = new QuestSurfaceAudioEngine(hw);

        engine.startPlayback("10", 5, "lease-audio", "ans-1", new byte[3840]);
        engine.enqueuePlaybackChunk("10", 5, "ans-1", new byte[3840]);
        // Engine holds playback; hardware has one track
        assertEquals(1, factory.createCount);
        assertEquals(1, hw.activeTrackCount());
        FakeHandle h = factory.lastHandle;
        assertFalse(h.released);

        // latch must release track synchronously via engine's iteration over playbacks
        engine.latch("focus_lost", "10");
        assertTrue(h.released);
        assertTrue(h.stopped);
        assertEquals(0, hw.activeTrackCount());
        assertEquals(0, engine.playbackCount());
    }
}

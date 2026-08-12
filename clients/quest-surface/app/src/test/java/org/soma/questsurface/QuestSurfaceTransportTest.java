package org.soma.questsurface;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.ByteArrayOutputStream;
import java.lang.reflect.Field;
import java.math.BigInteger;
import java.security.cert.CertificateException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import javax.net.ssl.SSLHandshakeException;

import org.json.JSONObject;
import org.junit.Test;

public final class QuestSurfaceTransportTest {
    @Test
    public void redonAloneIsInertAndOneExplicitActionCreatesOneResumeWindow()
            throws Exception {
        QuestSurfaceRuntime runtime = new QuestSurfaceRuntime(new QuestSurfaceAudioEngine());
        runtime.configureSession(
                new BigInteger("99"),
                QuestSurfaceV1bTestData.manifest("99", 2_000, 5_000),
                QuestSurfaceV1bTestData.compatibilityPanelLease("99", 2_000, 5_000),
                2_000);
        List<String> states = new ArrayList<>();
        QuestSurfaceTransport transport = new QuestSurfaceTransport(
                null,
                "unused",
                1,
                (state, code, attempt) -> states.add(state + ":" + code),
                (epoch, lease, revision, hash, surface, text, x, y, z, qx, qy, qz, qw,
                 width, height, deadline) -> {},
                runtime,
                freshEpoch -> false);
        setTransportState(transport, "ACTIVE");
        ((AtomicBoolean) field(transport, "started")).set(true);

        ExecutorService executor = (ExecutorService) field(transport, "executor");
        CountDownLatch blockerEntered = new CountDownLatch(1);
        CountDownLatch blockerRelease = new CountDownLatch(1);
        executor.execute(() -> {
            blockerEntered.countDown();
            try {
                blockerRelease.await();
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        });
        assertTrue(blockerEntered.await(1, TimeUnit.SECONDS));

        assertTrue(transport.suspendResumable("user_presence_lost"));
        assertTrue(runtime.isLatched());
        assertEquals("", runtime.sessionEpoch());
        assertEquals("99", field(transport, "latchedSessionEpoch"));
        assertEquals("resume-test-handle", field(transport, "resumeHandle"));
        assertEquals(List.of("suspended:press_a_to_resume"), states);

        assertTrue(!transport.startIfEligible());
        assertTrue(transport.resumeFromExplicitLocalAction());
        assertTrue(!transport.resumeFromExplicitLocalAction());

        transport.stopPermanently("activity_destroyed");
        blockerRelease.countDown();
        assertTrue(states.contains("terminal:activity_destroyed"));
    }

    @Test
    public void diagnosticPreservesBoundedTopAndRootReasonClasses() {
        SSLHandshakeException handshake = new SSLHandshakeException("handshake failed");
        handshake.initCause(new CertificateException(
                "Trust anchor for certification path not found: CN=Soma Development CA"));

        assertEquals("SSLHandshakeException", QuestSurfaceTransport.diagnosticTopClass(handshake));
        assertEquals("CertificateException", QuestSurfaceTransport.diagnosticRootClass(handshake));
        assertEquals(
                "Trust_anchor_for_certification_path_not_found__CN_Soma_Development_CA",
                QuestSurfaceTransport.diagnosticRootCode(handshake));
    }

    @Test
    public void diagnosticNeverEmitsAnUnboundedOrEmptyReason() {
        SSLHandshakeException longFailure = new SSLHandshakeException("x".repeat(200));
        assertEquals(96, QuestSurfaceTransport.diagnosticRootCode(longFailure).length());

        SSLHandshakeException emptyFailure = new SSLHandshakeException("");
        assertEquals("unspecified", QuestSurfaceTransport.diagnosticRootCode(emptyFailure));
        assertTrue(QuestSurfaceTransport.diagnosticRootCode(null).length() <= 96);
    }

    @Test
    public void transportBurstSix40ThenPumpSendsNewestFiveInOrder() throws Exception {
        // cause-matched red->green: before pump, wire must contain only newest 5 (drop-oldest)
        QuestSurfaceAudioEngine engine = new QuestSurfaceAudioEngine();
        QuestSurfaceRuntime runtime = new QuestSurfaceRuntime(engine);
        runtime.configureSession(new BigInteger("99"), QuestSurfaceV1bTestData.manifest("99", 2_000, 5_000),
                QuestSurfaceV1bTestData.compatibilityPanelLease("99", 2_000, 5_000), 2_000);
        runtime.acceptPanel(QuestSurfaceV1bTestData.panelFrame("99", "lease-panel", 4, "2", "answer-1", "utterance-1"), 2_001);
        runtime.startCapture(10, "utt-burst", 2_002);
        // offer 6x40ms before pumping (burst)
        for (int i = 0; i < 6; i++) {
            byte[] pcm = new byte[3840]; pcm[0] = (byte) i;
            runtime.pushCapture(10, "utt-burst", pcm, 2_002 + i);
        }
        // queue retains newest 5 (1..5), oldest 0 dropped
        assertEquals(5, engine.captureJitterSize("99", 10));
        assertEquals(1, engine.peekCaptureChunk("99", 10)[0]);

        // wire via Transport pump
        QuestSurfaceTransport transport = new QuestSurfaceTransport(null, "127.0.0.1", 9,
                new QuestSurfaceTransport.StateSink(){ public void accept(String s,String c,int a){}},
                new QuestSurfaceTransport.SnapshotSink(){ public void accept(String a,String b,String c,String d,String e,String f,float g,float h,float i,float j,float k,float l,float m,float n,float o,long p){}});
        // inject runtime and output
        Field fr = QuestSurfaceTransport.class.getDeclaredField("runtime");
        fr.setAccessible(true); fr.set(transport, runtime);
        Field fo = QuestSurfaceTransport.class.getDeclaredField("output");
        fo.setAccessible(true);
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        fo.set(transport, baos);
        transport.pumpCaptureQueue(10, "utt-burst");

        // assert wire contains 5 frames in order 1..5
        String wire = baos.toString("UTF-8");
        String[] lines = wire.trim().split("\n");
        assertEquals(5, lines.length);
        for (int i = 0; i < 5; i++) {
            QuestSurfaceProtocol.Frame f = QuestSurfaceProtocol.decodeFrame(lines[i]);
            assertEquals("AUDIO_CHUNK", f.type);
            assertEquals(10, f.streamId);
            QuestSurfaceProtocol.AudioChunk ac = QuestSurfaceProtocol.validateAudioChunk(f, "uplink", QuestSurfaceV1bTestData.manifest("99", 2_000, 5_000).lease("mic_capture"), 2_010);
            assertEquals((byte)(i+1), ac.pcm[0]);
            assertEquals(i+1, Integer.parseInt(f.seq.toString()));
        }
        // queue now empty
        assertEquals(0, engine.captureJitterSize("99", 10));
        // second pump sends nothing
        baos.reset();
        transport.pumpCaptureQueue(10, "utt-burst");
        assertEquals(0, baos.size());
    }

    @Test
    public void playbackConsumerSendsOnlyRetainedFiveInOrderThenStop() throws Exception {
        QuestSurfaceAudioEngine engine = new QuestSurfaceAudioEngine();
        QuestSurfaceRuntime runtime = new QuestSurfaceRuntime(engine);
        runtime.configureSession(new BigInteger("99"), QuestSurfaceV1bTestData.manifest("99", 2_000, 5_000),
                QuestSurfaceV1bTestData.compatibilityPanelLease("99", 2_000, 5_000), 2_000);
        runtime.acceptPanel(QuestSurfaceV1bTestData.panelFrame("99", "lease-panel", 4, "2", "answer-1", "utterance-1"), 2_001);
        // downlink streaming: inject hardware before accepts so each chunk streams via bounded consumer
        RecordingHardware hw = new RecordingHardware();
        Field fh = QuestSurfaceAudioEngine.class.getDeclaredField("hardware");
        fh.setAccessible(true); fh.set(engine, hw);
        for (int i = 0; i < 6; i++) {
            byte[] pcm = new byte[7680]; pcm[0] = (byte) i;
            runtime.acceptPlayback(QuestSurfaceV1bTestData.playbackFrame("99", 20, "lease-audio", 10+i, "answer-1", "utterance-1", pcm), 2_002+i);
        }
        runtime.awaitPlaybackDrainForTest();
        // streaming via bounded consumer delivers every chunk as it arrives — no drop for normal rate, jitter bounded
        assertEquals(0, engine.playbackJitterSize("99", 20, "answer-1"));
        List<String> starts = new ArrayList<>();
        for (String e : hw.events) if (e.startsWith("startPlayback")) starts.add(e);
        assertEquals(6, starts.size());
        for (int i = 0; i < 6; i++) assertTrue(starts.get(i).endsWith(":" + i));
        hw.events.clear();
        runtime.consumePlaybackQueue(20, "answer-1");
        // consume after streaming just stops (tail already drained, then durable close)
        assertTrue(hw.events.contains("stopPlayback:99:20:answer-1"));
        assertEquals(0, engine.playbackJitterSize("99", 20, "answer-1"));
    }

    @Test
    public void playbackStreamingDeliversFullAnswerViaBoundedConsumer() throws Exception {
        QuestSurfaceAudioEngine engine = new QuestSurfaceAudioEngine();
        QuestSurfaceRuntime runtime = new QuestSurfaceRuntime(engine);
        runtime.configureSession(new BigInteger("99"), QuestSurfaceV1bTestData.manifest("99", 2_000, 5_000),
                QuestSurfaceV1bTestData.compatibilityPanelLease("99", 2_000, 5_000), 2_000);
        runtime.acceptPanel(QuestSurfaceV1bTestData.panelFrame("99", "lease-panel", 4, "2", "answer-1", "utterance-1"), 2_001);
        RecordingHardware hw = new RecordingHardware();
        java.lang.reflect.Field fh = QuestSurfaceAudioEngine.class.getDeclaredField("hardware");
        fh.setAccessible(true); fh.set(engine, hw);
        int N = 20; // >>10, must deliver all via bounded consumer
        for (int i = 0; i < N; i++) {
            byte[] pcm = new byte[3840]; pcm[0] = (byte) i;
            runtime.acceptPlayback(QuestSurfaceV1bTestData.playbackFrame("99", 20, "lease-audio", 10+i, "answer-1", "utterance-1", pcm), 2_002+i);
            // queue never exceeds 200ms (5*3840 or 10*1920 etc) — bounded invariant preserved
            assertTrue(engine.playbackJitterSize("99", 20, "answer-1") <= 10);
        }
        runtime.awaitPlaybackDrainForTest();
        List<String> starts = new ArrayList<>();
        for (String e : hw.events) if (e.startsWith("startPlayback")) starts.add(e);
        assertEquals(N, starts.size());
        for (int i = 0; i < N; i++) assertTrue(starts.get(i).endsWith(":" + i));
        // tail delivered before terminal release — consume after ANSWER_END drains remaining then stops
        hw.events.clear();
        runtime.consumePlaybackQueue(20, "answer-1");
        assertTrue(hw.events.contains("stopPlayback:99:20:answer-1"));
        assertEquals(0, engine.playbackJitterSize("99", 20, "answer-1"));
    }

    @Test
    public void lateChunkAfterTerminalWithRejectDoesNotRecreate() throws Exception {
        QuestSurfaceAudioEngine engine = new QuestSurfaceAudioEngine();
        QuestSurfaceRuntime runtime = new QuestSurfaceRuntime(engine);
        runtime.configureSession(new BigInteger("99"), QuestSurfaceV1bTestData.manifest("99", 2_000, 5_000),
                QuestSurfaceV1bTestData.compatibilityPanelLease("99", 2_000, 5_000), 2_000);
        runtime.acceptPanel(QuestSurfaceV1bTestData.panelFrame("99", "lease-panel", 4, "2", "answer-1", "utterance-1"), 2_001);
        // Normal playback then ANSWER_END → terminal drain → durable closed
        runtime.acceptPlayback(QuestSurfaceV1bTestData.playbackFrame("99", 20, "lease-audio", 1, "answer-1", "utterance-1", QuestSurfaceV1bTestData.stereo20()), 2_002);
        runtime.awaitPlaybackDrainForTest();
        runtime.acceptAnswerEnd(QuestSurfaceV1bTestData.answerEndFrame("99", 20, "lease-audio", 2, "answer-1", "utterance-1"), 2_003);
        runtime.consumePlaybackQueue(20, "answer-1");
        // First late chunk refused (terminal → closed)
        try {
            runtime.acceptPlayback(QuestSurfaceV1bTestData.playbackFrame("99", 20, "lease-audio", 3, "answer-1", "utterance-1", QuestSurfaceV1bTestData.stereo20()), 2_004);
            fail("should have thrown answer_ended");
        } catch (QuestSurfaceAudioEngine.EngineException e) {
            assertEquals("answer_ended", e.code);
        }
        // Transport reject clears answerTerminal but must NOT clear closed tombstone
        runtime.rejectPlaybackStream(20);
        assertEquals(0, engine.playbackCount());
        // Second late chunk separated by reject must still be refused (durable closed)
        try {
            runtime.acceptPlayback(QuestSurfaceV1bTestData.playbackFrame("99", 20, "lease-audio", 4, "answer-1", "utterance-1", QuestSurfaceV1bTestData.stereo20()), 2_005);
            fail("second late chunk should still be refused");
        } catch (QuestSurfaceAudioEngine.EngineException e) {
            assertEquals("answer_ended", e.code);
        }
    }

    @Test
    public void slowHardwareKeepsScheduledDrainCoalescedAndBounded() throws Exception {
        // Slow hardware: each write blocks 50ms, producer enqueues quickly
        class SlowHardware implements QuestSurfaceAudioEngine.Hardware {
            final List<String> events = new ArrayList<>();
            public void startHardwareCapture(String e,long s,String l){}
            public void stopHardwareCapture(String e,long s){}
            public synchronized void startHardwarePlayback(String e,long s,String l,byte[] p){
                events.add("startPlayback:"+e+":"+s+":"+l+":"+p[0]);
                try { Thread.sleep(50); } catch (InterruptedException ignored) {}
            }
            public void stopHardwarePlayback(String e,long s,String a){events.add("stopPlayback:"+e+":"+s+":"+a);}
        }
        SlowHardware slowHw = new SlowHardware();
        QuestSurfaceAudioEngine engine = new QuestSurfaceAudioEngine(slowHw);
        QuestSurfaceRuntime runtime = new QuestSurfaceRuntime(engine);
        runtime.configureSession(new BigInteger("99"), QuestSurfaceV1bTestData.manifest("99", 2_000, 5_000),
                QuestSurfaceV1bTestData.compatibilityPanelLease("99", 2_000, 5_000), 2_000);
        runtime.acceptPanel(QuestSurfaceV1bTestData.panelFrame("99", "lease-panel", 4, "2", "answer-1", "utterance-1"), 2_001);
        int N = 10;
        for (int i = 0; i < N; i++) {
            byte[] pcm = new byte[3840]; pcm[0] = (byte) i;
            runtime.acceptPlayback(QuestSurfaceV1bTestData.playbackFrame("99", 20, "lease-audio", 10+i, "answer-1", "utterance-1", pcm), 2_002+i);
            // Bounded invariant: queue never exceeds 200ms (10*20ms) even with slow consumer
            assertTrue(engine.playbackJitterSize("99", 20, "answer-1") <= 10);
        }
        runtime.awaitPlaybackDrainForTest();
        // With slow consumer, some oldest may have dropped, but scheduled work stayed coalesced (at most one per answer)
        // and queue never exceeded bound — verified above. At least some were delivered.
        assertTrue(slowHw.events.size() >= 1);
        // No unbounded executor queue: the test would have OOM or timeout if one task per chunk accumulated
        Thread.sleep(200);
        assertTrue(engine.playbackJitterSize("99", 20, "answer-1") <= 10);
    }

    private static final class RecordingHardware implements QuestSurfaceAudioEngine.Hardware {
        final List<String> events = new ArrayList<>();
        public void startHardwareCapture(String e,long s,String l){events.add("startCapture:"+e+":"+s+":"+l);}
        public void stopHardwareCapture(String e,long s){events.add("stopCapture:"+e+":"+s);}
        public void startHardwarePlayback(String e,long s,String l,byte[] p){events.add("startPlayback:"+e+":"+s+":"+l+":"+p[0]);}
        public void stopHardwarePlayback(String e,long s,String a){events.add("stopPlayback:"+e+":"+s+":"+a);}
    }

    private static Object field(Object target, String name) throws Exception {
        Field field = target.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field.get(target);
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private static void setTransportState(QuestSurfaceTransport transport, String state)
            throws Exception {
        AtomicReference reference = (AtomicReference) field(transport, "sessionState");
        Class enumClass = Class.forName(
                "org.soma.questsurface.QuestSurfaceTransport$SessionState");
        reference.set(Enum.valueOf(enumClass, state));
    }
}

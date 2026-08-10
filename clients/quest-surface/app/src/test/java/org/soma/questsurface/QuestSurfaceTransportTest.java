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

import javax.net.ssl.SSLHandshakeException;

import org.json.JSONObject;
import org.junit.Test;

public final class QuestSurfaceTransportTest {
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
        // enqueue 6x40 playback before consuming
        for (int i = 0; i < 6; i++) {
            byte[] pcm = new byte[7680]; pcm[0] = (byte) i;
            runtime.acceptPlayback(QuestSurfaceV1bTestData.playbackFrame("99", 20, "lease-audio", 10+i, "answer-1", "utterance-1", pcm), 2_002+i);
        }
        // queue retains newest 5 (1..5) -> 5*40=200
        assertEquals(5, engine.playbackJitterSize("99", 20, "answer-1"));
        // consume should send only retained 5 in order via hardware
        RecordingHardware hw = new RecordingHardware();
        // replace engine's hardware with recording one via reflection
        Field fh = QuestSurfaceAudioEngine.class.getDeclaredField("hardware");
        fh.setAccessible(true); fh.set(engine, hw);
        runtime.consumePlaybackQueue(20, "answer-1");
        // hardware should have received 5 startPlayback in order 1..5, then stop
        List<String> starts = new ArrayList<>();
        for (String e : hw.events) if (e.startsWith("startPlayback")) starts.add(e);
        assertEquals(5, starts.size());
        for (int i = 0; i < 5; i++) assertTrue(starts.get(i).endsWith(":" + (i+1)));
        assertTrue(hw.events.contains("stopPlayback:99:20:answer-1"));
        assertEquals(0, engine.playbackJitterSize("99", 20, "answer-1"));
    }

    private static final class RecordingHardware implements QuestSurfaceAudioEngine.Hardware {
        final List<String> events = new ArrayList<>();
        public void startHardwareCapture(String e,long s,String l){events.add("startCapture:"+e+":"+s+":"+l);}
        public void stopHardwareCapture(String e,long s){events.add("stopCapture:"+e+":"+s);}
        public void startHardwarePlayback(String e,long s,String l,byte[] p){events.add("startPlayback:"+e+":"+s+":"+l+":"+p[0]);}
        public void stopHardwarePlayback(String e,long s,String a){events.add("stopPlayback:"+e+":"+s+":"+a);}
    }
}

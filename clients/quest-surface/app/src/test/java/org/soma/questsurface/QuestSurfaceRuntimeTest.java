package org.soma.questsurface;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

import java.io.IOException;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.List;

public final class QuestSurfaceRuntimeTest {
    @Test
    public void v1aPanelFallbackRemainsAvailableButCannotAuthorizeAudio() throws Exception {
        RecordingHardware hardware = new RecordingHardware();
        QuestSurfaceRuntime runtime = configuredRuntime("99", 2_000, 5_000, false, hardware);

        QuestSurfaceProtocol.SurfaceSnapshot snapshot = runtime.acceptPanel(
                QuestSurfaceV1bTestData.panelFrame(
                        "99", "lease-panel", 4, "1", null, null),
                2_001);
        assertEquals("ANSWER 1", snapshot.text);
        assertFalse(runtime.hasManifest());

        QuestSurfaceProtocol.ProtocolException error = assertThrows(
                QuestSurfaceProtocol.ProtocolException.class,
                () -> runtime.startCapture(1, "utterance-1", 2_001));
        assertEquals("manifest_required", error.code);
        assertEquals(List.of(), hardware.events);
    }

    @Test
    public void compatibilityPanelLeaseMustMatchManifestAuthority() throws Exception {
        QuestSurfaceProtocol.Manifest manifest = QuestSurfaceV1bTestData.manifest(
                "99", 2_000, 5_000);
        QuestSurfaceProtocol.Lease wrongPanel = new QuestSurfaceProtocol.Lease(
                "lease-other",
                "grant-panel",
                new BigInteger("99"),
                5_000,
                7_000,
                512,
                java.util.Set.of("panel.main"));
        QuestSurfaceRuntime runtime = new QuestSurfaceRuntime(new QuestSurfaceAudioEngine());

        QuestSurfaceProtocol.ProtocolException error = assertThrows(
                QuestSurfaceProtocol.ProtocolException.class,
                () -> runtime.configureSession(
                        new BigInteger("99"), manifest, wrongPanel, 2_000));
        assertEquals("manifest_panel_lease_mismatch", error.code);
    }

    @Test
    public void v1bCaptureAndCorrelatedPlaybackUseExactLeaseLeaves() throws Exception {
        RecordingHardware hardware = new RecordingHardware();
        QuestSurfaceRuntime runtime = configuredRuntime("99", 2_000, 5_000, true, hardware);
        runtime.acceptPanel(
                QuestSurfaceV1bTestData.panelFrame(
                        "99", "lease-panel", 4, "2", "answer-1", "utterance-1"),
                2_001);

        QuestSurfaceProtocol.AudioChunk playback = runtime.acceptPlayback(
                QuestSurfaceV1bTestData.playbackFrame(
                        "99", 101, "lease-audio", 1, "answer-1", "utterance-1",
                        QuestSurfaceV1bTestData.stereo20()),
                2_002);
        assertEquals("answer-1", playback.answerId);
        assertTrue(hardware.events.contains("startPlayback:99:101:lease-audio:3840"));

        JSONObject start = runtime.startCapture(7, "utterance-2", 2_002);
        JSONObject chunk = runtime.pushCapture(
                7, "utterance-2", QuestSurfaceV1bTestData.mono20(), 2_003);
        JSONObject end = runtime.endCapture(7, "utterance-2", 2_004);
        runtime.startCapture(8, "utterance-cancel", 2_004);
        JSONObject cancel = runtime.cancelCapture(
                8, "utterance-cancel", "client_cancel", 2_004);
        QuestSurfaceProtocol.Lease micLease = QuestSurfaceV1bTestData.manifest(
                "99", 2_000, 5_000).lease("mic_capture");
        assertEquals(
                "utterance-2",
                QuestSurfaceProtocol.validateUtteranceFrame(
                        clientFrame("UTTERANCE_START", 7, "lease-mic", 1, start),
                        "UTTERANCE_START", micLease, 2_002));
        assertEquals(
                "utterance-2",
                QuestSurfaceProtocol.validateAudioChunk(
                        clientFrame("AUDIO_CHUNK", 7, "lease-mic", 2, chunk),
                        "uplink", micLease, 2_003).utteranceId);
        assertEquals(
                "utterance-2",
                QuestSurfaceProtocol.validateUtteranceFrame(
                        clientFrame("UTTERANCE_END", 7, "lease-mic", 3, end),
                        "UTTERANCE_END", micLease, 2_004));
        assertEquals(
                "utterance-cancel",
                QuestSurfaceProtocol.validateCancelFrame(
                        clientFrame("CANCEL", 8, "lease-mic", 1, cancel),
                        micLease,
                        2_004));
        assertTrue(hardware.events.contains("startCapture:99:7:lease-mic"));
        assertTrue(hardware.events.contains("stopCapture:99:7"));
        assertTrue(hardware.events.contains("stopCapture:99:8"));
    }

    @Test
    public void rejectsMismatchedPlaybackWithoutPresentingIt() throws Exception {
        RecordingHardware hardware = new RecordingHardware();
        QuestSurfaceRuntime runtime = configuredRuntime("99", 2_000, 5_000, true, hardware);
        runtime.acceptPanel(
                QuestSurfaceV1bTestData.panelFrame(
                        "99", "lease-panel", 4, "2", "answer-1", "utterance-1"),
                2_001);

        QuestSurfaceProtocol.ProtocolException error = assertThrows(
                QuestSurfaceProtocol.ProtocolException.class,
                () -> runtime.acceptPlayback(
                        QuestSurfaceV1bTestData.playbackFrame(
                                "99", 101, "lease-audio", 1,
                                "answer-other", "utterance-1",
                                QuestSurfaceV1bTestData.stereo20()),
                        2_002));
        assertEquals("answer_correlation_mismatch", error.code);
        assertEquals(List.of(), hardware.events);
    }

    @Test
    public void receiveSequenceIsPerEpochStreamDirectionAndPanelStaysOnZero() throws Exception {
        QuestSurfaceRuntime runtime = new QuestSurfaceRuntime(new QuestSurfaceAudioEngine());
        QuestSurfaceProtocol.Frame first = QuestSurfaceV1bTestData.playbackFrame(
                "99", 7, "lease-audio", 1, "answer-1", "utterance-1",
                QuestSurfaceV1bTestData.stereo20());
        QuestSurfaceProtocol.Frame sibling = QuestSurfaceV1bTestData.playbackFrame(
                "99", 8, "lease-audio", 1, "answer-2", "utterance-2",
                QuestSurfaceV1bTestData.stereo20());
        runtime.acceptDownlinkEnvelope(first, new BigInteger("99"));
        runtime.acceptDownlinkEnvelope(sibling, new BigInteger("99"));

        IOException stale = assertThrows(
                IOException.class,
                () -> runtime.acceptDownlinkEnvelope(first, new BigInteger("99")));
        assertEquals("sequence_stale", stale.getMessage());

        IOException wrongEpoch = assertThrows(
                IOException.class,
                () -> runtime.acceptDownlinkEnvelope(
                        QuestSurfaceV1bTestData.playbackFrame(
                                "100", 9, "lease-audio", 1, "answer-3", "utterance-3",
                                QuestSurfaceV1bTestData.stereo20()),
                        new BigInteger("99")));
        assertEquals("session_epoch_mismatch", wrongEpoch.getMessage());

        IOException panelStream = assertThrows(
                IOException.class,
                () -> runtime.acceptDownlinkEnvelope(
                        QuestSurfaceV1bTestData.serverFrame(
                                "PANEL_SNAPSHOT", "99", 3, "lease-panel", 1,
                                new JSONObject()),
                        new BigInteger("99")));
        assertEquals("stream_id_unsupported", panelStream.getMessage());

        IOException audioZero = assertThrows(
                IOException.class,
                () -> runtime.acceptDownlinkEnvelope(
                        QuestSurfaceV1bTestData.playbackFrame(
                                "99", 0, "lease-audio", 1, "answer-4", "utterance-4",
                                QuestSurfaceV1bTestData.stereo20()),
                        new BigInteger("99")));
        assertEquals("audio_stream_id_required", audioZero.getMessage());

        IOException wrongDirection = assertThrows(
                IOException.class,
                () -> runtime.acceptDownlinkEnvelope(
                        clientFrame(
                                "AUDIO_CHUNK", 9, "lease-mic", 1,
                                QuestSurfaceProtocol.audioChunkPayload(
                                        "utterance-9", "", QuestSurfaceV1bTestData.mono20(), 1)),
                        new BigInteger("99")));
        assertEquals("direction_mismatch", wrongDirection.getMessage());
    }

    @Test
    public void uplinkSequenceIsIndependentPerEpochStreamDirection() throws Exception {
        QuestSurfaceSequenceTracker tracker = new QuestSurfaceSequenceTracker();

        assertEquals(1, tracker.next("99", 7, "uplink"));
        assertEquals(2, tracker.next("99", 7, "uplink"));
        assertEquals(1, tracker.next("99", 8, "uplink"));
        assertEquals(1, tracker.next("99", 7, "downlink"));
        assertEquals(1, tracker.next("100", 7, "uplink"));
    }

    @Test
    public void streamRejectionStopsOnlyTheNamedStream() throws Exception {
        RecordingHardware hardware = new RecordingHardware();
        QuestSurfaceAudioEngine engine = new QuestSurfaceAudioEngine(hardware);
        QuestSurfaceRuntime runtime = configuredRuntime("99", 2_000, 5_000, true, engine);
        runtime.startCapture(7, "utterance-7", 2_001);
        runtime.startCapture(8, "utterance-8", 2_001);
        runtime.acceptPanel(
                QuestSurfaceV1bTestData.panelFrame(
                        "99", "lease-panel", 4, "2", "answer-7", "utterance-playback"),
                2_001);
        runtime.acceptPlayback(
                QuestSurfaceV1bTestData.playbackFrame(
                        "99", 7, "lease-audio", 1, "answer-7", "utterance-playback",
                        QuestSurfaceV1bTestData.stereo20()),
                2_001);
        hardware.events.clear();

        runtime.rejectCaptureStream(7);

        assertEquals(List.of("stopCapture:99:7"), hardware.events);
        assertEquals(1, engine.activeCount());
        assertEquals(1, engine.playbackCount());
        assertEquals(0, engine.activeChunks("99", 7));
        runtime.pushCapture(8, "utterance-8", QuestSurfaceV1bTestData.mono20(), 2_002);
        assertEquals(1, engine.activeChunks("99", 8));
        hardware.events.clear();
        runtime.rejectPlaybackStream(7);
        assertEquals(List.of("stopPlayback:99:7:answer-7"), hardware.events);
        assertEquals(1, engine.activeCount());
        assertEquals(0, engine.playbackCount());
    }

    @Test
    public void focusRevokeExpiryAndDisconnectLatchAndStopImmediately() throws Exception {
        assertLifecycleStops("focus_lost");
        assertLifecycleStops("revoke");
        assertLifecycleStops("disconnect");

        RecordingHardware hardware = new RecordingHardware();
        QuestSurfaceAudioEngine engine = new QuestSurfaceAudioEngine(hardware);
        QuestSurfaceRuntime runtime = configuredRuntime("99", 2_000, 5, true, engine);
        runtime.startCapture(7, "utterance-expire", 2_001);
        hardware.events.clear();
        QuestSurfaceProtocol.ProtocolException expired = assertThrows(
                QuestSurfaceProtocol.ProtocolException.class,
                () -> runtime.pushCapture(
                        7, "utterance-expire", QuestSurfaceV1bTestData.mono20(), 2_005));
        assertEquals("lease_expired", expired.code);
        assertEquals(List.of("stopCapture:99:7"), hardware.events);
        assertTrue(runtime.isLatched());
    }

    @Test
    public void reconnectAndRedonDoNotClearLatchWithoutFreshExplicitResume() throws Exception {
        RecordingHardware hardware = new RecordingHardware();
        QuestSurfaceRuntime runtime = configuredRuntime("99", 2_000, 5_000, true, hardware);
        runtime.latch("disconnect");
        assertTrue(runtime.isLatched());
        assertFalse(runtime.deliberateResume("100", false));
        assertFalse(runtime.deliberateResume("99", true));

        QuestSurfaceProtocol.Manifest nextManifest = QuestSurfaceV1bTestData.manifest(
                "100", 3_000, 5_000);
        QuestSurfaceProtocol.Lease nextPanel = QuestSurfaceV1bTestData.compatibilityPanelLease(
                "100", 3_000, 5_000);
        runtime.configureSession(new BigInteger("100"), nextManifest, nextPanel, 3_000);
        QuestSurfaceAudioEngine.EngineException stillLatched = assertThrows(
                QuestSurfaceAudioEngine.EngineException.class,
                () -> runtime.startCapture(7, "utterance-2", 3_001));
        assertEquals("mic_latch_active", stillLatched.code);
        assertTrue(runtime.deliberateResume("100", true));
        runtime.startCapture(7, "utterance-2", 3_001);
        assertTrue(hardware.events.contains("startCapture:100:7:lease-mic"));
    }

    @Test
    public void transportLocalStopUsesTheProductionRuntimeLatch() throws Exception {
        RecordingHardware hardware = new RecordingHardware();
        QuestSurfaceRuntime runtime = configuredRuntime("99", 2_000, 5_000, true, hardware);
        runtime.startCapture(7, "utterance-1", 2_001);
        hardware.events.clear();
        List<String> states = new ArrayList<>();
        QuestSurfaceTransport transport = new QuestSurfaceTransport(
                null,
                "unused",
                1,
                (state, code, attempt) -> states.add(state + ":" + code),
                (epoch, lease, revision, hash, surface, text, x, y, z, qx, qy, qz, qw,
                 width, height, deadline) -> {},
                runtime);

        transport.stopPermanently("focus_lost");

        assertEquals(List.of("stopCapture:99:7"), hardware.events);
        assertEquals(List.of("suspended:focus_lost"), states);
        assertTrue(runtime.isLatched());
    }

    private static void assertLifecycleStops(String reason) throws Exception {
        RecordingHardware hardware = new RecordingHardware();
        QuestSurfaceAudioEngine engine = new QuestSurfaceAudioEngine(hardware);
        QuestSurfaceRuntime runtime = configuredRuntime("99", 2_000, 5_000, true, engine);
        runtime.startCapture(7, "utterance-1", 2_001);
        runtime.acceptPanel(
                QuestSurfaceV1bTestData.panelFrame(
                        "99", "lease-panel", 4, "2", "answer-1", "utterance-1"),
                2_001);
        runtime.acceptPlayback(
                QuestSurfaceV1bTestData.playbackFrame(
                        "99", 101, "lease-audio", 1, "answer-1", "utterance-1",
                        QuestSurfaceV1bTestData.stereo20()),
                2_002);
        hardware.events.clear();

        runtime.latch(reason);

        assertTrue(hardware.events.contains("stopCapture:99:7"));
        assertTrue(hardware.events.contains("stopPlayback:99:101:answer-1"));
        assertEquals(2, hardware.events.size());
        assertEquals(0, engine.activeCount());
        assertEquals(0, engine.playbackCount());
    }

    private static QuestSurfaceRuntime configuredRuntime(
            String epoch,
            long nowElapsedMs,
            long ttlMs,
            boolean withManifest,
            RecordingHardware hardware) throws Exception {
        return configuredRuntime(
                epoch, nowElapsedMs, ttlMs, withManifest,
                new QuestSurfaceAudioEngine(hardware));
    }

    private static QuestSurfaceRuntime configuredRuntime(
            String epoch,
            long nowElapsedMs,
            long ttlMs,
            boolean withManifest,
            QuestSurfaceAudioEngine engine) throws Exception {
        QuestSurfaceRuntime runtime = new QuestSurfaceRuntime(engine);
        runtime.configureSession(
                new BigInteger(epoch),
                withManifest ? QuestSurfaceV1bTestData.manifest(epoch, nowElapsedMs, ttlMs) : null,
                QuestSurfaceV1bTestData.compatibilityPanelLease(epoch, nowElapsedMs, ttlMs),
                nowElapsedMs);
        return runtime;
    }

    private static QuestSurfaceProtocol.Frame clientFrame(
            String type, long streamId, String leaseRef, long sequence, JSONObject payload)
            throws Exception {
        return QuestSurfaceProtocol.decodeFrame(
                QuestSurfaceProtocol.encodeFrame(
                        type, "99", streamId, "uplink", leaseRef, sequence, 1, payload)
                        .trim());
    }

    private static final class RecordingHardware implements QuestSurfaceAudioEngine.Hardware {
        final List<String> events = new ArrayList<>();

        @Override
        public void startHardwareCapture(String epoch, long streamId, String leaseRef) {
            events.add("startCapture:" + epoch + ":" + streamId + ":" + leaseRef);
        }

        @Override
        public void stopHardwareCapture(String epoch, long streamId) {
            events.add("stopCapture:" + epoch + ":" + streamId);
        }

        @Override
        public void startHardwarePlayback(
                String epoch, long streamId, String leaseRef, byte[] pcm) {
            events.add(
                    "startPlayback:" + epoch + ":" + streamId + ":" + leaseRef + ":"
                            + pcm.length);
        }

        @Override
        public void stopHardwarePlayback(String epoch, long streamId, String answerId) {
            events.add("stopPlayback:" + epoch + ":" + streamId + ":" + answerId);
        }
    }
}

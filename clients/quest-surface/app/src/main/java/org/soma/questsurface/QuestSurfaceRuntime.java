package org.soma.questsurface;

import org.json.JSONObject;

import java.io.IOException;
import java.math.BigInteger;

/**
 * Pure-Java v1a/v1b session boundary shared by the TLS transport and host unit tests.
 *
 * This class owns no Android audio device. It binds already-validated wire authority to the
 * inert/fake-hardware audio engine and keeps lifecycle narrowing independent from socket writes.
 */
final class QuestSurfaceRuntime {
    private final QuestSurfaceAudioEngine audioEngine;
    private final QuestSurfaceSequenceTracker receiveSequences =
            new QuestSurfaceSequenceTracker();

    private BigInteger sessionEpoch;
    private QuestSurfaceProtocol.Lease panelLease;
    private QuestSurfaceProtocol.Manifest manifest;
    private QuestSurfaceProtocol.SurfaceSnapshot pendingSnapshot;
    private BigInteger lastRevision = BigInteger.ZERO;
    private String expectedAnswerId = "";
    private String expectedUtteranceId = "";

    QuestSurfaceRuntime(QuestSurfaceAudioEngine audioEngine) {
        this.audioEngine = audioEngine == null ? new QuestSurfaceAudioEngine() : audioEngine;
    }

    synchronized void acceptDownlinkEnvelope(
            QuestSurfaceProtocol.Frame frame, BigInteger expectedEpoch) throws IOException {
        if (!frame.direction.equals("downlink")) {
            throw new IOException("direction_mismatch");
        }
        if (expectedEpoch != null && !frame.sessionEpoch.equals(expectedEpoch)) {
            throw new IOException("session_epoch_mismatch");
        }
        boolean streamZero = frame.type.equals("HELLO_ACK")
                || frame.type.equals("LEASE_MANIFEST")
                || frame.type.equals("LEASE")
                || frame.type.equals("PANEL_SNAPSHOT")
                || frame.type.equals("TEARDOWN_ACK");
        if (streamZero && frame.streamId != 0) {
            throw new IOException("stream_id_unsupported");
        }
        if (frame.type.equals("AUDIO_CHUNK") && frame.streamId == 0) {
            throw new IOException("audio_stream_id_required");
        }
        receiveSequences.accept(
                frame.sessionEpoch, frame.streamId, frame.direction, frame.seq);
    }

    synchronized void configureSession(
            BigInteger epoch,
            QuestSurfaceProtocol.Manifest nextManifest,
            QuestSurfaceProtocol.Lease compatibilityPanelLease,
            long nowElapsedMs) throws QuestSurfaceProtocol.ProtocolException {
        if (!compatibilityPanelLease.sessionEpoch.equals(epoch)) {
            throw new QuestSurfaceProtocol.ProtocolException(
                    "session_epoch_mismatch", "Panel lease epoch does not match the session.");
        }
        if (nowElapsedMs >= compatibilityPanelLease.deadlineElapsedMs) {
            throw new QuestSurfaceProtocol.ProtocolException(
                    "lease_expired", "Panel lease is already expired locally.");
        }
        if (nextManifest != null) {
            if (!nextManifest.sessionEpoch.equals(epoch)
                    || nowElapsedMs >= nextManifest.deadlineElapsedMs) {
                throw new QuestSurfaceProtocol.ProtocolException(
                        "manifest_expired", "Manifest is not live for this session.");
            }
            QuestSurfaceProtocol.Lease manifestPanel = nextManifest.lease("panel");
            if (!sameLeaseAuthority(manifestPanel, compatibilityPanelLease)) {
                throw new QuestSurfaceProtocol.ProtocolException(
                        "manifest_panel_lease_mismatch",
                        "Compatibility panel lease does not match manifest panel authority.");
            }
        }
        sessionEpoch = epoch;
        manifest = nextManifest;
        // In v1b the manifest is the shared lifetime authority. Use its panel leaf after proving
        // the compatibility LEASE is identical so later receipt time cannot extend panel display.
        panelLease = nextManifest == null
                ? compatibilityPanelLease
                : nextManifest.lease("panel");
        pendingSnapshot = null;
        lastRevision = BigInteger.ZERO;
        expectedAnswerId = "";
        expectedUtteranceId = "";
    }

    synchronized QuestSurfaceProtocol.SurfaceSnapshot acceptPanel(
            QuestSurfaceProtocol.Frame frame, long nowElapsedMs)
            throws QuestSurfaceProtocol.ProtocolException {
        requireConfigured();
        QuestSurfaceProtocol.SurfaceSnapshot snapshot = QuestSurfaceProtocol.validateSnapshot(
                frame, panelLease, lastRevision, nowElapsedMs);
        lastRevision = snapshot.revision;
        pendingSnapshot = snapshot;
        expectedAnswerId = snapshot.answerId == null ? "" : snapshot.answerId;
        expectedUtteranceId = snapshot.utteranceId == null ? "" : snapshot.utteranceId;
        return snapshot;
    }

    synchronized QuestSurfaceProtocol.AudioChunk acceptPlayback(
            QuestSurfaceProtocol.Frame frame, long nowElapsedMs)
            throws QuestSurfaceProtocol.ProtocolException, QuestSurfaceAudioEngine.EngineException {
        QuestSurfaceProtocol.Lease lease = requireManifestLease("audio_present", nowElapsedMs);
        QuestSurfaceProtocol.AudioChunk chunk = QuestSurfaceProtocol.validateAudioChunk(
                frame, "downlink", lease, nowElapsedMs);
        if (expectedAnswerId.isEmpty() || expectedUtteranceId.isEmpty()
                || !expectedAnswerId.equals(chunk.answerId)
                || !expectedUtteranceId.equals(chunk.utteranceId)) {
            throw new QuestSurfaceProtocol.ProtocolException(
                    "answer_correlation_mismatch",
                    "Playback does not match the accepted panel answer.");
        }
        audioEngine.startPlayback(
                frame.sessionEpoch.toString(), frame.streamId, lease.leaseId,
                chunk.answerId, chunk.pcm);
        return chunk;
    }

    synchronized JSONObject startCapture(long streamId, String utteranceId, long nowElapsedMs)
            throws QuestSurfaceProtocol.ProtocolException, QuestSurfaceAudioEngine.EngineException {
        requireAudioStream(streamId);
        QuestSurfaceProtocol.Lease lease = requireManifestLease("mic_capture", nowElapsedMs);
        JSONObject payload = QuestSurfaceProtocol.utterancePayload(utteranceId);
        audioEngine.startCapture(
                sessionEpoch.toString(), streamId, utteranceId, lease.leaseId);
        return payload;
    }

    synchronized JSONObject pushCapture(
            long streamId, String utteranceId, byte[] pcm, long nowElapsedMs)
            throws QuestSurfaceProtocol.ProtocolException, QuestSurfaceAudioEngine.EngineException {
        requireAudioStream(streamId);
        requireManifestLease("mic_capture", nowElapsedMs);
        JSONObject payload = QuestSurfaceProtocol.audioChunkPayload(
                utteranceId, "", pcm, 1);
        audioEngine.pushChunk(sessionEpoch.toString(), streamId, utteranceId, pcm);
        return payload;
    }

    synchronized JSONObject endCapture(long streamId, String utteranceId, long nowElapsedMs)
            throws QuestSurfaceProtocol.ProtocolException, QuestSurfaceAudioEngine.EngineException {
        requireAudioStream(streamId);
        requireManifestLease("mic_capture", nowElapsedMs);
        JSONObject payload = QuestSurfaceProtocol.utterancePayload(utteranceId);
        audioEngine.endCapture(sessionEpoch.toString(), streamId, utteranceId);
        return payload;
    }

    synchronized JSONObject cancelCapture(
            long streamId, String utteranceId, String reason, long nowElapsedMs)
            throws QuestSurfaceProtocol.ProtocolException {
        requireAudioStream(streamId);
        requireManifestLease("mic_capture", nowElapsedMs);
        JSONObject payload = QuestSurfaceProtocol.cancelPayload(utteranceId, reason);
        audioEngine.cancel(sessionEpoch.toString(), streamId, utteranceId);
        return payload;
    }

    synchronized void rejectCaptureStream(long streamId) {
        if (sessionEpoch != null) {
            audioEngine.stopCaptureStream(sessionEpoch.toString(), streamId);
        }
    }

    synchronized void rejectPlaybackStream(long streamId) {
        if (sessionEpoch != null) {
            audioEngine.stopPlaybackStream(sessionEpoch.toString(), streamId);
        }
    }

    synchronized void latch(String reason) {
        String epoch = sessionEpoch == null ? "" : sessionEpoch.toString();
        audioEngine.latch(reason, epoch);
        clearSessionState();
    }

    synchronized boolean deliberateResume(String freshEpoch, boolean explicitIntent) {
        return audioEngine.deliberateResume(freshEpoch, explicitIntent);
    }

    synchronized boolean isLatched() {
        return audioEngine.isLatched();
    }

    synchronized boolean hasManifest() {
        return manifest != null;
    }

    synchronized QuestSurfaceProtocol.Lease panelLease() {
        return panelLease;
    }

    synchronized QuestSurfaceProtocol.Lease micLease() {
        return manifest == null ? null : manifest.lease("mic_capture");
    }

    synchronized QuestSurfaceProtocol.SurfaceSnapshot pendingSnapshot() {
        return pendingSnapshot;
    }

    synchronized void clearPendingSnapshot() {
        pendingSnapshot = null;
    }

    synchronized long deadlineElapsedMs() {
        if (manifest != null) {
            return Math.min(manifest.deadlineElapsedMs, panelLease.deadlineElapsedMs);
        }
        return panelLease == null ? 0 : panelLease.deadlineElapsedMs;
    }

    synchronized String sessionEpoch() {
        return sessionEpoch == null ? "" : sessionEpoch.toString();
    }

    private QuestSurfaceProtocol.Lease requireManifestLease(String name, long nowElapsedMs)
            throws QuestSurfaceProtocol.ProtocolException {
        requireConfigured();
        if (manifest == null) {
            throw new QuestSurfaceProtocol.ProtocolException(
                    "manifest_required", "Audio requires a v1b lease manifest.");
        }
        if (nowElapsedMs >= manifest.deadlineElapsedMs) {
            latch("lease_expired");
            throw new QuestSurfaceProtocol.ProtocolException(
                    "lease_expired", "Audio manifest expired locally.");
        }
        QuestSurfaceProtocol.Lease lease = manifest.lease(name);
        if (lease == null || nowElapsedMs >= lease.deadlineElapsedMs) {
            latch("lease_expired");
            throw new QuestSurfaceProtocol.ProtocolException(
                    "lease_expired", "Audio lease expired locally.");
        }
        return lease;
    }

    private void requireConfigured() throws QuestSurfaceProtocol.ProtocolException {
        if (sessionEpoch == null || panelLease == null) {
            throw new QuestSurfaceProtocol.ProtocolException(
                    "session_not_ready", "Quest session has no active lease.");
        }
    }

    private static void requireAudioStream(long streamId)
            throws QuestSurfaceProtocol.ProtocolException {
        if (streamId <= 0 || streamId > 0xffff_ffffL) {
            throw new QuestSurfaceProtocol.ProtocolException(
                    "audio_stream_id_required", "Audio requires a nonzero u32 stream id.");
        }
    }

    private void clearSessionState() {
        sessionEpoch = null;
        panelLease = null;
        manifest = null;
        pendingSnapshot = null;
        lastRevision = BigInteger.ZERO;
        expectedAnswerId = "";
        expectedUtteranceId = "";
        receiveSequences.clear();
    }

    private static boolean sameLeaseAuthority(
            QuestSurfaceProtocol.Lease first, QuestSurfaceProtocol.Lease second) {
        return first != null
                && first.leaseId.equals(second.leaseId)
                && first.sourceGrantId.equals(second.sourceGrantId)
                && first.capability.equals(second.capability)
                && first.provider.equals(second.provider)
                && first.scope.equals(second.scope)
                && first.sessionEpoch.equals(second.sessionEpoch)
                && first.issuedAtMs == second.issuedAtMs
                && first.ttlMs == second.ttlMs
                && first.expiresAtMs == second.expiresAtMs
                && first.maxPanelTextBytes == second.maxPanelTextBytes
                && first.allowedSurfaceIds.equals(second.allowedSurfaceIds);
    }

}

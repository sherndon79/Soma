package org.soma.questsurface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;

final class QuestSurfaceV1bTestData {
    static final String RESUME_HANDLE = "resume-test-handle";

    private QuestSurfaceV1bTestData() {}

    static JSONObject manifestPayload(String epoch, long issuedAtMs, long ttlMs) throws Exception {
        JSONObject leases = new JSONObject()
                .put("panel", leaf(
                        "lease-panel", "grant-panel", QuestSurfaceProtocol.CAPABILITY,
                        QuestSurfaceProtocol.PROVIDER, "session", epoch, issuedAtMs, ttlMs,
                        new JSONObject()
                                .put("max_panel_text_bytes", 512)
                                .put("allowed_surface_ids", new JSONArray().put("panel.main"))
                                .put("device_fingerprint256", "")))
                .put("mic_capture", leaf(
                        "lease-mic", "grant-mic", QuestSurfaceProtocol.MIC_CAPTURE_CAPABILITY,
                        QuestSurfaceProtocol.PROVIDER, "session", epoch, issuedAtMs, ttlMs,
                        new JSONObject().put("device_fingerprint256", "")))
                .put("audio_present", leaf(
                        "lease-audio", "grant-audio", QuestSurfaceProtocol.AUDIO_PRESENT_CAPABILITY,
                        QuestSurfaceProtocol.PROVIDER, "session", epoch, issuedAtMs, ttlMs,
                        new JSONObject().put("device_fingerprint256", "")))
                .put("local_attach", leaf(
                        "lease-local", "grant-local", QuestSurfaceProtocol.LOCAL_ATTACH_CAPABILITY,
                        QuestSurfaceProtocol.LOCAL_MODEL_PROVIDER, "once", epoch, issuedAtMs, ttlMs,
                        new JSONObject().put("device_fingerprint256", "")));
        return new JSONObject()
                .put("schema_version", 1)
                .put("session_epoch", epoch)
                .put("resume_handle", RESUME_HANDLE)
                .put("issued_at_ms", issuedAtMs)
                .put("ttl_ms", ttlMs)
                .put("expires_at_ms", issuedAtMs + ttlMs)
                .put("leases", leases);
    }

    static QuestSurfaceProtocol.Manifest manifest(
            String epoch, long nowElapsedMs, long ttlMs) throws Exception {
        return QuestSurfaceProtocol.validateManifest(
                serverFrame(
                        "LEASE_MANIFEST", epoch, 0, "", 2,
                        manifestPayload(epoch, 10_000, ttlMs)),
                new java.math.BigInteger(epoch),
                nowElapsedMs);
    }

    static JSONObject renewalPayload(
            String epoch, long generation, long issuedAtMs, long ttlMs) throws Exception {
        return new JSONObject()
                .put("schema_version", 1)
                .put("session_epoch", epoch)
                .put("generation", generation)
                .put("issued_at_ms", issuedAtMs)
                .put("ttl_ms", ttlMs)
                .put("expires_at_ms", issuedAtMs + ttlMs)
                .put("lease_ids", new JSONObject()
                        .put("panel", "lease-panel")
                        .put("mic_capture", "lease-mic")
                        .put("audio_present", "lease-audio")
                        .put("local_attach", "lease-local"));
    }

    static QuestSurfaceProtocol.Lease compatibilityPanelLease(
            String epoch, long nowElapsedMs, long ttlMs) throws Exception {
        JSONObject payload = manifestPayload(epoch, 10_000, ttlMs)
                .getJSONObject("leases")
                .getJSONObject("panel");
        return QuestSurfaceProtocol.validateLease(
                serverFrame("LEASE", epoch, 0, "", 3, payload),
                new java.math.BigInteger(epoch),
                nowElapsedMs);
    }

    static QuestSurfaceProtocol.Frame panelFrame(
            String epoch,
            String leaseId,
            long sequence,
            String revision,
            String answerId,
            String utteranceId) throws Exception {
        String text = "ANSWER " + revision;
        byte[] textBytes = text.getBytes(StandardCharsets.UTF_8);
        JSONObject resource = new JSONObject()
                .put("media_type", "text/plain;charset=utf-8")
                .put("encoding", "utf-8")
                .put("byte_length", textBytes.length)
                .put("sha256", sha256(textBytes))
                .put("text", text);
        JSONObject surface = new JSONObject()
                .put("id", "panel.main")
                .put("kind", "panel")
                .put("space", "view")
                .put("pose", new JSONObject()
                        .put("position", new JSONObject().put("x", 0).put("y", 0).put("z", -1.5))
                        .put("orientation", new JSONObject()
                                .put("x", 0).put("y", 0).put("z", 0).put("w", 1)))
                .put("bounds", new JSONObject().put("width_m", 0.9).put("height_m", 0.5))
                .put("resource", resource);
        JSONObject document = new JSONObject()
                .put("schema_version", answerId == null ? 1 : 2)
                .put("revision", revision)
                .put("ttl_ms", 1_000)
                .put("lease_ref", leaseId)
                .put("surface", surface);
        if (answerId != null) {
            document.put("answer_id", answerId).put("utterance_id", utteranceId);
        }
        byte[] documentBytes = document.toString().getBytes(StandardCharsets.UTF_8);
        JSONObject payload = new JSONObject()
                .put("document_encoding", "base64-json-utf8")
                .put("document_byte_length", documentBytes.length)
                .put("document_sha256", sha256(documentBytes))
                .put("document_b64", Base64.getEncoder().encodeToString(documentBytes));
        return serverFrame("PANEL_SNAPSHOT", epoch, 0, leaseId, sequence, payload);
    }

    static QuestSurfaceProtocol.Frame playbackFrame(
            String epoch,
            long streamId,
            String leaseId,
            long sequence,
            String answerId,
            String utteranceId,
            byte[] pcm) throws Exception {
        return serverFrame(
                "AUDIO_CHUNK", epoch, streamId, leaseId, sequence,
                QuestSurfaceProtocol.audioChunkPayload(utteranceId, answerId, pcm, 2));
    }

    static QuestSurfaceProtocol.Frame answerEndFrame(
            String epoch,
            long streamId,
            String leaseId,
            long sequence,
            String answerId,
            String utteranceId) throws Exception {
        JSONObject payload = new JSONObject().put("utterance_id", utteranceId).put("answer_id", answerId);
        return serverFrame("ANSWER_END", epoch, streamId, leaseId, sequence, payload);
    }

    static QuestSurfaceProtocol.Frame serverFrame(
            String type,
            String epoch,
            long streamId,
            String leaseRef,
            long sequence,
            JSONObject payload) throws Exception {
        return QuestSurfaceProtocol.decodeFrame(
                QuestSurfaceProtocol.encodeFrame(
                        type, epoch, streamId, "downlink", leaseRef, sequence, 1, payload)
                        .trim());
    }

    static byte[] mono20() {
        byte[] pcm = new byte[1_920];
        pcm[0] = 1;
        return pcm;
    }

    static byte[] mono40() {
        byte[] pcm = new byte[3_840];
        pcm[0] = 1;
        return pcm;
    }

    static byte[] stereo20() {
        byte[] pcm = new byte[3_840];
        pcm[0] = 1;
        return pcm;
    }

    static byte[] stereo40() {
        byte[] pcm = new byte[7_680];
        pcm[0] = 1;
        return pcm;
    }

    static JSONObject deepCopy(JSONObject object) throws Exception {
        return new JSONObject(object.toString());
    }

    private static JSONObject leaf(
            String leaseId,
            String grantId,
            String capability,
            String provider,
            String scope,
            String epoch,
            long issuedAtMs,
            long ttlMs,
            JSONObject constraints) throws Exception {
        return new JSONObject()
                .put("lease_id", leaseId)
                .put("source_grant_id", grantId)
                .put("capability", capability)
                .put("provider", provider)
                .put("scope", scope)
                .put("session_epoch", epoch)
                .put("issued_at_ms", issuedAtMs)
                .put("ttl_ms", ttlMs)
                .put("expires_at_ms", issuedAtMs + ttlMs)
                .put("constraints", constraints);
    }

    private static String sha256(byte[] bytes) throws Exception {
        StringBuilder hex = new StringBuilder();
        for (byte value : MessageDigest.getInstance("SHA-256").digest(bytes)) {
            hex.append(String.format("%02x", value & 0xff));
        }
        return hex.toString();
    }
}

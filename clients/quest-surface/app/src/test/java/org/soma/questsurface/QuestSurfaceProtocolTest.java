package org.soma.questsurface;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HashSet;
import java.util.Set;

public final class QuestSurfaceProtocolTest {
    @Test
    public void helloIsUnleasedButCapabilityAcknowledgementIsNot() throws Exception {
        JSONObject hello = new JSONObject()
                .put("supported_versions", new JSONArray().put(1))
                .put("client", "test");
        String encoded = QuestSurfaceProtocol.encodeFrame(
                "HELLO", "0", "uplink", "", 1, 1, hello);
        QuestSurfaceProtocol.Frame frame = QuestSurfaceProtocol.decodeFrame(encoded.trim());
        assertEquals("HELLO", frame.type);
        assertEquals(BigInteger.ZERO, frame.sessionEpoch);
        assertEquals(0, frame.streamId);

        QuestSurfaceProtocol.ProtocolException error = assertThrows(
                QuestSurfaceProtocol.ProtocolException.class,
                () -> QuestSurfaceProtocol.encodeFrame(
                        "ACTUAL_BOUNDS_ACK", "1", "uplink", "", 1, 1, new JSONObject()));
        assertEquals("lease_ref_required", error.code);
    }

    @Test
    public void resumeHelloIsExactExplicitAndBoundToOpaqueHandle() throws Exception {
        JSONObject initial = QuestSurfaceProtocol.helloPayload(null);
        assertEquals(Set.of("supported_versions", "client"), keys(initial));

        JSONObject resume = QuestSurfaceProtocol.helloPayload("resume-episode-99");
        assertEquals(Set.of("supported_versions", "client", "resume_intent"), keys(resume));
        JSONObject intent = resume.getJSONObject("resume_intent");
        assertEquals(
                Set.of("schema_version", "resume_handle", "explicit_local_action"),
                keys(intent));
        assertEquals(1, intent.getInt("schema_version"));
        assertEquals("resume-episode-99", intent.getString("resume_handle"));
        assertEquals(true, intent.getBoolean("explicit_local_action"));

        QuestSurfaceProtocol.ProtocolException tooLong = assertThrows(
                QuestSurfaceProtocol.ProtocolException.class,
                () -> QuestSurfaceProtocol.helloPayload("x".repeat(257)));
        assertEquals("resume_handle_invalid", tooLong.code);
    }

    @Test
    public void validatesExactLeaseSnapshotAndDeterministicallyClampsGeometry() throws Exception {
        long now = 2_000;
        String epoch = "99";
        String leaseId = "lease-test";

        JSONObject helloPayload = new JSONObject()
                .put("selected_version", 1)
                .put("provider", QuestSurfaceProtocol.PROVIDER)
                .put("supported_render_extensions", new JSONArray());
        QuestSurfaceProtocol.Frame hello = decodeServer(
                "HELLO_ACK", epoch, "", 1, helloPayload);
        QuestSurfaceProtocol.validateHelloAck(hello);

        JSONObject constraints = new JSONObject()
                .put("max_panel_text_bytes", 512)
                .put("allowed_surface_ids", new JSONArray().put("panel.main"))
                .put("device_fingerprint256", "");
        JSONObject leasePayload = new JSONObject()
                .put("lease_id", leaseId)
                .put("source_grant_id", "grant-test")
                .put("capability", QuestSurfaceProtocol.CAPABILITY)
                .put("provider", QuestSurfaceProtocol.PROVIDER)
                .put("scope", "session")
                .put("session_epoch", epoch)
                .put("issued_at_ms", 10_000)
                .put("ttl_ms", 5_000)
                .put("expires_at_ms", 15_000)
                .put("constraints", constraints);
        QuestSurfaceProtocol.Lease lease = QuestSurfaceProtocol.validateLease(
                decodeServer("LEASE", epoch, "", 2, leasePayload),
                new BigInteger(epoch),
                now);

        String text = "HELLO SOMA";
        byte[] textBytes = text.getBytes(StandardCharsets.UTF_8);
        JSONObject resource = new JSONObject()
                .put("media_type", "text/plain;charset=utf-8")
                .put("encoding", "utf-8")
                .put("byte_length", textBytes.length)
                .put("sha256", sha256(textBytes))
                .put("text", text);
        JSONObject pose = new JSONObject()
                .put("position", new JSONObject().put("x", 4).put("y", -4).put("z", -9))
                .put("orientation", new JSONObject().put("x", 0).put("y", 0).put("z", 0).put("w", 1));
        JSONObject surface = new JSONObject()
                .put("id", "panel.main")
                .put("kind", "panel")
                .put("space", "view")
                .put("pose", pose)
                .put("bounds", new JSONObject().put("width_m", 9).put("height_m", 0.1))
                .put("resource", resource);
        JSONObject document = new JSONObject()
                .put("schema_version", 1)
                .put("revision", "1")
                .put("ttl_ms", 1_000)
                .put("lease_ref", leaseId)
                .put("surface", surface);
        byte[] documentBytes = document.toString().getBytes(StandardCharsets.UTF_8);
        JSONObject snapshotPayload = new JSONObject()
                .put("document_encoding", "base64-json-utf8")
                .put("document_byte_length", documentBytes.length)
                .put("document_sha256", sha256(documentBytes))
                .put("document_b64", Base64.getEncoder().encodeToString(documentBytes));
        QuestSurfaceProtocol.SurfaceSnapshot snapshot = QuestSurfaceProtocol.validateSnapshot(
                decodeServer("PANEL_SNAPSHOT", epoch, leaseId, 3, snapshotPayload),
                lease,
                BigInteger.ZERO,
                now);

        assertEquals(1.0f, snapshot.pose.x, 0.0001f);
        assertEquals(-1.0f, snapshot.pose.y, 0.0001f);
        assertEquals(-3.0f, snapshot.pose.z, 0.0001f);
        assertEquals(2.0f, snapshot.bounds.width, 0.0001f);
        assertEquals(0.20f, snapshot.bounds.height, 0.0001f);
        assertEquals(text, snapshot.text);
    }

    @Test
    public void rejectsMalformedEnvelope() {
        QuestSurfaceProtocol.ProtocolException error = assertThrows(
                QuestSurfaceProtocol.ProtocolException.class,
                () -> QuestSurfaceProtocol.decodeFrame("{}"));
        assertEquals("frame_fields_invalid", error.code);

        QuestSurfaceProtocol.ProtocolException utf8 = assertThrows(
                QuestSurfaceProtocol.ProtocolException.class,
                () -> QuestSurfaceProtocol.decodeUtf8(
                        new byte[] {(byte) 0xc3, 0x28}, "frame_not_utf8"));
        assertEquals("frame_not_utf8", utf8.code);
    }

    @Test
    public void rejectsWrongEpochStaleRevisionMismatchedHashAndOversizedResource() throws Exception {
        QuestSurfaceProtocol.Lease lease = testLease("99", "lease-test", 2_000, 512);

        QuestSurfaceProtocol.ProtocolException wrongEpoch = assertThrows(
                QuestSurfaceProtocol.ProtocolException.class,
                () -> QuestSurfaceProtocol.validateSnapshot(
                        testSnapshot("100", lease.leaseId, "2", "SOMA", null, 3),
                        lease,
                        BigInteger.ZERO,
                        2_000));
        assertEquals("session_epoch_mismatch", wrongEpoch.code);

        QuestSurfaceProtocol.ProtocolException staleRevision = assertThrows(
                QuestSurfaceProtocol.ProtocolException.class,
                () -> QuestSurfaceProtocol.validateSnapshot(
                        testSnapshot("99", lease.leaseId, "2", "SOMA", null, 3),
                        lease,
                        new BigInteger("2"),
                        2_000));
        assertEquals("document_revision_stale", staleRevision.code);

        QuestSurfaceProtocol.ProtocolException mismatchedHash = assertThrows(
                QuestSurfaceProtocol.ProtocolException.class,
                () -> QuestSurfaceProtocol.validateSnapshot(
                        testSnapshot("99", lease.leaseId, "2", "SOMA", "0".repeat(64), 3),
                        lease,
                        BigInteger.ZERO,
                        2_000));
        assertEquals("resource_hash_mismatch", mismatchedHash.code);

        QuestSurfaceProtocol.ProtocolException oversized = assertThrows(
                QuestSurfaceProtocol.ProtocolException.class,
                () -> QuestSurfaceProtocol.validateSnapshot(
                        testSnapshot("99", lease.leaseId, "2", "x".repeat(513), null, 3),
                        lease,
                        BigInteger.ZERO,
                        2_000));
        assertEquals("resource_length_invalid", oversized.code);
    }

    private static QuestSurfaceProtocol.Frame decodeServer(
            String type,
            String epoch,
            String leaseRef,
            long seq,
            JSONObject payload) throws Exception {
        return QuestSurfaceProtocol.decodeFrame(QuestSurfaceProtocol.encodeFrame(
                type, epoch, "downlink", leaseRef, seq, 1, payload).trim());
    }

    private static QuestSurfaceProtocol.Lease testLease(
            String epoch,
            String leaseId,
            long now,
            int maxTextBytes) throws Exception {
        return testLeaseWithTtl(epoch, leaseId, now, maxTextBytes, 5_000);
    }

    private static QuestSurfaceProtocol.Lease testLeaseWithTtl(
            String epoch,
            String leaseId,
            long now,
            int maxTextBytes,
            int ttlMs) throws Exception {
        JSONObject constraints = new JSONObject()
                .put("max_panel_text_bytes", maxTextBytes)
                .put("allowed_surface_ids", new JSONArray().put("panel.main"))
                .put("device_fingerprint256", "");
        JSONObject payload = new JSONObject()
                .put("lease_id", leaseId)
                .put("source_grant_id", "grant-test")
                .put("capability", QuestSurfaceProtocol.CAPABILITY)
                .put("provider", QuestSurfaceProtocol.PROVIDER)
                .put("scope", "session")
                .put("session_epoch", epoch)
                .put("issued_at_ms", 10_000)
                .put("ttl_ms", ttlMs)
                .put("expires_at_ms", 10_000 + ttlMs)
                .put("constraints", constraints);
        return QuestSurfaceProtocol.validateLease(
                decodeServer("LEASE", epoch, "", 2, payload), new BigInteger(epoch), now);
    }

    private static QuestSurfaceProtocol.Frame testSnapshot(
            String epoch,
            String leaseId,
            String revision,
            String text,
            String resourceHash,
            long seq) throws Exception {
        byte[] textBytes = text.getBytes(StandardCharsets.UTF_8);
        JSONObject resource = new JSONObject()
                .put("media_type", "text/plain;charset=utf-8")
                .put("encoding", "utf-8")
                .put("byte_length", textBytes.length)
                .put("sha256", resourceHash == null ? sha256(textBytes) : resourceHash)
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
                .put("schema_version", 1)
                .put("revision", revision)
                .put("ttl_ms", 1_000)
                .put("lease_ref", leaseId)
                .put("surface", surface);
        byte[] documentBytes = document.toString().getBytes(StandardCharsets.UTF_8);
        JSONObject payload = new JSONObject()
                .put("document_encoding", "base64-json-utf8")
                .put("document_byte_length", documentBytes.length)
                .put("document_sha256", sha256(documentBytes))
                .put("document_b64", Base64.getEncoder().encodeToString(documentBytes));
        return decodeServer("PANEL_SNAPSHOT", epoch, leaseId, seq, payload);
    }

    @Test
    public void validatesNodeProducedHashedV2SnapshotRetainsCorrelation() throws Exception {
        // durable Node-produced fixture outside build output
        java.io.InputStream in = getClass().getClassLoader().getResourceAsStream("questSurfaceV2Fixture.json");
        if (in == null) throw new AssertionError("questSurfaceV2Fixture.json not found on test classpath");
        String json = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        JSONObject fixture = new JSONObject(json);
        JSONObject input = fixture.getJSONObject("input");
        JSONObject payload = fixture.getJSONObject("payload");
        JSONObject expected = fixture.getJSONObject("expected");
        String leaseId = expected.getString("lease_ref");
        String epoch = "42";
        QuestSurfaceProtocol.Lease lease = testLeaseWithTtl(
                epoch, leaseId, 2_000, 512, input.getInt("ttl_ms"));
        // validateSnapshot must retain answer_id / utterance_id and accept the Node hash
        JSONObject snapshotPayload = new JSONObject()
                .put("document_encoding", payload.getString("document_encoding"))
                .put("document_byte_length", payload.getInt("document_byte_length"))
                .put("document_sha256", payload.getString("document_sha256"))
                .put("document_b64", payload.getString("document_b64"));
        // reconstruct frame payload via decodeServer helper
        QuestSurfaceProtocol.Frame snapshotFrame = decodeServer("PANEL_SNAPSHOT", epoch, leaseId, 3, snapshotPayload);
        QuestSurfaceProtocol.SurfaceSnapshot snapshot = QuestSurfaceProtocol.validateSnapshot(snapshotFrame, lease, BigInteger.ZERO, 2_000);
        assertEquals(expected.getString("answer_id"), snapshot.answerId);
        assertEquals(expected.getString("utterance_id"), snapshot.utteranceId);
        assertEquals(new BigInteger(expected.getString("revision")), snapshot.revision);
        // strict: padded IDs must be rejected (re-hashed)
        JSONObject document = new JSONObject(new String(Base64.getDecoder().decode(payload.getString("document_b64")), StandardCharsets.UTF_8));
        document.put("answer_id", " a ");
        document.put("utterance_id", " u ");
        byte[] paddedBytes = document.toString().getBytes(StandardCharsets.UTF_8);
        JSONObject paddedPayloadStrict = new JSONObject()
                .put("document_encoding", "base64-json-utf8")
                .put("document_byte_length", paddedBytes.length)
                .put("document_sha256", sha256(paddedBytes))
                .put("document_b64", Base64.getEncoder().encodeToString(paddedBytes));
        QuestSurfaceProtocol.ProtocolException padded = assertThrows(
                QuestSurfaceProtocol.ProtocolException.class,
                () -> QuestSurfaceProtocol.validateSnapshot(decodeServer("PANEL_SNAPSHOT", epoch, leaseId, 4, paddedPayloadStrict), lease, BigInteger.ZERO, 2_000));
        if (!padded.code.equals("answer_id_invalid") && !padded.code.equals("utterance_id_invalid")) {
            throw new AssertionError("expected padded to be answer_id_invalid or utterance_id_invalid, got " + padded.code);
        }
    }

    private static String sha256(byte[] bytes) throws Exception {
        StringBuilder hex = new StringBuilder();
        for (byte value : MessageDigest.getInstance("SHA-256").digest(bytes)) {
            hex.append(String.format("%02x", value & 0xff));
        }
        return hex.toString();
    }

    private static Set<String> keys(JSONObject object) {
        Set<String> result = new HashSet<>();
        object.keys().forEachRemaining(result::add);
        return result;
    }
}

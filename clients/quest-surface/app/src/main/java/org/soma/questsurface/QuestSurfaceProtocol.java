package org.soma.questsurface;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

final class QuestSurfaceProtocol {
    static final int VERSION = 1;
    static final int MAX_FRAME_BYTES = 64 * 1024;
    static final int MAX_PAYLOAD_BYTES = 48 * 1024;
    static final int MAX_DOCUMENT_BYTES = 8 * 1024;
    static final int MAX_PANEL_TEXT_BYTES = 2 * 1024;
    static final long MAX_LEASE_TTL_MS = 5 * 60 * 1000L;
    static final String CAPABILITY = "interaction.quest.surface.panel.present";
    static final String MIC_CAPTURE_CAPABILITY =
            "interaction.quest.surface.microphone.capture";
    static final String AUDIO_PRESENT_CAPABILITY =
            "interaction.quest.surface.audio.wearer_directed.present";
    static final String LOCAL_ATTACH_CAPABILITY =
            "model.context.audio.microphone.local.attach";
    static final String PROVIDER = "soma.provider.quest-surface-fixture";
    static final String LOCAL_MODEL_PROVIDER = "soma.provider.local-model";
    static final int AUDIO_SAMPLE_RATE = 48_000;
    static final int AUDIO_FRAMES_20_MS = 960;
    static final int AUDIO_FRAMES_40_MS = 1_920;
    static final int MAX_AUDIO_BYTES = 7_680;
    private static final long MAX_SAFE_JSON_INTEGER = 9_007_199_254_740_991L;

    private static final BigInteger U64_MAX = new BigInteger("18446744073709551615");
    private static final BigInteger I64_MIN = new BigInteger("-9223372036854775808");
    private static final BigInteger I64_MAX = new BigInteger("9223372036854775807");
    private static final Pattern U64 = Pattern.compile("^(0|[1-9][0-9]{0,19})$");
    private static final Pattern I64 = Pattern.compile("^-?(0|[1-9][0-9]{0,18})$");
    private static final Pattern SHA256 = Pattern.compile("^[a-f0-9]{64}$");
    private static final Set<String> FRAME_FIELDS = Set.of(
            "version", "type", "session_epoch", "stream_id", "direction", "lease_ref",
            "seq", "send_ts_ns", "payload_len", "payload_b64");
    private static final Set<String> UNLEASED_TYPES = Set.of(
            "HELLO", "HELLO_ACK", "LEASE", "LEASE_MANIFEST", "FOCUS_LOST", "SUSPEND",
            "TEARDOWN_ACK", "ERROR");

    private QuestSurfaceProtocol() {}

    static Frame decodeFrame(String line) throws ProtocolException {
        if (line == null || utf8(line).length == 0 || utf8(line).length > MAX_FRAME_BYTES) {
            throw failure("frame_size_invalid", "Frame is empty or exceeds the v1a limit.");
        }
        final JSONObject object;
        try {
            object = new JSONObject(line);
        } catch (JSONException error) {
            throw failure("frame_json_invalid", "Frame is not valid JSON.");
        }
        exactFields(object, FRAME_FIELDS, "frame_fields_invalid");
        if (integer(object, "version", 0, 65535, "version_invalid") != VERSION) {
            throw failure("version_unsupported", "Protocol version is unsupported.");
        }
        String type = token(string(object, "type", "type_invalid"), "type_invalid");
        BigInteger epoch = unsigned(string(object, "session_epoch", "session_epoch_invalid"),
                "session_epoch_invalid");
        long streamId = integer(object, "stream_id", 0, 0xffff_ffffL, "stream_id_invalid");
        String direction = string(object, "direction", "direction_invalid");
        if (!direction.equals("uplink") && !direction.equals("downlink")) {
            throw failure("direction_invalid", "Frame direction is invalid.");
        }
        String leaseRef = string(object, "lease_ref", "lease_ref_invalid");
        BigInteger seq = unsigned(string(object, "seq", "sequence_invalid"), "sequence_invalid");
        signed(string(object, "send_ts_ns", "send_timestamp_invalid"), "send_timestamp_invalid");
        int payloadLength = (int) integer(
                object, "payload_len", 0, MAX_PAYLOAD_BYTES, "payload_length_invalid");
        String payloadBase64 = string(object, "payload_b64", "payload_encoding_invalid");
        byte[] payloadBytes = decodeCanonicalBase64(payloadBase64, "payload_encoding_invalid");
        if (payloadBytes.length != payloadLength) {
            throw failure("payload_length_mismatch", "Payload length does not match its envelope.");
        }
        final JSONObject payload;
        try {
            payload = payloadBytes.length == 0
                    ? new JSONObject()
                    : new JSONObject(decodeUtf8(payloadBytes, "payload_not_utf8"));
        } catch (JSONException error) {
            throw failure("payload_json_invalid", "Payload is not valid UTF-8 JSON.");
        }
        validateLeaseBinding(type, leaseRef);
        return new Frame(type, epoch, streamId, direction, leaseRef, seq, payload);
    }

    static String encodeFrame(
            String type,
            String sessionEpoch,
            String direction,
            String leaseRef,
            long seq,
            long sendTsNs,
            JSONObject payload) throws ProtocolException {
        return encodeFrame(
                type, sessionEpoch, 0, direction, leaseRef, seq, sendTsNs, payload);
    }

    static String encodeFrame(
            String type,
            String sessionEpoch,
            long streamId,
            String direction,
            String leaseRef,
            long seq,
            long sendTsNs,
            JSONObject payload) throws ProtocolException {
        token(type, "type_invalid");
        unsigned(sessionEpoch, "session_epoch_invalid");
        if (streamId < 0 || streamId > 0xffff_ffffL) {
            throw failure("stream_id_invalid", "Stream id is outside u32.");
        }
        if (!direction.equals("uplink") && !direction.equals("downlink")) {
            throw failure("direction_invalid", "Frame direction is invalid.");
        }
        validateLeaseBinding(type, leaseRef);
        byte[] payloadBytes = utf8(payload == null ? "{}" : payload.toString());
        if (payloadBytes.length > MAX_PAYLOAD_BYTES) {
            throw failure("payload_too_large", "Payload exceeds the v1a limit.");
        }
        JSONObject frame = new JSONObject();
        try {
            frame.put("version", VERSION);
            frame.put("type", type);
            frame.put("session_epoch", sessionEpoch);
            frame.put("stream_id", streamId);
            frame.put("direction", direction);
            frame.put("lease_ref", leaseRef == null ? "" : leaseRef);
            frame.put("seq", Long.toUnsignedString(seq));
            frame.put("send_ts_ns", Long.toString(sendTsNs));
            frame.put("payload_len", payloadBytes.length);
            frame.put("payload_b64", Base64.getEncoder().encodeToString(payloadBytes));
        } catch (JSONException error) {
            throw failure("frame_encode_failed", "Could not encode frame.");
        }
        String line = frame + "\n";
        if (utf8(line).length > MAX_FRAME_BYTES) {
            throw failure("frame_too_large", "Frame exceeds the v1a limit.");
        }
        return line;
    }

    static void validateHelloAck(Frame frame) throws ProtocolException {
        requireType(frame, "HELLO_ACK");
        exactFields(frame.payload, Set.of(
                "selected_version", "provider", "supported_render_extensions"),
                "hello_ack_fields_invalid");
        if (integer(frame.payload, "selected_version", 1, VERSION, "version_unsupported") != VERSION) {
            throw failure("version_unsupported", "Server selected an unsupported protocol version.");
        }
        if (!string(frame.payload, "provider", "provider_invalid").equals(PROVIDER)) {
            throw failure("provider_mismatch", "Server provider does not match the v1a contract.");
        }
        if (array(frame.payload, "supported_render_extensions", "render_extensions_invalid")
                .length() != 0) {
            throw failure(
                    "render_extension_unsupported",
                    "v1a does not negotiate render extensions.");
        }
        if (frame.sessionEpoch.signum() == 0) {
            throw failure("session_epoch_invalid", "Server must select a nonzero fresh epoch.");
        }
    }

    static Lease validateLease(Frame frame, BigInteger expectedEpoch, long nowElapsedMs)
            throws ProtocolException {
        requireType(frame, "LEASE");
        if (!frame.sessionEpoch.equals(expectedEpoch)) {
            throw failure("session_epoch_mismatch", "Lease epoch does not match HELLO_ACK.");
        }
        exactFields(frame.payload, Set.of(
                "lease_id", "source_grant_id", "capability", "provider", "scope",
                "session_epoch", "issued_at_ms", "ttl_ms", "expires_at_ms", "constraints"),
                "lease_fields_invalid");
        String leaseId = token(string(frame.payload, "lease_id", "lease_id_invalid"),
                "lease_id_invalid");
        String sourceGrantId = token(string(frame.payload, "source_grant_id", "grant_id_invalid"),
                "grant_id_invalid");
        if (!string(frame.payload, "capability", "capability_invalid").equals(CAPABILITY)
                || !string(frame.payload, "provider", "provider_invalid").equals(PROVIDER)
                || !string(frame.payload, "scope", "scope_invalid").equals("session")) {
            throw failure("lease_authority_mismatch", "Lease does not match the exact v1a authority.");
        }
        BigInteger payloadEpoch = unsigned(
                string(frame.payload, "session_epoch", "session_epoch_invalid"),
                "session_epoch_invalid");
        if (!payloadEpoch.equals(expectedEpoch)) {
            throw failure("session_epoch_mismatch", "Lease payload epoch does not match its envelope.");
        }
        long issuedAt = integer(
                frame.payload, "issued_at_ms", 0, MAX_SAFE_JSON_INTEGER,
                "lease_issued_at_invalid");
        long ttl = integer(frame.payload, "ttl_ms", 1, MAX_LEASE_TTL_MS, "lease_ttl_invalid");
        long expiresAt = integer(
                frame.payload, "expires_at_ms", 0, MAX_SAFE_JSON_INTEGER,
                "lease_expiry_invalid");
        if (issuedAt > Long.MAX_VALUE - ttl || issuedAt + ttl != expiresAt) {
            throw failure("lease_expiry_invalid", "Lease expiry does not match issued time and TTL.");
        }
        JSONObject constraints = object(frame.payload, "constraints", "lease_constraints_invalid");
        exactFields(constraints, Set.of(
                "max_panel_text_bytes", "allowed_surface_ids", "device_fingerprint256"),
                "lease_constraint_fields_invalid");
        int maxTextBytes = (int) integer(
                constraints, "max_panel_text_bytes", 1, MAX_PANEL_TEXT_BYTES,
                "lease_text_bound_invalid");
        JSONArray ids = array(constraints, "allowed_surface_ids", "lease_surface_ids_invalid");
        if (ids.length() < 1 || ids.length() > 16) {
            throw failure("lease_surface_ids_invalid", "Lease surface-id list is empty or too large.");
        }
        Set<String> surfaceIds = new HashSet<>();
        for (int i = 0; i < ids.length(); i++) {
            try {
                surfaceIds.add(token(ids.getString(i), "lease_surface_id_invalid"));
            } catch (JSONException error) {
                throw failure("lease_surface_id_invalid", "Lease surface id is invalid.");
            }
        }
        string(constraints, "device_fingerprint256", "lease_fingerprint_invalid");
        return new Lease(
                leaseId,
                sourceGrantId,
                expectedEpoch,
                issuedAt,
                ttl,
                expiresAt,
                nowElapsedMs + ttl,
                maxTextBytes,
                surfaceIds);
    }

    static SurfaceSnapshot validateSnapshot(
            Frame frame,
            Lease lease,
            BigInteger lastRevision,
            long nowElapsedMs) throws ProtocolException {
        requireType(frame, "PANEL_SNAPSHOT");
        if (!frame.sessionEpoch.equals(lease.sessionEpoch)) {
            throw failure("session_epoch_mismatch", "Snapshot epoch does not match the lease.");
        }
        if (!frame.leaseRef.equals(lease.leaseId)) {
            throw failure("lease_ref_mismatch", "Snapshot lease reference does not match.");
        }
        if (nowElapsedMs >= lease.deadlineElapsedMs) {
            throw failure("lease_expired", "Snapshot arrived after the local lease deadline.");
        }
        exactFields(frame.payload, Set.of(
                "document_encoding", "document_byte_length", "document_sha256", "document_b64"),
                "snapshot_payload_fields_invalid");
        if (!string(frame.payload, "document_encoding", "document_encoding_invalid")
                .equals("base64-json-utf8")) {
            throw failure("document_encoding_invalid", "Snapshot encoding is unsupported.");
        }
        int documentLength = (int) integer(
                frame.payload, "document_byte_length", 1, MAX_DOCUMENT_BYTES,
                "document_length_invalid");
        String documentHash = string(frame.payload, "document_sha256", "document_hash_invalid");
        if (!SHA256.matcher(documentHash).matches()) {
            throw failure("document_hash_invalid", "Snapshot document hash is invalid.");
        }
        byte[] documentBytes = decodeCanonicalBase64(
                string(frame.payload, "document_b64", "document_base64_invalid"),
                "document_base64_invalid");
        if (documentBytes.length != documentLength) {
            throw failure("document_length_mismatch", "Snapshot document length does not match.");
        }
        if (!sha256(documentBytes).equals(documentHash)) {
            throw failure("document_hash_mismatch", "Snapshot document hash does not match.");
        }
        final JSONObject document;
        try {
            document = new JSONObject(decodeUtf8(documentBytes, "document_not_utf8"));
        } catch (JSONException error) {
            throw failure("document_json_invalid", "Snapshot document is not valid JSON.");
        }
        String v2AnswerId = null;
        String v2UtteranceId = null;
        // v2: allow answer_id / utterance_id correlation (7 fields), v1 is 5 fields
        if (document.has("answer_id") || document.has("utterance_id")) {
            exactFields(document, Set.of(
                    "schema_version", "revision", "ttl_ms", "lease_ref", "surface", "answer_id", "utterance_id"),
                    "document_fields_invalid");
            if (integer(document, "schema_version", 1, 2, "document_schema_unsupported") != 2) {
                throw failure("document_schema_mismatch", "v2 document must have schema 2");
            }
            String answerId = string(document, "answer_id", "answer_id_invalid");
            String utteranceId = string(document, "utterance_id", "utterance_id_invalid");
            if (answerId.isEmpty() || answerId.length() > 256 || !answerId.trim().equals(answerId)) throw failure("answer_id_invalid", "Answer id invalid");
            if (utteranceId.isEmpty() || utteranceId.length() > 256 || !utteranceId.trim().equals(utteranceId)) throw failure("utterance_id_invalid", "Utterance id invalid");
            v2AnswerId = answerId;
            v2UtteranceId = utteranceId;
        } else {
            exactFields(document, Set.of(
                    "schema_version", "revision", "ttl_ms", "lease_ref", "surface"),
                    "document_fields_invalid");
            if (integer(document, "schema_version", 1, 1, "document_schema_unsupported") != 1) {
                throw failure("document_schema_unsupported", "Snapshot schema is unsupported.");
            }
        }
        BigInteger revision = unsigned(
                string(document, "revision", "document_revision_invalid"),
                "document_revision_invalid");
        if (revision.signum() == 0 || revision.compareTo(lastRevision) <= 0) {
            throw failure("document_revision_stale", "Snapshot revision is not newer than displayed state.");
        }
        long documentTtl = integer(
                document, "ttl_ms", 1, lease.ttlMs, "document_ttl_invalid");
        if (nowElapsedMs > Long.MAX_VALUE - documentTtl
                || nowElapsedMs + documentTtl > lease.deadlineElapsedMs) {
            throw failure("document_ttl_exceeds_lease", "Snapshot TTL exceeds the active lease.");
        }
        if (!string(document, "lease_ref", "document_lease_invalid").equals(lease.leaseId)) {
            throw failure("document_lease_mismatch", "Snapshot document lease does not match.");
        }
        JSONObject surface = object(document, "surface", "surface_invalid");
        exactFields(surface, Set.of("id", "kind", "space", "pose", "bounds", "resource"),
                "surface_fields_invalid");
        String surfaceId = token(string(surface, "id", "surface_id_invalid"), "surface_id_invalid");
        if (!lease.allowedSurfaceIds.contains(surfaceId)) {
            throw failure("surface_not_leased", "Snapshot surface id is outside the lease.");
        }
        if (!string(surface, "kind", "surface_kind_invalid").equals("panel")
                || !string(surface, "space", "surface_space_invalid").equals("view")) {
            throw failure("surface_kind_invalid", "v1a accepts one view-space panel only.");
        }
        Pose pose = validatePose(object(surface, "pose", "pose_invalid"));
        Bounds requestedBounds = validateBounds(object(surface, "bounds", "bounds_invalid"));
        JSONObject resource = object(surface, "resource", "resource_invalid");
        exactFields(resource, Set.of(
                "media_type", "encoding", "byte_length", "sha256", "text"),
                "resource_fields_invalid");
        if (!string(resource, "media_type", "resource_type_invalid")
                .equals("text/plain;charset=utf-8")
                || !string(resource, "encoding", "resource_encoding_invalid").equals("utf-8")) {
            throw failure("resource_type_invalid", "v1a accepts inline UTF-8 panel text only.");
        }
        String text = string(resource, "text", "resource_text_invalid");
        byte[] textBytes = utf8(text);
        int resourceLength = (int) integer(
                resource, "byte_length", 1, lease.maxPanelTextBytes, "resource_length_invalid");
        if (textBytes.length != resourceLength) {
            throw failure("resource_length_mismatch", "Panel text length does not match.");
        }
        String resourceHash = string(resource, "sha256", "resource_hash_invalid");
        if (!SHA256.matcher(resourceHash).matches() || !sha256(textBytes).equals(resourceHash)) {
            throw failure("resource_hash_mismatch", "Panel text hash does not match.");
        }
        Pose actualPose = new Pose(
                clamp(pose.x, -1.0f, 1.0f),
                clamp(pose.y, -1.0f, 1.0f),
                clamp(pose.z, -3.0f, -0.5f),
                pose.qx, pose.qy, pose.qz, pose.qw);
        Bounds actualBounds = new Bounds(
                clamp(requestedBounds.width, 0.35f, 2.0f),
                clamp(requestedBounds.height, 0.20f, 1.2f));
        return new SurfaceSnapshot(
                revision,
                documentHash,
                surfaceId,
                text,
                v2AnswerId,
                v2UtteranceId,
                actualPose,
                actualBounds,
                nowElapsedMs + documentTtl);
    }

    static JSONObject actualBoundsAck(SurfaceSnapshot snapshot, boolean displayed)
            throws ProtocolException {
        try {
            JSONObject bounds = new JSONObject();
            bounds.put("width_m", snapshot.bounds.width);
            bounds.put("height_m", snapshot.bounds.height);
            JSONObject payload = new JSONObject();
            payload.put("document_revision", snapshot.revision.toString());
            payload.put("document_hash", snapshot.documentHash);
            payload.put("surface_id", snapshot.surfaceId);
            payload.put("actual_bounds", bounds);
            payload.put("displayed", displayed);
            return payload;
        } catch (JSONException error) {
            throw failure("bounds_ack_encode_failed", "Could not encode actual bounds acknowledgement.");
        }
    }

    static JSONObject utterancePayload(String utteranceId) throws ProtocolException {
        try {
            return new JSONObject().put(
                    "utterance_id", token(utteranceId, "utterance_id_missing"));
        } catch (JSONException error) {
            throw failure("utterance_payload_encode_failed", "Could not encode utterance payload.");
        }
    }

    static JSONObject cancelPayload(String utteranceId, String reason) throws ProtocolException {
        try {
            return utterancePayload(utteranceId).put(
                    "reason", token(reason == null ? "client_cancel" : reason,
                            "cancel_reason_invalid"));
        } catch (JSONException error) {
            throw failure("cancel_payload_encode_failed", "Could not encode cancel payload.");
        }
    }

    static JSONObject audioChunkPayload(
            String utteranceId, String answerId, byte[] pcm, int channels)
            throws ProtocolException {
        AudioChunk chunk = validatePcm(
                token(utteranceId, "utterance_id_missing"),
                optionalToken(answerId, "answer_id_invalid"),
                pcm,
                channels);
        try {
            return new JSONObject()
                    .put("utterance_id", chunk.utteranceId)
                    .put("answer_id", chunk.answerId)
                    .put("pcm_encoding", "pcm_s16le_b64")
                    .put("sample_rate", AUDIO_SAMPLE_RATE)
                    .put("channels", chunk.channels)
                    .put("frames", chunk.frames)
                    .put("chunk_ms", chunk.chunkMs)
                    .put("pcm_bytes", chunk.pcm.length)
                    .put("pcm_sha256", sha256(chunk.pcm))
                    .put("pcm_b64", Base64.getEncoder().encodeToString(chunk.pcm));
        } catch (JSONException error) {
            throw failure("audio_payload_encode_failed", "Could not encode audio payload.");
        }
    }

    static String validateUtteranceFrame(
            Frame frame, String expectedType, Lease lease, long nowElapsedMs)
            throws ProtocolException {
        requireLeasedFrame(frame, expectedType, "uplink", lease, nowElapsedMs);
        exactFields(frame.payload, Set.of("utterance_id"),
                expectedType.equals("UTTERANCE_START")
                        ? "utterance_start_fields_invalid"
                        : "utterance_end_fields_invalid");
        return token(
                string(frame.payload, "utterance_id", "utterance_id_missing"),
                "utterance_id_missing");
    }

    static String validateCancelFrame(Frame frame, Lease lease, long nowElapsedMs)
            throws ProtocolException {
        requireLeasedFrame(frame, "CANCEL", "uplink", lease, nowElapsedMs);
        exactFields(frame.payload, Set.of("utterance_id", "reason"), "cancel_fields_invalid");
        token(string(frame.payload, "reason", "cancel_reason_invalid"), "cancel_reason_invalid");
        return token(
                string(frame.payload, "utterance_id", "utterance_id_missing"),
                "utterance_id_missing");
    }

    static AudioChunk validateAudioChunk(
            Frame frame, String expectedDirection, Lease lease, long nowElapsedMs)
            throws ProtocolException {
        requireLeasedFrame(frame, "AUDIO_CHUNK", expectedDirection, lease, nowElapsedMs);
        exactFields(frame.payload, Set.of(
                "utterance_id", "answer_id", "pcm_encoding", "sample_rate", "channels",
                "frames", "chunk_ms", "pcm_bytes", "pcm_sha256", "pcm_b64"),
                "audio_payload_fields_invalid");
        String utteranceId = token(
                string(frame.payload, "utterance_id", "utterance_id_missing"),
                "utterance_id_missing");
        String answerId = optionalToken(
                string(frame.payload, "answer_id", "answer_id_invalid"), "answer_id_invalid");
        if (!string(frame.payload, "pcm_encoding", "pcm_encoding_invalid")
                .equals("pcm_s16le_b64")) {
            throw failure("pcm_encoding_invalid", "PCM encoding is unsupported.");
        }
        if (integer(frame.payload, "sample_rate", AUDIO_SAMPLE_RATE, AUDIO_SAMPLE_RATE,
                "sample_rate_invalid") != AUDIO_SAMPLE_RATE) {
            throw failure("sample_rate_invalid", "Only 48 kHz PCM is supported.");
        }
        int channels = (int) integer(frame.payload, "channels", 1, 2, "channels_invalid");
        if ((expectedDirection.equals("uplink") && channels != 1)
                || (expectedDirection.equals("downlink") && channels != 2)) {
            throw failure("audio_direction_mismatch", "PCM channels do not match direction.");
        }
        if (expectedDirection.equals("uplink") && !answerId.isEmpty()) {
            throw failure("answer_id_unexpected", "Mic uplink must not claim an answer id.");
        }
        if (expectedDirection.equals("downlink") && answerId.isEmpty()) {
            throw failure("answer_id_invalid", "Playback requires an answer id.");
        }
        int frames = (int) integer(
                frame.payload, "frames", AUDIO_FRAMES_20_MS, AUDIO_FRAMES_40_MS,
                "pcm_frames_invalid");
        if (frames != AUDIO_FRAMES_20_MS && frames != AUDIO_FRAMES_40_MS) {
            throw failure("pcm_frames_invalid", "PCM frame count is unsupported.");
        }
        int chunkMs = (int) integer(frame.payload, "chunk_ms", 20, 40, "chunk_ms_invalid");
        int expectedChunkMs = frames == AUDIO_FRAMES_20_MS ? 20 : 40;
        if (chunkMs != expectedChunkMs) {
            throw failure("chunk_ms_mismatch", "PCM duration does not match frame count.");
        }
        int declaredBytes = (int) integer(
                frame.payload, "pcm_bytes", 1, MAX_AUDIO_BYTES, "pcm_bytes_invalid");
        String declaredHash = string(frame.payload, "pcm_sha256", "pcm_hash_invalid");
        if (!SHA256.matcher(declaredHash).matches()) {
            throw failure("pcm_hash_invalid", "PCM hash is invalid.");
        }
        byte[] pcm = decodeCanonicalBase64(
                string(frame.payload, "pcm_b64", "pcm_encoding_invalid"),
                "pcm_encoding_invalid");
        if (pcm.length != declaredBytes) {
            throw failure("pcm_length_mismatch", "PCM length does not match its declaration.");
        }
        if (!sha256(pcm).equals(declaredHash)) {
            throw failure("pcm_hash_mismatch", "PCM hash does not match.");
        }
        AudioChunk parsed = validatePcm(utteranceId, answerId, pcm, channels);
        if (parsed.frames != frames || parsed.chunkMs != chunkMs) {
            throw failure("pcm_frames_mismatch", "PCM shape does not match its declaration.");
        }
        return parsed;
    }

    static void validateAnswerEnd(
            Frame frame, String expectedDirection, Lease lease, long nowElapsedMs,
            String expectedAnswerId, String expectedUtteranceId) throws ProtocolException {
        requireLeasedFrame(frame, "ANSWER_END", expectedDirection, lease, nowElapsedMs);
        exactFields(frame.payload, Set.of("utterance_id", "answer_id"), "answer_end_fields_invalid");
        String utteranceId = token(string(frame.payload, "utterance_id", "utterance_id_missing"), "utterance_id_missing");
        String answerId = token(string(frame.payload, "answer_id", "answer_id_invalid"), "answer_id_invalid");
        if (!utteranceId.equals(expectedUtteranceId) || !answerId.equals(expectedAnswerId)) {
            throw failure("answer_correlation_mismatch", "ANSWER_END does not match panel correlation.");
        }
        if (frame.streamId == 0) throw failure("stream_id_invalid", "ANSWER_END requires nonzero stream");
    }

    static String validateError(Frame frame) throws ProtocolException {
        requireType(frame, "ERROR");
        exactFields(frame.payload, Set.of("code", "retryable"), "error_fields_invalid");
        Object retryable;
        try {
            retryable = frame.payload.get("retryable");
        } catch (JSONException error) {
            throw failure("error_retryable_invalid", "Error retryable flag is invalid.");
        }
        if (!(retryable instanceof Boolean)) {
            throw failure("error_retryable_invalid", "Error retryable flag is invalid.");
        }
        return token(string(frame.payload, "code", "error_code_invalid"), "error_code_invalid");
    }

    private static void requireLeasedFrame(
            Frame frame,
            String expectedType,
            String expectedDirection,
            Lease lease,
            long nowElapsedMs) throws ProtocolException {
        requireType(frame, expectedType);
        if (!frame.direction.equals(expectedDirection)) {
            throw failure("direction_mismatch", "Frame direction does not match its role.");
        }
        if (!frame.sessionEpoch.equals(lease.sessionEpoch)) {
            throw failure("session_epoch_mismatch", "Frame epoch does not match its lease.");
        }
        if (!frame.leaseRef.equals(lease.leaseId)) {
            throw failure("lease_ref_mismatch", "Frame lease reference does not match.");
        }
        if (nowElapsedMs >= lease.deadlineElapsedMs) {
            throw failure("lease_expired", "Frame arrived after its local lease deadline.");
        }
    }

    private static AudioChunk validatePcm(
            String utteranceId, String answerId, byte[] pcm, int channels)
            throws ProtocolException {
        if (pcm == null || channels < 1 || channels > 2 || pcm.length == 0
                || pcm.length > MAX_AUDIO_BYTES || pcm.length % (2 * channels) != 0) {
            throw failure("pcm_bytes_invalid", "PCM byte shape is invalid.");
        }
        int frames = pcm.length / (2 * channels);
        if (frames != AUDIO_FRAMES_20_MS && frames != AUDIO_FRAMES_40_MS) {
            throw failure("pcm_frames_invalid", "PCM must contain 20 or 40 ms per channel.");
        }
        return new AudioChunk(
                utteranceId,
                answerId,
                pcm.clone(),
                channels,
                frames,
                frames == AUDIO_FRAMES_20_MS ? 20 : 40);
    }

    private static String optionalToken(String value, String code) throws ProtocolException {
        if (value == null || value.isEmpty()) {
            return "";
        }
        return token(value, code);
    }

    private static Pose validatePose(JSONObject pose) throws ProtocolException {
        exactFields(pose, Set.of("position", "orientation"), "pose_fields_invalid");
        JSONObject position = object(pose, "position", "position_invalid");
        JSONObject orientation = object(pose, "orientation", "orientation_invalid");
        exactFields(position, Set.of("x", "y", "z"), "position_fields_invalid");
        exactFields(orientation, Set.of("x", "y", "z", "w"), "orientation_fields_invalid");
        float x = finiteFloat(position, "x", "position_invalid");
        float y = finiteFloat(position, "y", "position_invalid");
        float z = finiteFloat(position, "z", "position_invalid");
        float qx = finiteFloat(orientation, "x", "orientation_invalid");
        float qy = finiteFloat(orientation, "y", "orientation_invalid");
        float qz = finiteFloat(orientation, "z", "orientation_invalid");
        float qw = finiteFloat(orientation, "w", "orientation_invalid");
        double magnitude = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
        if (magnitude < 0.999 || magnitude > 1.001) {
            throw failure("orientation_not_normalized", "Panel orientation is not normalized.");
        }
        return new Pose(x, y, z, qx, qy, qz, qw);
    }

    private static Bounds validateBounds(JSONObject bounds) throws ProtocolException {
        exactFields(bounds, Set.of("width_m", "height_m"), "bounds_fields_invalid");
        float width = finiteFloat(bounds, "width_m", "bounds_invalid");
        float height = finiteFloat(bounds, "height_m", "bounds_invalid");
        if (width <= 0 || height <= 0) {
            throw failure("bounds_invalid", "Panel bounds must be positive.");
        }
        return new Bounds(width, height);
    }

    private static void requireType(Frame frame, String type) throws ProtocolException {
        if (!frame.type.equals(type)) {
            throw failure("message_type_unexpected", "Unexpected server message type.");
        }
    }

    static Manifest validateManifest(
            Frame frame, BigInteger expectedEpoch, long nowElapsedMs) throws ProtocolException {
        requireType(frame, "LEASE_MANIFEST");
        if (!frame.sessionEpoch.equals(expectedEpoch)) {
            throw failure("session_epoch_mismatch", "Manifest epoch does not match HELLO_ACK.");
        }
        exactFields(frame.payload, Set.of(
                "schema_version", "session_epoch", "issued_at_ms", "ttl_ms",
                "expires_at_ms", "leases"), "manifest_payload_fields_invalid");
        if (integer(frame.payload, "schema_version", 1, 1,
                "manifest_schema_unsupported") != 1) {
            throw failure("manifest_schema_unsupported", "Manifest schema is unsupported.");
        }
        BigInteger epoch = unsigned(
                string(frame.payload, "session_epoch", "manifest_epoch_invalid"),
                "manifest_epoch_invalid");
        if (!epoch.equals(expectedEpoch)) {
            throw failure("manifest_epoch_mismatch", "Manifest payload epoch does not match.");
        }
        long issuedAt = integer(
                frame.payload, "issued_at_ms", 0, MAX_SAFE_JSON_INTEGER,
                "manifest_issued_invalid");
        long ttlMs = integer(
                frame.payload, "ttl_ms", 1, MAX_LEASE_TTL_MS, "manifest_ttl_invalid");
        long expiresAt = integer(
                frame.payload, "expires_at_ms", 0, MAX_SAFE_JSON_INTEGER,
                "manifest_expires_invalid");
        if (issuedAt > Long.MAX_VALUE - ttlMs || issuedAt + ttlMs != expiresAt) {
            throw failure("manifest_expires_mismatch", "Manifest expiry is inconsistent.");
        }

        JSONObject leaves = object(frame.payload, "leases", "manifest_leases_invalid");
        Set<String> required = Set.of("panel", "mic_capture", "audio_present", "local_attach");
        exactFields(leaves, required, "manifest_leaves_invalid");
        Map<String, Lease> leases = new HashMap<>();
        Set<String> leaseIds = new HashSet<>();
        Set<String> grantIds = new HashSet<>();
        for (String name : required) {
            JSONObject leaf = object(leaves, name, "manifest_lease_invalid");
            exactFields(leaf, Set.of(
                    "lease_id", "source_grant_id", "capability", "provider", "scope",
                    "session_epoch", "issued_at_ms", "ttl_ms", "expires_at_ms", "constraints"),
                    "manifest_lease_fields_invalid");
            String leaseId = token(
                    string(leaf, "lease_id", "lease_id_invalid"), "lease_id_invalid");
            String grantId = token(
                    string(leaf, "source_grant_id", "grant_id_invalid"), "grant_id_invalid");
            if (!leaseIds.add(leaseId)) {
                throw failure("manifest_duplicate_lease_id", "Manifest lease ids must be unique.");
            }
            if (!grantIds.add(grantId)) {
                throw failure("manifest_duplicate_grant_id", "Manifest grant ids must be unique.");
            }
            String capability = string(leaf, "capability", "capability_invalid");
            String provider = string(leaf, "provider", "provider_invalid");
            String scope = string(leaf, "scope", "scope_invalid");
            validateManifestAuthority(name, capability, provider, scope);
            BigInteger leafEpoch = unsigned(
                    string(leaf, "session_epoch", "session_epoch_invalid"),
                    "session_epoch_invalid");
            if (!leafEpoch.equals(epoch)) {
                throw failure("manifest_epoch_mismatch", "Manifest leaf epoch does not match.");
            }
            long leafIssuedAt = integer(
                    leaf, "issued_at_ms", 0, MAX_SAFE_JSON_INTEGER,
                    "lease_issued_at_invalid");
            long leafTtlMs = integer(
                    leaf, "ttl_ms", 1, MAX_LEASE_TTL_MS, "lease_ttl_invalid");
            long leafExpiresAt = integer(
                    leaf, "expires_at_ms", 0, MAX_SAFE_JSON_INTEGER,
                    "lease_expiry_invalid");
            if (leafIssuedAt != issuedAt || leafTtlMs != ttlMs || leafExpiresAt != expiresAt
                    || leafIssuedAt > Long.MAX_VALUE - leafTtlMs
                    || leafIssuedAt + leafTtlMs != leafExpiresAt) {
                throw failure("manifest_leaf_time_mismatch", "Manifest leaf times do not match.");
            }
            JSONObject constraints = object(
                    leaf, "constraints", "manifest_constraints_invalid");
            Lease parsed = manifestLease(
                    name, leaseId, grantId, capability, provider, scope, epoch, ttlMs,
                    issuedAt, expiresAt, nowElapsedMs, constraints);
            leases.put(name, parsed);
        }
        long deadlineElapsedMs = safeDeadline(nowElapsedMs, ttlMs, "manifest_deadline_invalid");
        return new Manifest(
                epoch, issuedAt, ttlMs, expiresAt, deadlineElapsedMs, leases);
    }

    private static void validateManifestAuthority(
            String name, String capability, String provider, String scope)
            throws ProtocolException {
        String expectedCapability;
        String expectedProvider;
        Set<String> allowedScopes;
        switch (name) {
            case "panel":
                expectedCapability = CAPABILITY;
                expectedProvider = PROVIDER;
                allowedScopes = Set.of("session");
                break;
            case "mic_capture":
                expectedCapability = MIC_CAPTURE_CAPABILITY;
                expectedProvider = PROVIDER;
                allowedScopes = Set.of("session");
                break;
            case "audio_present":
                expectedCapability = AUDIO_PRESENT_CAPABILITY;
                expectedProvider = PROVIDER;
                allowedScopes = Set.of("session");
                break;
            case "local_attach":
                expectedCapability = LOCAL_ATTACH_CAPABILITY;
                expectedProvider = LOCAL_MODEL_PROVIDER;
                allowedScopes = Set.of("once", "window");
                break;
            default:
                throw failure("manifest_leaf_invalid", "Manifest leaf name is unsupported.");
        }
        if (!capability.equals(expectedCapability)) {
            throw failure("manifest_capability_mismatch", "Manifest capability does not match.");
        }
        if (!provider.equals(expectedProvider)) {
            throw failure("manifest_provider_mismatch", "Manifest provider does not match.");
        }
        if (!allowedScopes.contains(scope)) {
            throw failure("manifest_scope_invalid", "Manifest scope is unsupported.");
        }
    }

    private static Lease manifestLease(
            String name,
            String leaseId,
            String grantId,
            String capability,
            String provider,
            String scope,
            BigInteger epoch,
            long ttlMs,
            long issuedAtMs,
            long expiresAtMs,
            long nowElapsedMs,
            JSONObject constraints) throws ProtocolException {
        int maxPanelTextBytes = MAX_PANEL_TEXT_BYTES;
        Set<String> allowedSurfaceIds = Set.of("panel.main");
        if (name.equals("panel")) {
            exactFields(constraints, Set.of(
                    "max_panel_text_bytes", "allowed_surface_ids", "device_fingerprint256"),
                    "lease_constraint_fields_invalid");
            maxPanelTextBytes = (int) integer(
                    constraints, "max_panel_text_bytes", 1, MAX_PANEL_TEXT_BYTES,
                    "lease_text_bound_invalid");
            JSONArray ids = array(
                    constraints, "allowed_surface_ids", "lease_surface_ids_invalid");
            if (ids.length() < 1 || ids.length() > 16) {
                throw failure(
                        "lease_surface_ids_invalid", "Lease surface-id list is invalid.");
            }
            Set<String> parsedIds = new HashSet<>();
            for (int index = 0; index < ids.length(); index++) {
                try {
                    parsedIds.add(token(ids.getString(index), "lease_surface_id_invalid"));
                } catch (JSONException error) {
                    throw failure("lease_surface_id_invalid", "Lease surface id is invalid.");
                }
            }
            string(constraints, "device_fingerprint256", "lease_fingerprint_invalid");
            allowedSurfaceIds = parsedIds;
        } else {
            exactFields(constraints, Set.of("device_fingerprint256"), "lease_constraints_unsupported");
            string(constraints, "device_fingerprint256", "lease_fingerprint_invalid");
        }
        return new Lease(
                leaseId,
                grantId,
                capability,
                provider,
                scope,
                epoch,
                issuedAtMs,
                ttlMs,
                expiresAtMs,
                safeDeadline(nowElapsedMs, ttlMs, "lease_deadline_invalid"),
                maxPanelTextBytes,
                allowedSurfaceIds);
    }

    private static long safeDeadline(long nowElapsedMs, long ttlMs, String code)
            throws ProtocolException {
        if (nowElapsedMs < 0 || nowElapsedMs > Long.MAX_VALUE - ttlMs) {
            throw failure(code, "Local lease deadline overflows.");
        }
        return nowElapsedMs + ttlMs;
    }

    private static void validateLeaseBinding(String type, String leaseRef) throws ProtocolException {
        String ref = leaseRef == null ? "" : leaseRef;
        if (!UNLEASED_TYPES.contains(type) && ref.isEmpty()) {
            throw failure("lease_ref_required", "Capability content requires a lease reference.");
        }
        if (UNLEASED_TYPES.contains(type)
                && !type.equals("FOCUS_LOST")
                && !type.equals("SUSPEND")
                && !ref.isEmpty()) {
            throw failure("lease_ref_unexpected", "Pre-authority control cannot claim a lease.");
        }
    }

    private static void exactFields(JSONObject object, Set<String> expected, String code)
            throws ProtocolException {
        Set<String> actual = new HashSet<>();
        Iterator<String> keys = object.keys();
        while (keys.hasNext()) {
            actual.add(keys.next());
        }
        if (!actual.equals(expected)) {
            throw failure(code, "Object has missing or unknown fields.");
        }
    }

    private static JSONObject object(JSONObject parent, String key, String code)
            throws ProtocolException {
        try {
            return parent.getJSONObject(key);
        } catch (JSONException error) {
            throw failure(code, "Required object field is invalid.");
        }
    }

    private static JSONArray array(JSONObject parent, String key, String code)
            throws ProtocolException {
        try {
            return parent.getJSONArray(key);
        } catch (JSONException error) {
            throw failure(code, "Required array field is invalid.");
        }
    }

    private static String string(JSONObject parent, String key, String code)
            throws ProtocolException {
        try {
            Object value = parent.get(key);
            if (!(value instanceof String)) {
                throw failure(code, "Required string field is invalid.");
            }
            return (String) value;
        } catch (JSONException error) {
            throw failure(code, "Required string field is invalid.");
        }
    }

    private static long integer(JSONObject parent, String key, long min, long max, String code)
            throws ProtocolException {
        try {
            Object raw = parent.get(key);
            if (!(raw instanceof Number)) {
                throw failure(code, "Required integer field is invalid.");
            }
            Number number = (Number) raw;
            long value = number.longValue();
            if (number.doubleValue() != (double) value || value < min || value > max) {
                throw failure(code, "Integer field is outside its allowed range.");
            }
            return value;
        } catch (JSONException error) {
            throw failure(code, "Required integer field is invalid.");
        }
    }

    private static float finiteFloat(JSONObject parent, String key, String code)
            throws ProtocolException {
        try {
            double value = parent.getDouble(key);
            if (!Double.isFinite(value) || value < -Float.MAX_VALUE || value > Float.MAX_VALUE) {
                throw failure(code, "Numeric field is not finite.");
            }
            return (float) value;
        } catch (JSONException error) {
            throw failure(code, "Numeric field is invalid.");
        }
    }

    private static String token(String value, String code) throws ProtocolException {
        String normalized = value == null ? "" : value.trim();
        if (normalized.isEmpty() || normalized.length() > 256) {
            throw failure(code, "Identifier is empty or too long.");
        }
        return normalized;
    }

    private static BigInteger unsigned(String value, String code) throws ProtocolException {
        if (!U64.matcher(value).matches()) {
            throw failure(code, "Unsigned integer encoding is invalid.");
        }
        BigInteger parsed = new BigInteger(value);
        if (parsed.compareTo(U64_MAX) > 0) {
            throw failure(code, "Unsigned integer exceeds u64.");
        }
        return parsed;
    }

    private static BigInteger signed(String value, String code) throws ProtocolException {
        if (!I64.matcher(value).matches()) {
            throw failure(code, "Signed integer encoding is invalid.");
        }
        BigInteger parsed = new BigInteger(value);
        if (parsed.compareTo(I64_MIN) < 0 || parsed.compareTo(I64_MAX) > 0) {
            throw failure(code, "Signed integer exceeds i64.");
        }
        return parsed;
    }

    private static byte[] decodeCanonicalBase64(String value, String code) throws ProtocolException {
        final byte[] decoded;
        try {
            decoded = Base64.getDecoder().decode(value);
        } catch (IllegalArgumentException error) {
            throw failure(code, "Base64 field is invalid.");
        }
        if (!Base64.getEncoder().encodeToString(decoded).equals(value)) {
            throw failure(code, "Base64 field is not canonical.");
        }
        return decoded;
    }

    private static String sha256(byte[] bytes) throws ProtocolException {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
            StringBuilder hex = new StringBuilder(64);
            for (byte value : digest) {
                hex.append(String.format("%02x", value & 0xff));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException error) {
            throw failure("sha256_unavailable", "SHA-256 is unavailable.");
        }
    }

    private static float clamp(float value, float min, float max) {
        return Math.max(min, Math.min(max, value));
    }

    private static byte[] utf8(String text) {
        return text.getBytes(StandardCharsets.UTF_8);
    }

    static String decodeUtf8(byte[] bytes, String code) throws ProtocolException {
        try {
            return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes))
                    .toString();
        } catch (CharacterCodingException error) {
            throw failure(code, "Bytes are not valid UTF-8.");
        }
    }

    private static ProtocolException failure(String code, String message) {
        return new ProtocolException(code, message);
    }

    static final class Frame {
        final String type;
        final BigInteger sessionEpoch;
        final long streamId;
        final String direction;
        final String leaseRef;
        final BigInteger seq;
        final JSONObject payload;

        Frame(String type, BigInteger sessionEpoch, long streamId, String direction,
              String leaseRef, BigInteger seq, JSONObject payload) {
            this.type = type;
            this.sessionEpoch = sessionEpoch;
            this.streamId = streamId;
            this.direction = direction;
            this.leaseRef = leaseRef;
            this.seq = seq;
            this.payload = payload;
        }
    }

    static final class Lease {
        final String leaseId;
        final String sourceGrantId;
        final String capability;
        final String provider;
        final String scope;
        final BigInteger sessionEpoch;
        final long issuedAtMs;
        final long ttlMs;
        final long expiresAtMs;
        final long deadlineElapsedMs;
        final int maxPanelTextBytes;
        final Set<String> allowedSurfaceIds;

        Lease(String leaseId, String sourceGrantId, BigInteger sessionEpoch, long ttlMs,
              long deadlineElapsedMs, int maxPanelTextBytes, Set<String> allowedSurfaceIds) {
            this(
                    leaseId,
                    sourceGrantId,
                    sessionEpoch,
                    -1,
                    ttlMs,
                    -1,
                    deadlineElapsedMs,
                    maxPanelTextBytes,
                    allowedSurfaceIds);
        }

        Lease(
                String leaseId,
                String sourceGrantId,
                BigInteger sessionEpoch,
                long issuedAtMs,
                long ttlMs,
                long expiresAtMs,
                long deadlineElapsedMs,
                int maxPanelTextBytes,
                Set<String> allowedSurfaceIds) {
            this(
                    leaseId,
                    sourceGrantId,
                    CAPABILITY,
                    PROVIDER,
                    "session",
                    sessionEpoch,
                    issuedAtMs,
                    ttlMs,
                    expiresAtMs,
                    deadlineElapsedMs,
                    maxPanelTextBytes,
                    allowedSurfaceIds);
        }

        Lease(
                String leaseId,
                String sourceGrantId,
                String capability,
                String provider,
                String scope,
                BigInteger sessionEpoch,
                long issuedAtMs,
                long ttlMs,
                long expiresAtMs,
                long deadlineElapsedMs,
                int maxPanelTextBytes,
                Set<String> allowedSurfaceIds) {
            this.leaseId = leaseId;
            this.sourceGrantId = sourceGrantId;
            this.capability = capability;
            this.provider = provider;
            this.scope = scope;
            this.sessionEpoch = sessionEpoch;
            this.issuedAtMs = issuedAtMs;
            this.ttlMs = ttlMs;
            this.expiresAtMs = expiresAtMs;
            this.deadlineElapsedMs = deadlineElapsedMs;
            this.maxPanelTextBytes = maxPanelTextBytes;
            this.allowedSurfaceIds = Set.copyOf(allowedSurfaceIds);
        }
    }

    static final class Manifest {
        final BigInteger sessionEpoch;
        final long issuedAtMs;
        final long ttlMs;
        final long expiresAtMs;
        final long deadlineElapsedMs;
        final Map<String, Lease> leases;

        Manifest(
                BigInteger sessionEpoch,
                long issuedAtMs,
                long ttlMs,
                long expiresAtMs,
                long deadlineElapsedMs,
                Map<String, Lease> leases) {
            this.sessionEpoch = sessionEpoch;
            this.issuedAtMs = issuedAtMs;
            this.ttlMs = ttlMs;
            this.expiresAtMs = expiresAtMs;
            this.deadlineElapsedMs = deadlineElapsedMs;
            this.leases = Map.copyOf(leases);
        }

        Lease lease(String name) {
            return leases.get(name);
        }
    }

    static final class AudioChunk {
        final String utteranceId;
        final String answerId;
        final byte[] pcm;
        final int channels;
        final int frames;
        final int chunkMs;

        AudioChunk(
                String utteranceId,
                String answerId,
                byte[] pcm,
                int channels,
                int frames,
                int chunkMs) {
            this.utteranceId = utteranceId;
            this.answerId = answerId;
            this.pcm = pcm;
            this.channels = channels;
            this.frames = frames;
            this.chunkMs = chunkMs;
        }
    }

    static final class Pose {
        final float x;
        final float y;
        final float z;
        final float qx;
        final float qy;
        final float qz;
        final float qw;

        Pose(float x, float y, float z, float qx, float qy, float qz, float qw) {
            this.x = x;
            this.y = y;
            this.z = z;
            this.qx = qx;
            this.qy = qy;
            this.qz = qz;
            this.qw = qw;
        }
    }

    static final class Bounds {
        final float width;
        final float height;

        Bounds(float width, float height) {
            this.width = width;
            this.height = height;
        }
    }

    static final class SurfaceSnapshot {
        final BigInteger revision;
        final String documentHash;
        final String surfaceId;
        final String text;
        final String answerId;
        final String utteranceId;
        final Pose pose;
        final Bounds bounds;
        final long deadlineElapsedMs;

        SurfaceSnapshot(BigInteger revision, String documentHash, String surfaceId, String text,
                        String answerId, String utteranceId,
                        Pose pose, Bounds bounds, long deadlineElapsedMs) {
            this.revision = revision;
            this.documentHash = documentHash;
            this.surfaceId = surfaceId;
            this.text = text;
            this.answerId = answerId;
            this.utteranceId = utteranceId;
            this.pose = pose;
            this.bounds = bounds;
            this.deadlineElapsedMs = deadlineElapsedMs;
        }
    }

    static final class ProtocolException extends Exception {
        final String code;

        ProtocolException(String code, String message) {
            super(message);
            this.code = code;
        }
    }
}

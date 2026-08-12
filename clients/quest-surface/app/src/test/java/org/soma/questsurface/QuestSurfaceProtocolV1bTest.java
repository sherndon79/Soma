package org.soma.questsurface;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.Set;

public final class QuestSurfaceProtocolV1bTest {
    @Test
    public void validatesExactFourLeafManifestAndDerivesMonotonicDeadline() throws Exception {
        QuestSurfaceProtocol.Manifest manifest = QuestSurfaceV1bTestData.manifest("99", 2_000, 5_000);

        assertEquals(new BigInteger("99"), manifest.sessionEpoch);
        assertEquals(QuestSurfaceV1bTestData.RESUME_HANDLE, manifest.resumeHandle);
        assertEquals(7_000, manifest.deadlineElapsedMs);
        assertEquals(4, manifest.leases.size());
        assertEquals(QuestSurfaceProtocol.CAPABILITY, manifest.lease("panel").capability);
        assertEquals(
                QuestSurfaceProtocol.MIC_CAPTURE_CAPABILITY,
                manifest.lease("mic_capture").capability);
        assertEquals(
                QuestSurfaceProtocol.AUDIO_PRESENT_CAPABILITY,
                manifest.lease("audio_present").capability);
        assertEquals(
                QuestSurfaceProtocol.LOCAL_MODEL_PROVIDER,
                manifest.lease("local_attach").provider);
        assertEquals("once", manifest.lease("local_attach").scope);
    }

    @Test
    public void validatesNodeProducedManifestAndResumeHandleCrossConformance() throws Exception {
        java.io.InputStream in = getClass().getClassLoader()
                .getResourceAsStream("questSurfaceV1bManifestFixture.json");
        if (in == null) {
            throw new AssertionError("questSurfaceV1bManifestFixture.json not found on test classpath");
        }
        JSONObject fixture = new JSONObject(
                new String(in.readAllBytes(), StandardCharsets.UTF_8));
        JSONObject input = fixture.getJSONObject("input");
        JSONObject payload = fixture.getJSONObject("payload");
        String epoch = input.getString("session_epoch");
        QuestSurfaceProtocol.Manifest manifest = QuestSurfaceProtocol.validateManifest(
                QuestSurfaceV1bTestData.serverFrame(
                        "LEASE_MANIFEST", epoch, 0, "", 2, payload),
                new BigInteger(epoch),
                2_000);

        assertEquals(input.getString("resume_handle"), manifest.resumeHandle);
        assertEquals(input.getLong("issued_at_ms"), manifest.issuedAtMs);
        assertEquals(input.getLong("ttl_ms"), manifest.ttlMs);
        assertEquals(4, manifest.leases.size());
    }

    @Test
    public void fourLeafManifestWithFingerprintIsAcceptedCauseMatchedRedToGreen() throws Exception {
        // Before fix, non-panel leaves with {device_fingerprint256} were rejected as
        // lease_constraints_unsupported (empty constraints required). Server correctly
        // sends {device_fingerprint256} for all four leaves; client must accept it.
        JSONObject payload = QuestSurfaceV1bTestData.manifestPayload("99", 10_000, 5_000);
        // verify non-panel leaves carry exactly {device_fingerprint256}
        for (String name : new String[]{"mic_capture", "audio_present", "local_attach"}) {
            JSONObject c = payload.getJSONObject("leases").getJSONObject(name).getJSONObject("constraints");
            assertEquals(1, c.length());
            assertEquals("", c.getString("device_fingerprint256"));
        }
        QuestSurfaceProtocol.Frame frame = QuestSurfaceV1bTestData.serverFrame(
                "LEASE_MANIFEST", "99", 0, "", 2, payload);
        QuestSurfaceProtocol.Manifest manifest = QuestSurfaceProtocol.validateManifest(
                frame, new BigInteger("99"), 2_000);
        assertEquals(4, manifest.leases.size());
        assertEquals(QuestSurfaceProtocol.MIC_CAPTURE_CAPABILITY, manifest.lease("mic_capture").capability);
        assertEquals(QuestSurfaceProtocol.AUDIO_PRESENT_CAPABILITY, manifest.lease("audio_present").capability);
    }

    @Test
    public void rejectsManifestShapeAuthorityIdentityTimeAndConstraintDrift() throws Exception {
        JSONObject base = QuestSurfaceV1bTestData.manifestPayload("99", 10_000, 5_000);

        JSONObject missingHandle = QuestSurfaceV1bTestData.deepCopy(base);
        missingHandle.remove("resume_handle");
        assertManifestError(missingHandle, "manifest_payload_fields_invalid");

        JSONObject invalidHandle = QuestSurfaceV1bTestData.deepCopy(base)
                .put("resume_handle", "");
        assertManifestError(invalidHandle, "resume_handle_invalid");

        JSONObject extraTopLevel = QuestSurfaceV1bTestData.deepCopy(base)
                .put("resume_handle_hint", "not-authoritative");
        assertManifestError(extraTopLevel, "manifest_payload_fields_invalid");

        JSONObject extra = QuestSurfaceV1bTestData.deepCopy(base);
        extra.getJSONObject("leases").put("extra", new JSONObject());
        assertManifestError(extra, "manifest_leaves_invalid");

        JSONObject capability = QuestSurfaceV1bTestData.deepCopy(base);
        capability.getJSONObject("leases").getJSONObject("mic_capture")
                .put("capability", QuestSurfaceProtocol.AUDIO_PRESENT_CAPABILITY);
        assertManifestError(capability, "manifest_capability_mismatch");

        JSONObject provider = QuestSurfaceV1bTestData.deepCopy(base);
        provider.getJSONObject("leases").getJSONObject("local_attach")
                .put("provider", QuestSurfaceProtocol.PROVIDER);
        assertManifestError(provider, "manifest_provider_mismatch");

        JSONObject scope = QuestSurfaceV1bTestData.deepCopy(base);
        scope.getJSONObject("leases").getJSONObject("local_attach").put("scope", "session");
        assertManifestError(scope, "manifest_scope_invalid");

        JSONObject epoch = QuestSurfaceV1bTestData.deepCopy(base);
        epoch.getJSONObject("leases").getJSONObject("audio_present")
                .put("session_epoch", "100");
        assertManifestError(epoch, "manifest_epoch_mismatch");

        JSONObject leafTime = QuestSurfaceV1bTestData.deepCopy(base);
        leafTime.getJSONObject("leases").getJSONObject("mic_capture").put("ttl_ms", 4_999);
        assertManifestError(leafTime, "manifest_leaf_time_mismatch");

        JSONObject expiry = QuestSurfaceV1bTestData.deepCopy(base).put("expires_at_ms", 15_001);
        assertManifestError(expiry, "manifest_expires_mismatch");

        JSONObject duplicateLease = QuestSurfaceV1bTestData.deepCopy(base);
        duplicateLease.getJSONObject("leases").getJSONObject("audio_present")
                .put("lease_id", "lease-mic");
        assertManifestError(duplicateLease, "manifest_duplicate_lease_id");

        JSONObject duplicateGrant = QuestSurfaceV1bTestData.deepCopy(base);
        duplicateGrant.getJSONObject("leases").getJSONObject("audio_present")
                .put("source_grant_id", "grant-mic");
        assertManifestError(duplicateGrant, "manifest_duplicate_grant_id");

        JSONObject nonPanelConstraint = QuestSurfaceV1bTestData.deepCopy(base);
        nonPanelConstraint.getJSONObject("leases").getJSONObject("mic_capture")
                .getJSONObject("constraints").put("unexpected", true);
        assertManifestError(nonPanelConstraint, "lease_constraints_unsupported");

        JSONObject panelConstraint = QuestSurfaceV1bTestData.deepCopy(base);
        panelConstraint.getJSONObject("leases").getJSONObject("panel")
                .getJSONObject("constraints").remove("allowed_surface_ids");
        assertManifestError(panelConstraint, "lease_constraint_fields_invalid");
    }

    @Test
    public void renewalExtendsTimeOnlyAndPreservesExactFourLeaseIds() throws Exception {
        QuestSurfaceProtocol.Manifest current = QuestSurfaceV1bTestData.manifest(
                "99", 2_000, 5_000);
        QuestSurfaceProtocol.Frame frame = QuestSurfaceV1bTestData.serverFrame(
                "LEASE_RENEWAL", "99", 0, "", 5,
                QuestSurfaceV1bTestData.renewalPayload("99", 1, 12_000, 5_000));

        QuestSurfaceProtocol.Manifest renewed = QuestSurfaceProtocol.validateLeaseRenewal(
                frame, current, 3_000);

        assertEquals(1, renewed.generation);
        assertEquals(current.resumeHandle, renewed.resumeHandle);
        assertEquals(8_000, renewed.deadlineElapsedMs);
        assertEquals(17_000, renewed.expiresAtMs);
        for (String name : new String[] {"panel", "mic_capture", "audio_present", "local_attach"}) {
            assertEquals(current.lease(name).leaseId, renewed.lease(name).leaseId);
            assertEquals(current.lease(name).sourceGrantId, renewed.lease(name).sourceGrantId);
            assertEquals(current.lease(name).capability, renewed.lease(name).capability);
            assertEquals(current.lease(name).provider, renewed.lease(name).provider);
            assertEquals(current.lease(name).scope, renewed.lease(name).scope);
        }
        assertEquals(
                Set.of("schema_version", "generation"),
                jsonKeys(QuestSurfaceProtocol.leaseRenewalAckPayload(1)));
    }

    @Test
    public void renewalRejectsChangedIdsAuthorityFieldsStaleGenerationAndNonExtension()
            throws Exception {
        QuestSurfaceProtocol.Manifest current = QuestSurfaceV1bTestData.manifest(
                "99", 2_000, 5_000);

        JSONObject changed = QuestSurfaceV1bTestData.renewalPayload(
                "99", 1, 12_000, 5_000);
        changed.getJSONObject("lease_ids").put("mic_capture", "lease-other");
        assertRenewalError(current, changed, 3_000, "renewal_lease_ids_changed");

        JSONObject authority = QuestSurfaceV1bTestData.renewalPayload(
                "99", 1, 12_000, 5_000).put("capability", QuestSurfaceProtocol.CAPABILITY);
        assertRenewalError(current, authority, 3_000, "renewal_payload_fields_invalid");

        JSONObject stale = QuestSurfaceV1bTestData.renewalPayload(
                "99", 1, 12_000, 5_000);
        QuestSurfaceProtocol.Manifest generationOne = QuestSurfaceProtocol.validateLeaseRenewal(
                QuestSurfaceV1bTestData.serverFrame("LEASE_RENEWAL", "99", 0, "", 5, stale),
                current,
                3_000);
        assertRenewalError(generationOne, stale, 3_001, "renewal_generation_stale");

        JSONObject notExtending = QuestSurfaceV1bTestData.renewalPayload(
                "99", 1, 10_001, 1);
        assertRenewalError(current, notExtending, 3_000, "renewal_not_extending");

        JSONObject localNotExtending = QuestSurfaceV1bTestData.renewalPayload(
                "99", 1, 12_000, 3_000);
        assertRenewalError(current, localNotExtending, 3_000, "renewal_not_extending");
        assertTrue(current.deadlineElapsedMs == 7_000);
    }

    @Test
    public void encodesNonzeroStreamsAndValidatesExactStereoPlayback() throws Exception {
        QuestSurfaceProtocol.Manifest manifest = QuestSurfaceV1bTestData.manifest("99", 2_000, 5_000);
        byte[] pcm = QuestSurfaceV1bTestData.stereo20();
        QuestSurfaceProtocol.Frame frame = QuestSurfaceV1bTestData.playbackFrame(
                "99", 17, "lease-audio", 1, "answer-1", "utterance-1", pcm);

        assertEquals(17, frame.streamId);
        QuestSurfaceProtocol.AudioChunk chunk = QuestSurfaceProtocol.validateAudioChunk(
                frame, "downlink", manifest.lease("audio_present"), 2_001);
        assertEquals("answer-1", chunk.answerId);
        assertEquals("utterance-1", chunk.utteranceId);
        assertEquals(2, chunk.channels);
        assertEquals(960, chunk.frames);
        assertArrayEquals(pcm, chunk.pcm);
    }

    @Test
    public void rejectsWrongPlaybackEpochLeaseDirectionShapeAndHash() throws Exception {
        QuestSurfaceProtocol.Manifest manifest = QuestSurfaceV1bTestData.manifest("99", 2_000, 5_000);
        QuestSurfaceProtocol.Lease audioLease = manifest.lease("audio_present");

        QuestSurfaceProtocol.Frame wrongEpoch = QuestSurfaceV1bTestData.playbackFrame(
                "100", 17, "lease-audio", 1, "answer-1", "utterance-1",
                QuestSurfaceV1bTestData.stereo20());
        assertAudioError(wrongEpoch, audioLease, "session_epoch_mismatch");

        QuestSurfaceProtocol.Frame wrongLease = QuestSurfaceV1bTestData.playbackFrame(
                "99", 17, "lease-mic", 1, "answer-1", "utterance-1",
                QuestSurfaceV1bTestData.stereo20());
        assertAudioError(wrongLease, audioLease, "lease_ref_mismatch");

        QuestSurfaceProtocol.Frame monoDownlink = QuestSurfaceV1bTestData.serverFrame(
                "AUDIO_CHUNK", "99", 17, "lease-audio", 1,
                QuestSurfaceProtocol.audioChunkPayload(
                        "utterance-1", "answer-1", QuestSurfaceV1bTestData.mono20(), 1));
        assertAudioError(monoDownlink, audioLease, "audio_direction_mismatch");

        JSONObject tamperedPayload = QuestSurfaceProtocol.audioChunkPayload(
                "utterance-1", "answer-1", QuestSurfaceV1bTestData.stereo20(), 2)
                .put("pcm_sha256", "0".repeat(64));
        QuestSurfaceProtocol.Frame badHash = QuestSurfaceV1bTestData.serverFrame(
                "AUDIO_CHUNK", "99", 17, "lease-audio", 1, tamperedPayload);
        assertAudioError(badHash, audioLease, "pcm_hash_mismatch");

        QuestSurfaceProtocol.ProtocolException expired = assertThrows(
                QuestSurfaceProtocol.ProtocolException.class,
                () -> QuestSurfaceProtocol.validateAudioChunk(
                        QuestSurfaceV1bTestData.playbackFrame(
                                "99", 17, "lease-audio", 1, "answer-1", "utterance-1",
                                QuestSurfaceV1bTestData.stereo20()),
                        "downlink", audioLease, 7_000));
        assertEquals("lease_expired", expired.code);
    }

    private static void assertManifestError(JSONObject payload, String expectedCode)
            throws Exception {
        QuestSurfaceProtocol.Frame frame = QuestSurfaceV1bTestData.serverFrame(
                "LEASE_MANIFEST", "99", 0, "", 2, payload);
        QuestSurfaceProtocol.ProtocolException error = assertThrows(
                QuestSurfaceProtocol.ProtocolException.class,
                () -> QuestSurfaceProtocol.validateManifest(
                        frame, new BigInteger("99"), 2_000));
        assertEquals(expectedCode, error.code);
    }

    private static void assertRenewalError(
            QuestSurfaceProtocol.Manifest current,
            JSONObject payload,
            long nowElapsedMs,
            String expectedCode) throws Exception {
        QuestSurfaceProtocol.Frame frame = QuestSurfaceV1bTestData.serverFrame(
                "LEASE_RENEWAL", "99", 0, "", 5, payload);
        QuestSurfaceProtocol.ProtocolException error = assertThrows(
                QuestSurfaceProtocol.ProtocolException.class,
                () -> QuestSurfaceProtocol.validateLeaseRenewal(frame, current, nowElapsedMs));
        assertEquals(expectedCode, error.code);
    }

    private static java.util.Set<String> jsonKeys(JSONObject object) {
        java.util.Set<String> keys = new java.util.HashSet<>();
        object.keys().forEachRemaining(keys::add);
        return keys;
    }

    private static void assertAudioError(
            QuestSurfaceProtocol.Frame frame,
            QuestSurfaceProtocol.Lease lease,
            String expectedCode) {
        QuestSurfaceProtocol.ProtocolException error = assertThrows(
                QuestSurfaceProtocol.ProtocolException.class,
                () -> QuestSurfaceProtocol.validateAudioChunk(
                        frame, "downlink", lease, 2_001));
        assertEquals(expectedCode, error.code);
    }
}

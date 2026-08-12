package org.soma.questsurface;

import android.content.res.AssetManager;
import android.os.SystemClock;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigInteger;
import java.net.InetSocketAddress;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManagerFactory;

final class QuestSurfaceTransport {
    private static final String LOG_TAG = "SOMA_QUEST_TLS";
    static final String CLIENT_IDENTITY_ASSET = "quest_client_identity.p12";
    static final String SERVER_CA_ASSET = "quest_server_ca.pem";
    // Compatibility only, not credential protection: this disposable identity and the value
    // needed to open it are both packaged in the test APK. Android rejects an empty PKCS12
    // password before TLS begins.
    private static final String CLIENT_IDENTITY_PASSWORD = "soma-quest-v1a-dev";
    private static final int CONNECT_TIMEOUT_MS = 5_000;
    private static final int READ_TIMEOUT_MS = 15_000;
    private static final int MAX_ATTEMPTS = 8;
    private static final long MAX_BACKOFF_MS = 8_000;
    private static final int RESUME_CONNECT_TIMEOUT_MS = 2_000;
    private static final int RESUME_READ_TIMEOUT_MS = 3_000;
    private static final int RESUME_MAX_ATTEMPTS = 2;
    private static final long RESUME_MAX_BACKOFF_MS = 250;

    private enum SessionState {
        NEW,
        CONNECTING,
        ACTIVE,
        RESUMABLE_SUSPENDING,
        RESUMABLE_SUSPENDED,
        RESUME_REQUESTED,
        TERMINAL
    }

    interface StateSink {
        void accept(String state, String code, int attempt);
    }

    interface SnapshotSink {
        void accept(
                String sessionEpoch,
                String leaseId,
                String revision,
                String documentHash,
                String surfaceId,
                String text,
                float x,
                float y,
                float z,
                float qx,
                float qy,
                float qz,
                float qw,
                float widthMeters,
                float heightMeters,
                long deadlineElapsedMs);
    }

    interface ResumeSink {
        boolean complete(String freshEpoch);
    }

    private final AssetManager assets;
    private final String host;
    private final int port;
    private final StateSink stateSink;
    private final SnapshotSink snapshotSink;
    private final ResumeSink resumeSink;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final ExecutorService writeExecutor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean started = new AtomicBoolean(false);
    private final AtomicBoolean stoppedPermanently = new AtomicBoolean(false);
    private final AtomicReference<SessionState> sessionState =
            new AtomicReference<>(SessionState.NEW);
    private final AtomicReference<SSLSocket> socket = new AtomicReference<>();
    private final Object sendLock = new Object();
    private final QuestSurfaceSequenceTracker sendSequences =
            new QuestSurfaceSequenceTracker();
    private final QuestSurfaceRuntime runtime;
    private final AtomicBoolean captureGate;
    private final long activityGeneration;
    // Device-only mic driver (real AudioRecord), gated on eligibility. Null in the test constructor:
    // capture-driver behavior is unit-tested directly, not through the socket transport.
    private QuestSurfaceCaptureDriver captureDriver;

    private volatile OutputStream output;
    private volatile String latchedSessionEpoch = "";
    private volatile String resumeHandle = "";

    QuestSurfaceTransport(
            AssetManager assets,
            String host,
            int port,
            StateSink stateSink,
            SnapshotSink snapshotSink) {
        this(assets, host, port, stateSink, snapshotSink, freshEpoch -> false);
    }

    QuestSurfaceTransport(
            AssetManager assets,
            String host,
            int port,
            StateSink stateSink,
            SnapshotSink snapshotSink,
            ResumeSink resumeSink) {
        this(
                assets,
                host,
                port,
                stateSink,
                snapshotSink,
                resumeSink,
                new AtomicBoolean(true),
                0L);
    }

    QuestSurfaceTransport(
            AssetManager assets,
            String host,
            int port,
            StateSink stateSink,
            SnapshotSink snapshotSink,
            ResumeSink resumeSink,
            AtomicBoolean captureGate,
            long activityGeneration) {
        // Device path: real AudioTrack playback hardware + a real AudioRecord capture driver.
        this(
                assets,
                host,
                port,
                stateSink,
                snapshotSink,
                new QuestSurfaceRuntime(
                        new QuestSurfaceAudioEngine(new QuestSurfaceAudioHardware())),
                resumeSink,
                captureGate,
                activityGeneration);
        this.captureDriver = new QuestSurfaceCaptureDriver(
                QuestSurfaceCaptureDriver.audioRecordSource(),
                this::captureEligible,
                new QuestSurfaceCaptureDriver.UplinkSink() {
                    @Override public void utteranceStart(long streamId, String utteranceId) throws Exception {
                        sendUtteranceStart(streamId, utteranceId);
                    }
                    @Override public void audioChunk(long streamId, String utteranceId, byte[] pcm) throws Exception {
                        sendAudioChunk(streamId, utteranceId, pcm);
                    }
                    @Override public void utteranceEnd(long streamId, String utteranceId) throws Exception {
                        sendUtteranceEnd(streamId, utteranceId);
                    }
                    @Override public void cancel(long streamId, String utteranceId, String reason) {
                        try { sendCancel(streamId, utteranceId, reason); } catch (Exception ignored) {}
                    }
                },
                QuestSurfaceVad.Config.defaults(),
                null,
                (mode, state) -> {
                    try {
                        QuestSurfaceActivity.nativeOnCaptureStatus(
                                this.activityGeneration,
                                mode == QuestSurfaceCaptureDriver.Mode.PTT ? 0 : 1,
                                state);
                    } catch (Throwable ignored) {}
                });
    }

    void setPttHeld(boolean held) {
        if (!held) {
            forcePttReleased();
            return;
        }
        if (sessionState.get() != SessionState.ACTIVE) return;
        QuestSurfaceCaptureDriver d = captureDriver;
        if (d != null) d.setPttHeld(true);
    }

    void forcePttReleased() {
        QuestSurfaceCaptureDriver d = captureDriver;
        if (d != null) d.setPttHeld(false);
    }

    void toggleCaptureMode() {
        if (sessionState.get() != SessionState.ACTIVE) return;
        QuestSurfaceCaptureDriver d = captureDriver;
        if (d != null) d.toggleMode();
    }

    QuestSurfaceTransport(
            AssetManager assets,
            String host,
            int port,
            StateSink stateSink,
            SnapshotSink snapshotSink,
            QuestSurfaceRuntime runtime) {
        this(assets, host, port, stateSink, snapshotSink, runtime, freshEpoch -> false);
    }

    QuestSurfaceTransport(
            AssetManager assets,
            String host,
            int port,
            StateSink stateSink,
            SnapshotSink snapshotSink,
            QuestSurfaceRuntime runtime,
            ResumeSink resumeSink) {
        this(
                assets,
                host,
                port,
                stateSink,
                snapshotSink,
                runtime,
                resumeSink,
                new AtomicBoolean(true),
                0L);
    }

    QuestSurfaceTransport(
            AssetManager assets,
            String host,
            int port,
            StateSink stateSink,
            SnapshotSink snapshotSink,
            QuestSurfaceRuntime runtime,
            ResumeSink resumeSink,
            AtomicBoolean captureGate,
            long activityGeneration) {
        this.assets = assets;
        this.host = host;
        this.port = port;
        this.stateSink = stateSink;
        this.snapshotSink = snapshotSink;
        this.resumeSink = resumeSink == null ? freshEpoch -> false : resumeSink;
        this.runtime = runtime;
        this.captureGate = captureGate == null ? new AtomicBoolean(false) : captureGate;
        this.activityGeneration = activityGeneration;
        this.captureDriver = null;
    }

    /** Capture is authorized only while focused+started, armed with a live mic lease, and unlatched. */
    private boolean captureEligible() {
        return captureGate.get()
                && !stoppedPermanently.get()
                && started.get()
                && sessionState.get() == SessionState.ACTIVE
                && runtime.hasManifest()
                && runtime.micLease() != null
                && !runtime.isLatched();
    }

    boolean startIfEligible() {
        if (stoppedPermanently.get()) {
            return false;
        }
        if (sessionState.compareAndSet(SessionState.NEW, SessionState.CONNECTING)) {
            started.set(true);
            executor.execute(() -> runBoundedAttempts(false));
        }
        SessionState state = sessionState.get();
        return state == SessionState.CONNECTING || state == SessionState.ACTIVE;
    }

    void stopPermanently(String reason) {
        if (!stoppedPermanently.compareAndSet(false, true)) {
            return;
        }
        sessionState.set(SessionState.TERMINAL);
        started.set(false);
        narrowSessionSynchronously(reason == null ? "local_stop" : reason);
        stateSink.accept("terminal", boundedCode(reason), 0);
        executor.shutdownNow();
        writeExecutor.shutdownNow();
    }

    boolean suspendResumable(String reason) {
        if (stoppedPermanently.get()) {
            return false;
        }
        SessionState priorState;
        for (;;) {
            priorState = sessionState.get();
            if (priorState == SessionState.CONNECTING || priorState == SessionState.NEW) {
                stopPermanently(reason == null ? "suspend_before_session" : reason);
                return false;
            }
            if (priorState != SessionState.ACTIVE
                    && priorState != SessionState.RESUME_REQUESTED) {
                return false;
            }
            if (sessionState.compareAndSet(
                    priorState, SessionState.RESUMABLE_SUSPENDING)) {
                break;
            }
        }
        String prior = priorState == SessionState.RESUME_REQUESTED
                ? latchedSessionEpoch
                : runtime.sessionEpoch();
        String handle = priorState == SessionState.RESUME_REQUESTED
                ? resumeHandle
                : runtime.resumeHandle();
        if (prior.isEmpty() || prior.equals("0") || handle.isEmpty()) {
            stopPermanently(reason == null ? "resume_context_missing" : reason);
            return false;
        }
        latchedSessionEpoch = prior;
        resumeHandle = handle;
        started.set(false);
        narrowSessionSynchronously(reason == null ? "local_suspend" : reason);
        sessionState.set(SessionState.RESUMABLE_SUSPENDED);
        stateSink.accept("suspended", "press_a_to_resume", 0);
        return true;
    }

    boolean resumeFromExplicitLocalAction() {
        if (stoppedPermanently.get()
                || latchedSessionEpoch.isEmpty()
                || latchedSessionEpoch.equals("0")
                || resumeHandle.isEmpty()
                || !sessionState.compareAndSet(
                        SessionState.RESUMABLE_SUSPENDED, SessionState.RESUME_REQUESTED)) {
            return false;
        }
        started.set(true);
        stateSink.accept("resuming", "explicit_local_action", 1);
        try {
            executor.execute(() -> runBoundedAttempts(true));
            return true;
        } catch (RejectedExecutionException error) {
            started.set(false);
            sessionState.compareAndSet(
                    SessionState.RESUME_REQUESTED, SessionState.RESUMABLE_SUSPENDED);
            stateSink.accept("suspended", "resume_executor_unavailable", 0);
            return false;
        }
    }

    private void narrowSessionSynchronously(String reason) {
        // Hardware stop and socket abort are local, synchronous narrowing operations. No server
        // write or acknowledgement is on this path, and an in-flight utterance is abandoned.
        if (captureDriver != null) {
            captureDriver.stop(reason);
        }
        runtime.latch(reason);
        abortSocket(socket.getAndSet(null));
        output = null;
        synchronized (sendLock) {
            sendSequences.clear();
        }
    }

    void sendActualBoundsAck(
            String sessionEpoch,
            String leaseId,
            String revision,
            String documentHash,
            String surfaceId,
            float widthMeters,
            float heightMeters) {
        if (stoppedPermanently.get() || sessionState.get() != SessionState.ACTIVE) {
            return;
        }
        try {
            writeExecutor.execute(() -> sendActualBoundsAckOnWriter(
                    sessionEpoch,
                    leaseId,
                    revision,
                    documentHash,
                    surfaceId,
                    widthMeters,
                    heightMeters));
        } catch (RejectedExecutionException ignored) {
            // A concurrent local stop owns teardown; it never waits for this receipt.
        }
    }

    void sendSpatialAdmissionReceipt(String sessionEpoch, String leaseRef, String documentId, String documentRevision, String documentSha256, String profileId, String profileSha256, String outcome, JSONObject extra) {
        try {
            writeExecutor.execute(() -> {
                try {
                    JSONObject common = QuestSurfaceProtocol.commonSpatialIdentity(sessionEpoch, leaseRef, documentId, documentRevision, documentSha256, profileId, profileSha256);
                    JSONObject payload = QuestSurfaceProtocol.spatialAdmissionReceipt(common, outcome, extra);
                    send("SPATIAL_ADMISSION_RECEIPT", sessionEpoch, 0, leaseRef, payload);
                } catch (Exception ignored) {}
            });
        } catch (RejectedExecutionException ignored) {}
    }

    void sendSpatialDisplayReceipt(String sessionEpoch, String leaseRef, String documentId, String documentRevision, String documentSha256, String profileId, String profileSha256, long generation) {
        try {
            writeExecutor.execute(() -> {
                try {
                    JSONObject common = QuestSurfaceProtocol.commonSpatialIdentity(sessionEpoch, leaseRef, documentId, documentRevision, documentSha256, profileId, profileSha256);
                    JSONObject payload = QuestSurfaceProtocol.spatialDisplayReceipt(common, generation);
                    send("SPATIAL_DISPLAY_RECEIPT", sessionEpoch, 0, leaseRef, payload);
                } catch (Exception ignored) {}
            });
        } catch (RejectedExecutionException ignored) {}
    }

    void sendSpatialRollbackReceipt(String sessionEpoch, String leaseRef, String documentId, String documentRevision, String documentSha256, String profileId, String profileSha256, long failedGeneration, Long restoredGeneration, String target, String reason) {
        try {
            writeExecutor.execute(() -> {
                try {
                    JSONObject common = QuestSurfaceProtocol.commonSpatialIdentity(sessionEpoch, leaseRef, documentId, documentRevision, documentSha256, profileId, profileSha256);
                    JSONObject payload = QuestSurfaceProtocol.spatialRollbackReceipt(common, failedGeneration, restoredGeneration, target, reason);
                    send("SPATIAL_ROLLBACK_RECEIPT", sessionEpoch, 0, leaseRef, payload);
                } catch (Exception ignored) {}
            });
        } catch (RejectedExecutionException ignored) {}
    }

    private void sendActualBoundsAckOnWriter(
            String sessionEpoch,
            String leaseId,
            String revision,
            String documentHash,
            String surfaceId,
            float widthMeters,
            float heightMeters) {
        if (stoppedPermanently.get() || sessionState.get() != SessionState.ACTIVE) {
            return;
        }
        QuestSurfaceProtocol.Lease lease = runtime.panelLease();
        QuestSurfaceProtocol.SurfaceSnapshot snapshot = runtime.pendingSnapshot();
        if (lease == null || snapshot == null
                || !lease.sessionEpoch.toString().equals(sessionEpoch)
                || !lease.leaseId.equals(leaseId)
                || !snapshot.revision.toString().equals(revision)
                || !snapshot.documentHash.equals(documentHash)
                || !snapshot.surfaceId.equals(surfaceId)
                || !Float.isFinite(widthMeters)
                || !Float.isFinite(heightMeters)
                || Float.compare(widthMeters, snapshot.bounds.width) != 0
                || Float.compare(heightMeters, snapshot.bounds.height) != 0
                || SystemClock.elapsedRealtime() >= snapshot.deadlineElapsedMs) {
            return;
        }
        try {
            JSONObject payload = QuestSurfaceProtocol.actualBoundsAck(
                    new QuestSurfaceProtocol.SurfaceSnapshot(
                            snapshot.revision,
                            snapshot.documentHash,
                            snapshot.surfaceId,
                            snapshot.text,
                            snapshot.answerId,
                            snapshot.utteranceId,
                            snapshot.pose,
                            new QuestSurfaceProtocol.Bounds(widthMeters, heightMeters),
                            snapshot.deadlineElapsedMs),
                    true);
            send("ACTUAL_BOUNDS_ACK", lease.sessionEpoch.toString(), 0, lease.leaseId, payload);
            runtime.clearPendingSnapshot();
        } catch (QuestSurfaceProtocol.ProtocolException | IOException error) {
            closeQuietly(socket.getAndSet(null));
        }
    }

    private void runBoundedAttempts(boolean resumeAttempt) {
        int maxAttempts = resumeAttempt ? RESUME_MAX_ATTEMPTS : MAX_ATTEMPTS;
        SessionState expectedState = resumeAttempt
                ? SessionState.RESUME_REQUESTED
                : SessionState.CONNECTING;
        for (int attempt = 1;
                attempt <= maxAttempts
                        && !stoppedPermanently.get()
                        && sessionState.get() == expectedState;
                attempt++) {
            stateSink.accept(resumeAttempt ? "resuming" : "connecting", "attempt", attempt);
            try {
                runSession(attempt, resumeAttempt);
                if (sessionState.get() == SessionState.ACTIVE) {
                    terminateAfterTransportLoss(
                            new IOException("transport_closed"), attempt);
                    return;
                }
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                return;
            } catch (Exception error) {
                SessionState observed = sessionState.get();
                if (observed == SessionState.RESUMABLE_SUSPENDING
                        || observed == SessionState.RESUMABLE_SUSPENDED
                        || observed == SessionState.TERMINAL
                        || stoppedPermanently.get()) {
                    return;
                }
                if (observed == SessionState.ACTIVE) {
                    terminateAfterTransportLoss(error, attempt);
                    return;
                }
                if (observed == expectedState) {
                    if (!runtime.sessionEpoch().isEmpty()) {
                        runtime.latch(boundedCode(error.getMessage()));
                    }
                    logTransportFailure(attempt, error);
                    stateSink.accept(
                            resumeAttempt ? "resuming" : "offline",
                            boundedCode(error.getMessage()),
                            attempt);
                }
            } finally {
                closeQuietly(socket.getAndSet(null));
                output = null;
                if (!runtime.sessionEpoch().isEmpty()) {
                    runtime.latch("disconnect");
                }
                synchronized (sendLock) {
                    sendSequences.clear();
                }
            }
            if (!stoppedPermanently.get()
                    && sessionState.get() == expectedState
                    && attempt < maxAttempts) {
                try {
                    long maxBackoff = resumeAttempt ? RESUME_MAX_BACKOFF_MS : MAX_BACKOFF_MS;
                    Thread.sleep(Math.min(maxBackoff, 250L << Math.min(attempt - 1, 5)));
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }
        if (!stoppedPermanently.get()
                && sessionState.compareAndSet(
                        expectedState,
                        resumeAttempt
                                ? SessionState.RESUMABLE_SUSPENDED
                                : SessionState.TERMINAL)) {
            started.set(false);
            stateSink.accept(
                    resumeAttempt ? "suspended" : "offline",
                    "retry_budget_exhausted",
                    maxAttempts);
            if (!resumeAttempt) {
                stoppedPermanently.set(true);
                writeExecutor.shutdownNow();
                executor.shutdown();
            }
        }
    }

    private void runSession(int attempt, boolean resumeAttempt) throws Exception {
        SSLContext context = createSslContext();
        SSLSocket connected = (SSLSocket) context.getSocketFactory().createSocket();
        socket.set(connected);
        SSLParameters parameters = connected.getSSLParameters();
        parameters.setEndpointIdentificationAlgorithm("HTTPS");
        parameters.setProtocols(new String[] {"TLSv1.3"});
        connected.setSSLParameters(parameters);
        connected.connect(
                new InetSocketAddress(host, port),
                resumeAttempt ? RESUME_CONNECT_TIMEOUT_MS : CONNECT_TIMEOUT_MS);
        connected.setSoTimeout(resumeAttempt ? RESUME_READ_TIMEOUT_MS : READ_TIMEOUT_MS);
        connected.startHandshake();
        output = connected.getOutputStream();

        String originalLatchedEpoch = latchedSessionEpoch;
        String requestedResumeHandle = resumeHandle;
        JSONObject hello;
        try {
            hello = QuestSurfaceProtocol.helloPayload(
                    resumeAttempt ? requestedResumeHandle : null,
                    QuestSurfaceProtocol.defaultSpatialProfiles());
        } catch (QuestSurfaceProtocol.ProtocolException e) {
            hello = QuestSurfaceProtocol.helloPayload(resumeAttempt ? requestedResumeHandle : null);
        }
        if (resumeAttempt) {
            if (originalLatchedEpoch.isEmpty()
                    || originalLatchedEpoch.equals("0")
                    || requestedResumeHandle.isEmpty()) {
                throw new IOException("resume_context_missing");
            }
        }
        send("HELLO", "0", 0, "", hello);

        BoundedLineReader reader = new BoundedLineReader(connected.getInputStream());
        QuestSurfaceProtocol.Frame helloAck = receive(reader);
        requireServerEnvelope(helloAck, "HELLO_ACK", null);
        QuestSurfaceProtocol.validateHelloAck(helloAck);
        // Bind negotiated spatial_profile hash for §4 document binding — additive, optional for v1a.
        String negotiatedSpatialProfileHash = null;
        if (helloAck.payload.has("spatial_profile")) {
            try {
                org.json.JSONObject wrapper = helloAck.payload.getJSONObject("spatial_profile");
                negotiatedSpatialProfileHash = wrapper.optString("profile_sha256", null);
            } catch (Exception ignored) {}
        }
        if (resumeAttempt) {
            if (helloAck.sessionEpoch.toString().equals(originalLatchedEpoch)) {
                throw new IOException("resume_fresh_epoch_required");
            }
        }

        // G: optional LEASE_MANIFEST bootstrap (v1b) before compatibility LEASE
        QuestSurfaceProtocol.Frame firstLeaseFrame = receive(reader);
        QuestSurfaceProtocol.Frame leaseFrame;
        QuestSurfaceProtocol.Manifest manifest = null;
        if (firstLeaseFrame.type.equals("LEASE_MANIFEST")) {
            requireServerEnvelope(firstLeaseFrame, "LEASE_MANIFEST", helloAck.sessionEpoch);
            manifest = QuestSurfaceProtocol.validateManifest(firstLeaseFrame, helloAck.sessionEpoch, SystemClock.elapsedRealtime());
            leaseFrame = receive(reader);
            requireServerEnvelope(leaseFrame, "LEASE", helloAck.sessionEpoch);
        } else {
            leaseFrame = firstLeaseFrame;
            requireServerEnvelope(leaseFrame, "LEASE", helloAck.sessionEpoch);
        }
        QuestSurfaceProtocol.Lease lease = QuestSurfaceProtocol.validateLease(
                leaseFrame, helloAck.sessionEpoch, SystemClock.elapsedRealtime());
        if (resumeAttempt && (manifest == null
                || !requestedResumeHandle.equals(manifest.resumeHandle))) {
            throw new IOException("resume_handle_mismatch");
        }
        runtime.configureSession(
                helloAck.sessionEpoch, manifest, lease, SystemClock.elapsedRealtime());

        QuestSurfaceProtocol.Frame snapshotFrame = receive(reader);
        requireServerEnvelope(snapshotFrame, "PANEL_SNAPSHOT", helloAck.sessionEpoch);
        QuestSurfaceProtocol.SurfaceSnapshot snapshot = runtime.acceptPanel(
                snapshotFrame, SystemClock.elapsedRealtime());
        if (resumeAttempt) {
            String freshEpoch = helloAck.sessionEpoch.toString();
            if (!runtime.isLatched() || !runtime.deliberateResume(freshEpoch, true)) {
                throw new IOException("resume_java_latch_rejected");
            }
            latchedSessionEpoch = freshEpoch;
            boolean nativeCompleted;
            try {
                nativeCompleted = resumeSink.complete(freshEpoch);
            } catch (Throwable ignored) {
                nativeCompleted = false;
            }
            if (!nativeCompleted) {
                runtime.latch("resume_native_rejected");
                started.set(false);
                sessionState.set(SessionState.RESUMABLE_SUSPENDED);
                stateSink.accept("suspended", "resume_native_rejected", attempt);
                throw new IOException("resume_native_rejected");
            }
            if (!sessionState.compareAndSet(
                    SessionState.RESUME_REQUESTED, SessionState.ACTIVE)) {
                runtime.latch("resume_state_changed");
                throw new IOException("resume_state_changed");
            }
            // v2.1: reopen capture gate only after accepted fresh-manifest deliberate resume (instance gate)
            captureGate.set(true);
        } else if (!sessionState.compareAndSet(SessionState.CONNECTING, SessionState.ACTIVE)) {
            runtime.latch("session_state_changed");
            throw new IOException("session_state_changed");
        }
        stateSink.accept("leased", "panel_ready", attempt);
        deliverSnapshot(snapshot);

        // Armed episode with a mic leaf -> start the continuous capture driver. Idempotent: the gate
        // governs each frame, and the driver thread exits whenever eligibility drops (mic released).
        if (captureDriver != null && runtime.micLease() != null) {
            captureDriver.start();
        }

        // Bootstrap reads are bounded. Once leased, each read is bounded by the locally derived
        // lease deadline; local stop closes the socket to unblock it immediately.
        while (!stoppedPermanently.get() && sessionState.get() == SessionState.ACTIVE) {
            long remainingMs = runtime.deadlineElapsedMs() - SystemClock.elapsedRealtime();
            if (remainingMs <= 0) {
                throw new IOException("lease_expired");
            }
            connected.setSoTimeout((int) Math.min(Integer.MAX_VALUE, Math.max(1, remainingMs)));
            QuestSurfaceProtocol.Frame frame;
            try {
                frame = receive(reader);
            } catch (SocketTimeoutException error) {
                throw new IOException("lease_expired", error);
            }
            requireServerEnvelope(frame, frame.type, helloAck.sessionEpoch);
            if (frame.type.equals("TEARDOWN_ACK")) {
                return;
            }
            if (frame.type.equals("ERROR")) {
                String code = QuestSurfaceProtocol.validateError(frame);
                if (frame.streamId != 0) {
                    runtime.rejectCaptureStream(frame.streamId);
                    logAudioStreamFailure(frame.streamId, code);
                    continue;
                }
                runtime.latch(code);
                throw new IOException(code);
            }
            if (frame.type.equals("LEASE_RENEWAL")) {
                try {
                    QuestSurfaceProtocol.Manifest renewed = runtime.acceptLeaseRenewal(
                            frame, SystemClock.elapsedRealtime());
                    send(
                            "LEASE_RENEWAL_ACK",
                            renewed.sessionEpoch.toString(),
                            0,
                            "",
                            QuestSurfaceProtocol.leaseRenewalAckPayload(renewed.generation));
                } catch (QuestSurfaceProtocol.ProtocolException error) {
                    // A malformed, stale, or late renewal has no authority effect. Keep the
                    // prior manifest and its original deadline; normal expiry remains terminal.
                    logAudioStreamFailure(0, error.code);
                }
                continue;
            }
            if (frame.type.equals("PANEL_SNAPSHOT")) {
                QuestSurfaceProtocol.SurfaceSnapshot next = runtime.acceptPanel(
                        frame, SystemClock.elapsedRealtime());
                deliverSnapshot(next);
                continue;
            }
            if (frame.type.equals("AUDIO_CHUNK")) {
                try {
                    runtime.acceptPlayback(frame, SystemClock.elapsedRealtime());
                } catch (QuestSurfaceProtocol.ProtocolException error) {
                    runtime.rejectPlaybackStream(frame.streamId);
                    logAudioStreamFailure(frame.streamId, error.code);
                } catch (QuestSurfaceAudioEngine.EngineException error) {
                    runtime.rejectPlaybackStream(frame.streamId);
                    logAudioStreamFailure(frame.streamId, error.code);
                }
                continue;
            }
            if (frame.type.equals("ANSWER_END")) {
                try {
                    runtime.acceptAnswerEnd(frame, SystemClock.elapsedRealtime());
                    // H narrowed: consumer drains retained frames in order then stops hardware
                    runtime.consumePlaybackQueue(frame.streamId, frame.payload.getString("answer_id"));
                } catch (QuestSurfaceProtocol.ProtocolException error) {
                    // lease_expired should latch, not just stream reject
                    if ("lease_expired".equals(error.code)) {
                        runtime.latch(error.code);
                        throw new IOException(error.code, error);
                    }
                    runtime.rejectPlaybackStream(frame.streamId);
                    logAudioStreamFailure(frame.streamId, error.code);
                } catch (QuestSurfaceAudioEngine.EngineException error) {
                    if ("lease_expired".equals(error.code)) {
                        runtime.latch(error.code);
                        throw new IOException(error.code, error);
                    }
                    runtime.rejectPlaybackStream(frame.streamId);
                    logAudioStreamFailure(frame.streamId, error.code);
                }
                continue;
            }
            throw new IOException("unexpected_server_message");
        }
    }

    private void terminateAfterTransportLoss(Throwable error, int attempt) {
        if (!stoppedPermanently.compareAndSet(false, true)) {
            return;
        }
        sessionState.set(SessionState.TERMINAL);
        started.set(false);
        narrowSessionSynchronously(boundedCode(error == null ? null : error.getMessage()));
        logTransportFailure(attempt, error);
        stateSink.accept("offline", boundedCode(error == null ? null : error.getMessage()), attempt);
        writeExecutor.shutdownNow();
        executor.shutdown();
    }

    private void deliverSnapshot(QuestSurfaceProtocol.SurfaceSnapshot snapshot) {
        QuestSurfaceProtocol.Lease lease = runtime.panelLease();
        if (lease == null) {
            return;
        }
        snapshotSink.accept(
                lease.sessionEpoch.toString(),
                lease.leaseId,
                snapshot.revision.toString(),
                snapshot.documentHash,
                snapshot.surfaceId,
                snapshot.text,
                snapshot.pose.x,
                snapshot.pose.y,
                snapshot.pose.z,
                snapshot.pose.qx,
                snapshot.pose.qy,
                snapshot.pose.qz,
                snapshot.pose.qw,
                snapshot.bounds.width,
                snapshot.bounds.height,
                snapshot.deadlineElapsedMs);
    }

    private QuestSurfaceProtocol.Frame receive(BoundedLineReader reader) throws Exception {
        QuestSurfaceProtocol.Frame frame = QuestSurfaceProtocol.decodeFrame(reader.readLine());
        runtime.acceptDownlinkEnvelope(frame, null);
        return frame;
    }

    private static void requireServerEnvelope(
            QuestSurfaceProtocol.Frame frame,
            String expectedType,
            BigInteger expectedEpoch) throws IOException {
        if (!frame.type.equals(expectedType)) {
            throw new IOException("message_type_unexpected");
        }
        if (expectedEpoch != null && !frame.sessionEpoch.equals(expectedEpoch)) {
            throw new IOException("session_epoch_mismatch");
        }
    }

    void sendUtteranceStart(long streamId, String utteranceId) throws Exception {
        long now = SystemClock.elapsedRealtime();
        JSONObject payload = runtime.startCapture(streamId, utteranceId, now);
        QuestSurfaceProtocol.Lease micLease = runtime.micLease();
        try {
            send("UTTERANCE_START", runtime.sessionEpoch(), streamId, micLease.leaseId, payload);
        } catch (Exception error) {
            runtime.rejectCaptureStream(streamId);
            throw error;
        }
    }

    void sendAudioChunk(long streamId, String utteranceId, byte[] pcm) throws Exception {
        long now = SystemClock.elapsedRealtime();
        // H reshaped: offer to bounded queue governs I/O
        runtime.pushCapture(streamId, utteranceId, pcm, now);
        // pump one retained frame (drop-oldest already applied)
        byte[] toSend = runtime.pollCaptureChunkForTransport(streamId);
        if (toSend == null) return;
        JSONObject payload = QuestSurfaceProtocol.audioChunkPayload(utteranceId, "", toSend, 1);
        QuestSurfaceProtocol.Lease micLease = runtime.micLease();
        try {
            send("AUDIO_CHUNK", runtime.sessionEpoch(), streamId, micLease.leaseId, payload);
        } catch (Exception error) {
            runtime.rejectCaptureStream(streamId);
            throw error;
        }
    }

    // H reshaped: pump all retained capture frames (burst before pumping)
    void pumpCaptureQueue(long streamId, String utteranceId) throws Exception {
        byte[] toSend;
        while ((toSend = runtime.pollCaptureChunkForTransport(streamId)) != null) {
            JSONObject payload = QuestSurfaceProtocol.audioChunkPayload(utteranceId, "", toSend, 1);
            QuestSurfaceProtocol.Lease micLease = runtime.micLease();
            send("AUDIO_CHUNK", runtime.sessionEpoch(), streamId, micLease.leaseId, payload);
        }
    }

    void sendUtteranceEnd(long streamId, String utteranceId) throws Exception {
        long now = SystemClock.elapsedRealtime();
        JSONObject payload = runtime.endCapture(streamId, utteranceId, now);
        QuestSurfaceProtocol.Lease micLease = runtime.micLease();
        send("UTTERANCE_END", runtime.sessionEpoch(), streamId, micLease.leaseId, payload);
    }

    void sendCancel(long streamId, String utteranceId, String reason) throws Exception {
        long now = SystemClock.elapsedRealtime();
        JSONObject payload = runtime.cancelCapture(streamId, utteranceId, reason, now);
        QuestSurfaceProtocol.Lease micLease = runtime.micLease();
        send("CANCEL", runtime.sessionEpoch(), streamId, micLease.leaseId, payload);
    }

    private void send(String type, String epoch, long streamId, String leaseRef, JSONObject payload)
            throws QuestSurfaceProtocol.ProtocolException, IOException {
        synchronized (sendLock) {
            OutputStream destination = output;
            if (destination == null) {
                throw new IOException("transport_unavailable");
            }
            long next = sendSequences.next(epoch, streamId, "uplink");
            String line = QuestSurfaceProtocol.encodeFrame(
                    type,
                    epoch,
                    streamId,
                    "uplink",
                    leaseRef,
                    next,
                    SystemClock.elapsedRealtimeNanos(),
                    payload);
            destination.write(line.getBytes(StandardCharsets.UTF_8));
            destination.flush();
        }
    }

    private SSLContext createSslContext() throws Exception {
        char[] identityPassword = CLIENT_IDENTITY_PASSWORD.toCharArray();
        KeyStore identity = KeyStore.getInstance("PKCS12");
        KeyManagerFactory keys;
        try {
            try (InputStream input = assets.open(CLIENT_IDENTITY_ASSET)) {
                identity.load(input, identityPassword);
            }
            keys = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
            keys.init(identity, identityPassword);
        } finally {
            Arrays.fill(identityPassword, '\0');
        }

        Certificate ca;
        try (InputStream input = assets.open(SERVER_CA_ASSET)) {
            ca = CertificateFactory.getInstance("X.509").generateCertificate(input);
        }
        KeyStore trust = KeyStore.getInstance(KeyStore.getDefaultType());
        trust.load(null);
        trust.setCertificateEntry("soma-quest-server-ca", ca);
        TrustManagerFactory trusts = TrustManagerFactory.getInstance(
                TrustManagerFactory.getDefaultAlgorithm());
        trusts.init(trust);

        SSLContext context = SSLContext.getInstance("TLSv1.3");
        context.init(keys.getKeyManagers(), trusts.getTrustManagers(), new SecureRandom());
        return context;
    }

    private static String boundedCode(String value) {
        String code = value == null ? "unknown" : value.replaceAll("[^a-zA-Z0-9_.-]", "_");
        return code.substring(0, Math.min(code.length(), 96));
    }

    static String diagnosticTopClass(Throwable error) {
        return boundedDiagnosticClass(error);
    }

    static String diagnosticRootClass(Throwable error) {
        return boundedDiagnosticClass(deepestCause(error));
    }

    static String diagnosticRootCode(Throwable error) {
        String code = boundedCode(deepestCause(error).getMessage());
        return code.isEmpty() ? "unspecified" : code;
    }

    private static void logTransportFailure(int attempt, Throwable error) {
        // Deliberately omit the throwable/stack: TLS objects, certificate subjects, filesystem
        // paths, and application content must not enter logcat. These bounded reason fields are
        // sufficient to distinguish socket reachability from trust/hostname handshake failure.
        Log.w(LOG_TAG,
                "attempt=" + attempt
                        + " top_class=" + diagnosticTopClass(error)
                        + " root_class=" + diagnosticRootClass(error)
                        + " root_code=" + diagnosticRootCode(error));
    }

    private static void logAudioStreamFailure(long streamId, String code) {
        // Stream-scoped audio rejection must not become a transport/UI state transition: the
        // native state sink clears panel content by design. Keep this bounded and content-free.
        Log.w(LOG_TAG,
                "audio_stream_error stream_id=" + streamId + " code=" + boundedCode(code));
    }

    private static Throwable deepestCause(Throwable error) {
        Throwable current = error == null ? new IllegalStateException("unknown") : error;
        for (int depth = 0; depth < 8; depth++) {
            Throwable next = current.getCause();
            if (next == null || next == current) {
                break;
            }
            current = next;
        }
        return current;
    }

    private static String boundedDiagnosticClass(Throwable error) {
        String name = error == null ? "Unknown" : error.getClass().getSimpleName();
        String bounded = boundedCode(name);
        return bounded.isEmpty() ? "Unknown" : bounded;
    }

    private static void closeQuietly(Closeable closeable) {
        if (closeable == null) {
            return;
        }
        try {
            closeable.close();
        } catch (IOException ignored) {
            // Local teardown remains best-effort and bounded.
        }
    }

    private static void abortSocket(SSLSocket active) {
        if (active == null) {
            return;
        }
        try {
            active.setSoLinger(true, 0);
        } catch (IOException ignored) {
            // Close still narrows the provider session if linger cannot be configured.
        }
        closeQuietly(active);
    }

    static final class BoundedLineReader {
        private final InputStream input;

        BoundedLineReader(InputStream input) {
            this.input = input;
        }

        String readLine() throws IOException {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            for (;;) {
                int value = input.read();
                if (value < 0) {
                    throw new IOException("transport_closed");
                }
                if (value == '\n') {
                    break;
                }
                if (bytes.size() >= QuestSurfaceProtocol.MAX_FRAME_BYTES) {
                    throw new IOException("frame_too_large");
                }
                bytes.write(value);
            }
            byte[] line = bytes.toByteArray();
            int length = line.length;
            if (length > 0 && line[length - 1] == '\r') {
                length--;
            }
            if (length == 0) {
                throw new IOException("empty_frame");
            }
            try {
                return QuestSurfaceProtocol.decodeUtf8(
                        length == line.length ? line : Arrays.copyOf(line, length),
                        "frame_not_utf8");
            } catch (QuestSurfaceProtocol.ProtocolException error) {
                throw new IOException(error.code, error);
            }
        }
    }
}

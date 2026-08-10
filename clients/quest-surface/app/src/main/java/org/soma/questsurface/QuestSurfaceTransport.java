package org.soma.questsurface;

import android.content.res.AssetManager;
import android.os.SystemClock;
import android.util.Log;

import org.json.JSONArray;
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

    private final AssetManager assets;
    private final String host;
    private final int port;
    private final StateSink stateSink;
    private final SnapshotSink snapshotSink;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final ExecutorService writeExecutor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean started = new AtomicBoolean(false);
    private final AtomicBoolean stoppedPermanently = new AtomicBoolean(false);
    private final AtomicReference<SSLSocket> socket = new AtomicReference<>();
    private final Object sendLock = new Object();
    private final QuestSurfaceSequenceTracker sendSequences =
            new QuestSurfaceSequenceTracker();
    private final QuestSurfaceRuntime runtime;

    private volatile OutputStream output;

    QuestSurfaceTransport(
            AssetManager assets,
            String host,
            int port,
            StateSink stateSink,
            SnapshotSink snapshotSink) {
        this(assets, host, port, stateSink, snapshotSink,
                new QuestSurfaceRuntime(new QuestSurfaceAudioEngine()));
    }

    QuestSurfaceTransport(
            AssetManager assets,
            String host,
            int port,
            StateSink stateSink,
            SnapshotSink snapshotSink,
            QuestSurfaceRuntime runtime) {
        this.assets = assets;
        this.host = host;
        this.port = port;
        this.stateSink = stateSink;
        this.snapshotSink = snapshotSink;
        this.runtime = runtime;
    }

    boolean startIfEligible() {
        if (stoppedPermanently.get()) {
            return false;
        }
        if (started.compareAndSet(false, true)) {
            executor.execute(this::runBoundedAttempts);
        }
        return true;
    }

    void stopPermanently(String reason) {
        if (!stoppedPermanently.compareAndSet(false, true)) {
            return;
        }
        // Hardware stop and socket close are both local, synchronous narrowing operations. Neither
        // waits for a workstation write or acknowledgement.
        runtime.latch(reason == null ? "local_stop" : reason);
        abortSocket(socket.getAndSet(null));
        output = null;
        stateSink.accept("suspended", boundedCode(reason), 0);
        executor.shutdownNow();
        writeExecutor.shutdownNow();
    }

    void sendActualBoundsAck(
            String sessionEpoch,
            String leaseId,
            String revision,
            String documentHash,
            String surfaceId,
            float widthMeters,
            float heightMeters) {
        if (stoppedPermanently.get()) {
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

    private void sendActualBoundsAckOnWriter(
            String sessionEpoch,
            String leaseId,
            String revision,
            String documentHash,
            String surfaceId,
            float widthMeters,
            float heightMeters) {
        if (stoppedPermanently.get()) {
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

    private void runBoundedAttempts() {
        for (int attempt = 1; attempt <= MAX_ATTEMPTS && !stoppedPermanently.get(); attempt++) {
            stateSink.accept("connecting", "attempt", attempt);
            try {
                runSession(attempt);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                return;
            } catch (Exception error) {
                if (!stoppedPermanently.get()) {
                    runtime.latch(boundedCode(error.getMessage()));
                    logTransportFailure(attempt, error);
                    stateSink.accept("offline", boundedCode(error.getMessage()), attempt);
                }
            } finally {
                closeQuietly(socket.getAndSet(null));
                output = null;
                runtime.latch("disconnect");
                synchronized (sendLock) {
                    sendSequences.clear();
                }
            }
            if (!stoppedPermanently.get() && attempt < MAX_ATTEMPTS) {
                try {
                    Thread.sleep(Math.min(MAX_BACKOFF_MS, 250L << Math.min(attempt - 1, 5)));
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }
        if (!stoppedPermanently.get()) {
            stateSink.accept("offline", "retry_budget_exhausted", MAX_ATTEMPTS);
        }
    }

    private void runSession(int attempt) throws Exception {
        SSLContext context = createSslContext();
        SSLSocket connected = (SSLSocket) context.getSocketFactory().createSocket();
        socket.set(connected);
        SSLParameters parameters = connected.getSSLParameters();
        parameters.setEndpointIdentificationAlgorithm("HTTPS");
        parameters.setProtocols(new String[] {"TLSv1.3"});
        connected.setSSLParameters(parameters);
        connected.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT_MS);
        connected.setSoTimeout(READ_TIMEOUT_MS);
        connected.startHandshake();
        output = connected.getOutputStream();

        JSONObject hello = new JSONObject();
        hello.put("supported_versions", new JSONArray().put(QuestSurfaceProtocol.VERSION));
        hello.put("client", "soma-quest-surface-v1a");
        send("HELLO", "0", 0, "", hello);

        BoundedLineReader reader = new BoundedLineReader(connected.getInputStream());
        QuestSurfaceProtocol.Frame helloAck = receive(reader);
        requireServerEnvelope(helloAck, "HELLO_ACK", null);
        QuestSurfaceProtocol.validateHelloAck(helloAck);

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
        runtime.configureSession(
                helloAck.sessionEpoch, manifest, lease, SystemClock.elapsedRealtime());

        QuestSurfaceProtocol.Frame snapshotFrame = receive(reader);
        requireServerEnvelope(snapshotFrame, "PANEL_SNAPSHOT", helloAck.sessionEpoch);
        QuestSurfaceProtocol.SurfaceSnapshot snapshot = runtime.acceptPanel(
                snapshotFrame, SystemClock.elapsedRealtime());
        stateSink.accept("leased", "panel_ready", attempt);
        deliverSnapshot(snapshot);

        // Bootstrap reads are bounded. Once leased, each read is bounded by the locally derived
        // lease deadline; local stop closes the socket to unblock it immediately.
        while (!stoppedPermanently.get()) {
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
            throw new IOException("unexpected_server_message");
        }
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
        JSONObject payload = runtime.pushCapture(streamId, utteranceId, pcm, now);
        QuestSurfaceProtocol.Lease micLease = runtime.micLease();
        try {
            send("AUDIO_CHUNK", runtime.sessionEpoch(), streamId, micLease.leaseId, payload);
        } catch (Exception error) {
            runtime.rejectCaptureStream(streamId);
            throw error;
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

    String currentSessionEpoch() {
        return runtime.sessionEpoch();
    }

    boolean deliberateAudioResumeFromLocalAction(String freshEpoch) {
        return freshEpoch != null
                && freshEpoch.equals(runtime.sessionEpoch())
                && runtime.deliberateResume(freshEpoch, true);
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

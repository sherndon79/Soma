package org.soma.questsurface;

import android.app.NativeActivity;
import android.os.Bundle;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/** Java boundary around the NativeActivity and its instance-owned transport control lane. */
public final class QuestSurfaceActivity extends NativeActivity {
    static {
        System.loadLibrary("somaquestsurface");
    }

    private static final int CONTROL_RESULT_START = 1;
    private static final int CONTROL_RESULT_RESUME = 2;
    private static final AtomicLong NEXT_ACTIVITY_GENERATION = new AtomicLong(0);

    private final long activityGeneration = NEXT_ACTIVITY_GENERATION.incrementAndGet();
    private final AtomicLong commandSequence = new AtomicLong(0);
    private final AtomicBoolean captureAllowed = new AtomicBoolean(true);
    private final AtomicBoolean latestPttHeld = new AtomicBoolean(false);

    private volatile QuestSurfaceControlLane controlLane;
    private volatile QuestSurfaceTransport transport;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        captureAllowed.set(true);
        latestPttHeld.set(false);
        controlLane = new QuestSurfaceControlLane(
                activityGeneration, 30, this::onControlResult);
        transport = new QuestSurfaceTransport(
                getAssets(),
                BuildConfig.QUEST_SERVER_HOST,
                BuildConfig.QUEST_SERVER_PORT,
                this::onTransportState,
                this::onPanelSnapshot,
                this::completeNativeResume,
                captureAllowed,
                activityGeneration);
    }

    @Override
    protected void onDestroy() {
        publishTerminal("activity_destroyed");
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        publishTerminal("local_stop");
        finishAndRemoveTask();
    }

    private void publishTerminal(String reason) {
        captureAllowed.set(false);
        latestPttHeld.set(false);
        QuestSurfaceTransport target = transport;
        if (target != null) target.forcePttReleased();
        QuestSurfaceControlLane lane = controlLane;
        if (lane == null || target == null) return;
        long sequence = commandSequence.incrementAndGet();
        lane.offer(new QuestSurfaceControlLane.Command(
                QuestSurfaceControlLane.Kind.TERMINAL,
                activityGeneration,
                sequence,
                () -> {
                    target.stopPermanently(reason);
                    return true;
                },
                false));
    }

    /** Read once by the native Activity instance to bind later callbacks and results. */
    public long activityGenerationFromNative() {
        return activityGeneration;
    }

    /** Bounded admission only; heavy transport start runs on this Activity's control worker. */
    public boolean enqueueStartTransport(long sequence) {
        QuestSurfaceTransport target = transport;
        QuestSurfaceControlLane lane = controlLane;
        return target != null
                && lane != null
                && lane.offer(new QuestSurfaceControlLane.Command(
                        QuestSurfaceControlLane.Kind.START,
                        activityGeneration,
                        sequence,
                        target::startIfEligible,
                        true));
    }

    /** Immediately narrows local authority, then publishes the heavy resumable suspend. */
    public void enqueueSuspendResumable(long sequence, String reason) {
        captureAllowed.set(false);
        latestPttHeld.set(false);
        QuestSurfaceTransport target = transport;
        if (target != null) target.forcePttReleased();
        QuestSurfaceControlLane lane = controlLane;
        if (target == null || lane == null) return;
        String boundedReason = reason == null ? "local_suspend" : reason;
        lane.offer(new QuestSurfaceControlLane.Command(
                QuestSurfaceControlLane.Kind.SUSPEND,
                activityGeneration,
                sequence,
                () -> target.suspendResumable(boundedReason),
                false));
    }

    /** Immediately narrows local authority, then publishes a durable terminal command. */
    public void enqueueStopPermanently(long sequence, String reason) {
        captureAllowed.set(false);
        latestPttHeld.set(false);
        QuestSurfaceTransport target = transport;
        if (target != null) target.forcePttReleased();
        QuestSurfaceControlLane lane = controlLane;
        if (target == null || lane == null) return;
        String boundedReason = reason == null ? "local_stop" : reason;
        lane.offer(new QuestSurfaceControlLane.Command(
                QuestSurfaceControlLane.Kind.TERMINAL,
                activityGeneration,
                sequence,
                () -> {
                    target.stopPermanently(boundedReason);
                    return true;
                },
                false));
    }

    /** Returns bounded admission; the eventual Java transition result is generation-bound. */
    public boolean enqueueResumeTransport(long sequence) {
        QuestSurfaceTransport target = transport;
        QuestSurfaceControlLane lane = controlLane;
        return target != null
                && lane != null
                && lane.offer(new QuestSurfaceControlLane.Command(
                        QuestSurfaceControlLane.Kind.RESUME,
                        activityGeneration,
                        sequence,
                        target::resumeFromExplicitLocalAction,
                        true));
    }

    /** PTT is a direct instance-bound level; false bypasses transport session state. */
    public void setPttHeldFromNative(boolean held) {
        latestPttHeld.set(held);
        QuestSurfaceTransport target = transport;
        if (target == null) return;
        if (!held || !captureAllowed.get()) {
            target.forcePttReleased();
        } else {
            target.setPttHeld(true);
        }
    }

    public boolean enqueueToggleMode(long sequence) {
        QuestSurfaceTransport target = transport;
        QuestSurfaceControlLane lane = controlLane;
        return target != null
                && lane != null
                && lane.offer(new QuestSurfaceControlLane.Command(
                        QuestSurfaceControlLane.Kind.TOGGLE,
                        activityGeneration,
                        sequence,
                        () -> {
                            target.toggleCaptureMode();
                            return true;
                        },
                        false));
    }

    public void enqueueBoundsAck(
            long sequence,
            String sessionEpoch,
            String leaseId,
            String revision,
            String documentHash,
            String surfaceId,
            float widthMeters,
            float heightMeters) {
        QuestSurfaceTransport target = transport;
        QuestSurfaceControlLane lane = controlLane;
        if (target == null || lane == null) return;
        lane.offer(new QuestSurfaceControlLane.Command(
                QuestSurfaceControlLane.Kind.ACK,
                activityGeneration,
                sequence,
                () -> {
                    target.sendActualBoundsAck(
                            sessionEpoch,
                            leaseId,
                            revision,
                            documentHash,
                            surfaceId,
                            widthMeters,
                            heightMeters);
                    return true;
                },
                false));
    }

    private void onControlResult(
            long generation,
            long sequence,
            QuestSurfaceControlLane.Kind kind,
            boolean accepted) {
        int nativeKind;
        if (kind == QuestSurfaceControlLane.Kind.START) {
            nativeKind = CONTROL_RESULT_START;
        } else if (kind == QuestSurfaceControlLane.Kind.RESUME) {
            nativeKind = CONTROL_RESULT_RESUME;
        } else {
            return;
        }
        try {
            nativeOnControlResult(generation, sequence, nativeKind, accepted);
        } catch (Throwable ignored) {
            // Native teardown may already own this old Activity generation.
        }
    }

    private void onTransportState(String state, String code, int attempt) {
        nativeOnTransportState(activityGeneration, state, code, attempt);
    }

    private void onPanelSnapshot(
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
            long deadlineElapsedMs) {
        nativeOnPanelSnapshot(
                activityGeneration,
                sessionEpoch,
                leaseId,
                revision,
                documentHash,
                surfaceId,
                text,
                x,
                y,
                z,
                qx,
                qy,
                qz,
                qw,
                widthMeters,
                heightMeters,
                deadlineElapsedMs);
    }

    private boolean completeNativeResume(String freshEpoch) {
        try {
            return nativeCompleteDeliberateResume(activityGeneration, freshEpoch);
        } catch (Throwable ignored) {
            return false;
        }
    }

    private static native void nativeOnControlResult(
            long activityGeneration, long sequence, int kind, boolean accepted);

    private static native void nativeOnTransportState(
            long activityGeneration, String state, String code, int attempt);

    private static native boolean nativeCompleteDeliberateResume(
            long activityGeneration, String freshEpoch);

    private static native void nativeOnPanelSnapshot(
            long activityGeneration,
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

    static native void nativeOnCaptureStatus(
            long activityGeneration, int mode, String state);
}

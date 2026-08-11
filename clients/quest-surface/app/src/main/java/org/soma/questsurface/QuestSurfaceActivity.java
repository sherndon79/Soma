package org.soma.questsurface;

import android.Manifest;
import android.app.NativeActivity;
import android.content.pm.PackageManager;
import android.os.Bundle;

import java.util.concurrent.atomic.AtomicReference;

/**
 * Small Java boundary around NativeActivity. OpenXR focus/presence, not Android creation,
 * starts transport. Once narrowed, this Activity instance cannot resume transport.
 */
public final class QuestSurfaceActivity extends NativeActivity {
    static {
        // NativeActivity loads its entry-point library for android_main, but Java-declared JNI
        // callbacks still need the library associated with this application class loader.
        System.loadLibrary("somaquestsurface");
    }

    private static final AtomicReference<QuestSurfaceActivity> CURRENT = new AtomicReference<>();

    private QuestSurfaceTransport transport;
    // Permission seam: injectable for JVM tests; default null means real gateway.
    private QuestSurfaceAudioPermission audioPermission;
    private QuestSurfaceAudioPermission.Gateway permissionGatewayForTest;

    /** Package-private test seam. */
    void setPermissionGatewayForTest(QuestSurfaceAudioPermission.Gateway gateway) {
        this.permissionGatewayForTest = gateway;
    }

    QuestSurfaceAudioPermission getAudioPermissionForTest() {
        return audioPermission;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        transport = new QuestSurfaceTransport(
                getAssets(),
                BuildConfig.QUEST_SERVER_HOST,
                BuildConfig.QUEST_SERVER_PORT,
                QuestSurfaceActivity::nativeOnTransportState,
                QuestSurfaceActivity::nativeOnPanelSnapshot);
        CURRENT.set(this);
        ensureRecordAudioPermission();
    }

    private QuestSurfaceAudioPermission.Gateway createRealGateway() {
        return new QuestSurfaceAudioPermission.Gateway() {
            @Override
            public boolean isRecordAudioGranted() {
                return checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                        == PackageManager.PERMISSION_GRANTED;
            }

            @Override
            public void requestRecordAudioPermission(int requestCode) {
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, requestCode);
            }
        };
    }

    private void ensureRecordAudioPermission() {
        QuestSurfaceAudioPermission.Gateway gateway =
                permissionGatewayForTest != null ? permissionGatewayForTest : createRealGateway();
        if (audioPermission == null) {
            audioPermission = new QuestSurfaceAudioPermission(gateway);
        }
        audioPermission.ensure();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (audioPermission != null) {
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            audioPermission.onRequestPermissionsResult(requestCode, granted);
        }
        // fail-closed on denial: no retry, transport continues; grant does NOT arm capture.
    }

    @Override
    protected void onDestroy() {
        CURRENT.compareAndSet(this, null);
        if (transport != null) {
            transport.stopPermanently("activity_destroyed");
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        QuestSurfaceTransport active = transport;
        if (active != null) {
            active.stopPermanently("local_stop");
        }
        finishAndRemoveTask();
    }

    /** Called by native code only after OpenXR is focused and user presence is affirmative. */
    public static boolean startTransportFromNative() {
        QuestSurfaceActivity activity = CURRENT.get();
        if (activity != null && activity.transport != null) {
            return activity.transport.startIfEligible();
        }
        return false;
    }

    /** Focus/presence loss is narrowing-only and latches until deliberate app relaunch. */
    public static void suspendTransportFromNative(String reason) {
        QuestSurfaceActivity activity = CURRENT.get();
        if (activity != null && activity.transport != null) {
            activity.transport.stopPermanently(reason == null ? "local_suspend" : reason);
        }
    }

    /**
     * Boundary for a future explicit local mute affordance. Merely regaining focus or presence
     * never calls this method. The current transport epoch must be fresh for both native and Java
     * latches, and Java remains fail-closed if the two layers ever disagree.
     */
    public static boolean deliberateAudioResumeFromLocalAction() {
        QuestSurfaceActivity activity = CURRENT.get();
        if (activity == null || activity.transport == null) {
            return false;
        }
        String freshEpoch = activity.transport.currentSessionEpoch();
        if (freshEpoch.isEmpty() || !nativeTryDeliberateMicResume(freshEpoch, true)) {
            return false;
        }
        return activity.transport.deliberateAudioResumeFromLocalAction(freshEpoch);
    }

    /** Sent only after native rendering actually applied the accepted panel and its clamped bounds. */
    public static void sendActualBoundsAckFromNative(
            String sessionEpoch,
            String leaseId,
            String revision,
            String documentHash,
            String surfaceId,
            float widthMeters,
            float heightMeters) {
        QuestSurfaceActivity activity = CURRENT.get();
        if (activity != null && activity.transport != null) {
            activity.transport.sendActualBoundsAck(
                    sessionEpoch,
                    leaseId,
                    revision,
                    documentHash,
                    surfaceId,
                    widthMeters,
                    heightMeters);
        }
    }

    private static native void nativeOnTransportState(String state, String code, int attempt);

    private static native boolean nativeTryDeliberateMicResume(
            String freshEpoch, boolean explicitIntent);

    private static native void nativeOnPanelSnapshot(
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

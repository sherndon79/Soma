package org.soma.questsurface;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;

/**
 * 2D launcher shim that obtains RECORD_AUDIO before starting the immersive
 * {@link QuestSurfaceActivity}. Requesting from an immersive NativeActivity
 * pulls the app out of its OpenXR session and kills it (destroy timeout);
 * this flat activity is safe for the permission dialog.
 *
 * <p>Flow (all still launch immersive; capture stays gated by OS + server episode):
 * <ul>
 *   <li>already-granted → launch immersive immediately, no request</li>
 *   <li>request → granted → launch on result</li>
 *   <li>request → denied → STILL launch immersive (panel/transport work, mic stays closed)</li>
 * </ul>
 * Grant does NOT arm capture.
 */
public final class QuestSurfacePermissionActivity extends Activity {

    interface Launcher {
        void launchImmersive();
    }

    private QuestSurfaceAudioPermission audioPermission;
    private QuestSurfaceAudioPermission.Gateway gatewayForTest;
    private Launcher launcherForTest;
    private boolean launched = false;

    /** Test seam — inject fake gateway. */
    void setGatewayForTest(QuestSurfaceAudioPermission.Gateway gateway) {
        this.gatewayForTest = gateway;
    }

    /** Test seam — inject fake launcher to observe launches without starting an Activity. */
    void setLauncherForTest(Launcher launcher) {
        this.launcherForTest = launcher;
    }

    QuestSurfaceAudioPermission getAudioPermissionForTest() {
        return audioPermission;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        QuestSurfaceAudioPermission.Gateway gateway =
                gatewayForTest != null ? gatewayForTest : createRealGateway();
        audioPermission = new QuestSurfaceAudioPermission(gateway);
        if (audioPermission.ensure()) {
            // already-granted path — no dialog, go straight to immersive
            launchImmersiveAndFinish();
        }
        // else: request issued, wait for onRequestPermissionsResult
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (audioPermission != null) {
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            audioPermission.onRequestPermissionsResult(requestCode, granted);
        }
        // fail-closed for capture, not a hard block: always launch immersive
        launchImmersiveAndFinish();
    }

    private synchronized void launchImmersiveAndFinish() {
        if (launched) return;
        launched = true;
        if (launcherForTest != null) {
            launcherForTest.launchImmersive();
        } else {
            startActivity(new Intent(this, QuestSurfaceActivity.class));
            finish();
        }
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
}

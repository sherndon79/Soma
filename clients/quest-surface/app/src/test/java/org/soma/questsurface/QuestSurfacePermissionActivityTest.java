package org.soma.questsurface;

import static org.junit.Assert.*;

import android.content.pm.PackageManager;

import org.junit.Test;

public final class QuestSurfacePermissionActivityTest {

    private static final class FakeGateway implements QuestSurfaceAudioPermission.Gateway {
        boolean granted = false;
        int requestCount = 0;
        @Override public boolean isRecordAudioGranted() { return granted; }
        @Override public void requestRecordAudioPermission(int code) { requestCount++; }
    }

    private static final class FakeLauncher implements QuestSurfacePermissionActivity.Launcher {
        int launchCount = 0;
        @Override public void launchImmersive() { launchCount++; }
    }

    @Test
    public void alreadyGrantedStartsImmersiveWithoutRequesting() {
        FakeGateway gw = new FakeGateway();
        gw.granted = true;
        FakeLauncher launcher = new FakeLauncher();
        QuestSurfacePermissionActivity activity = new QuestSurfacePermissionActivity();
        activity.setGatewayForTest(gw);
        activity.setLauncherForTest(launcher);

        activity.onCreate(null);

        assertEquals(0, gw.requestCount);
        assertEquals(1, launcher.launchCount);
    }

    @Test
    public void requestThenGrantedStartsImmersiveAfterResult() {
        FakeGateway gw = new FakeGateway();
        gw.granted = false;
        FakeLauncher launcher = new FakeLauncher();
        QuestSurfacePermissionActivity activity = new QuestSurfacePermissionActivity();
        activity.setGatewayForTest(gw);
        activity.setLauncherForTest(launcher);

        activity.onCreate(null);

        assertEquals(1, gw.requestCount);
        assertEquals(0, launcher.launchCount);

        activity.onRequestPermissionsResult(
                QuestSurfaceAudioPermission.REQUEST_CODE,
                new String[]{android.Manifest.permission.RECORD_AUDIO},
                new int[]{PackageManager.PERMISSION_GRANTED});

        assertEquals(1, launcher.launchCount);
        // no second request on second ensure
        assertEquals(1, gw.requestCount);
    }

    @Test
    public void deniedStillStartsImmersiveFailClosedForCapture() {
        FakeGateway gw = new FakeGateway();
        gw.granted = false;
        FakeLauncher launcher = new FakeLauncher();
        QuestSurfacePermissionActivity activity = new QuestSurfacePermissionActivity();
        activity.setGatewayForTest(gw);
        activity.setLauncherForTest(launcher);

        activity.onCreate(null);

        assertEquals(1, gw.requestCount);
        assertEquals(0, launcher.launchCount);

        activity.onRequestPermissionsResult(
                QuestSurfaceAudioPermission.REQUEST_CODE,
                new String[]{android.Manifest.permission.RECORD_AUDIO},
                new int[]{PackageManager.PERMISSION_DENIED});

        // still launches immersive — panel/transport work without mic
        assertEquals(1, launcher.launchCount);
        // capture stays closed: permission denied, but app not blocked
        assertFalse(activity.getAudioPermissionForTest().isGranted());
    }

    @Test
    public void doesNotLaunchTwiceOnDuplicateResult() {
        FakeGateway gw = new FakeGateway();
        gw.granted = true;
        FakeLauncher launcher = new FakeLauncher();
        QuestSurfacePermissionActivity activity = new QuestSurfacePermissionActivity();
        activity.setGatewayForTest(gw);
        activity.setLauncherForTest(launcher);

        activity.onCreate(null);
        assertEquals(1, launcher.launchCount);

        // duplicate result must not relaunch
        activity.onRequestPermissionsResult(
                QuestSurfaceAudioPermission.REQUEST_CODE,
                new String[]{android.Manifest.permission.RECORD_AUDIO},
                new int[]{PackageManager.PERMISSION_GRANTED});

        assertEquals(1, launcher.launchCount);
    }
}

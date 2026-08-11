package org.soma.questsurface;

import static org.junit.Assert.*;

import org.junit.Test;

public final class QuestSurfaceAudioPermissionTest {

    private static final class FakeGateway implements QuestSurfaceAudioPermission.Gateway {
        boolean granted = false;
        int requestCount = 0;
        int lastRequestCode = -1;

        @Override public boolean isRecordAudioGranted() { return granted; }
        @Override public void requestRecordAudioPermission(int code) {
            requestCount++;
            lastRequestCode = code;
        }
    }

    @Test
    public void alreadyGrantedDoesNotRequest() {
        FakeGateway gw = new FakeGateway();
        gw.granted = true;
        QuestSurfaceAudioPermission perm = new QuestSurfaceAudioPermission(gw);

        boolean result = perm.ensure();

        assertTrue(result);
        assertEquals(0, gw.requestCount);
        assertTrue(perm.isGranted());
        assertFalse(perm.wasRequestSent());
    }

    @Test
    public void requestThenGrantedPath() {
        FakeGateway gw = new FakeGateway();
        gw.granted = false;
        QuestSurfaceAudioPermission perm = new QuestSurfaceAudioPermission(gw);

        boolean first = perm.ensure();
        // not yet granted, request issued
        assertFalse(first);
        assertEquals(1, gw.requestCount);
        assertEquals(QuestSurfaceAudioPermission.REQUEST_CODE, gw.lastRequestCode);
        assertTrue(perm.wasRequestSent());
        assertFalse(perm.isGranted());

        // simulate user grants in system dialog
        perm.onRequestPermissionsResult(QuestSurfaceAudioPermission.REQUEST_CODE, true);

        assertTrue(perm.isGranted());
        // ensure does not re-request
        boolean second = perm.ensure();
        assertTrue(second);
        assertEquals(1, gw.requestCount);
    }

    @Test
    public void requestThenDeniedIsFailClosedNoRetryNoCrash() {
        FakeGateway gw = new FakeGateway();
        gw.granted = false;
        QuestSurfaceAudioPermission perm = new QuestSurfaceAudioPermission(gw);

        perm.ensure();
        assertEquals(1, gw.requestCount);

        // user denies
        perm.onRequestPermissionsResult(QuestSurfaceAudioPermission.REQUEST_CODE, false);

        assertFalse(perm.isGranted());
        // second ensure does not auto-retry (fail-closed, transport continues)
        perm.ensure();
        assertEquals(1, gw.requestCount);
        assertFalse(perm.isGranted());
    }

    @Test
    public void wrongRequestCodeIsIgnored() {
        FakeGateway gw = new FakeGateway();
        QuestSurfaceAudioPermission perm = new QuestSurfaceAudioPermission(gw);
        perm.ensure();
        perm.onRequestPermissionsResult(9999, true);
        assertFalse(perm.isGranted());
    }

    @Test
    public void activitySeamAlreadyGrantedPathIsTestable() {
        // This mirrors the Activity's ensure path without needing Robolectric: the helper is the seam.
        FakeGateway gw = new FakeGateway();
        gw.granted = true;
        QuestSurfaceAudioPermission perm = new QuestSurfaceAudioPermission(gw);
        // Activity would call ensure() in onCreate
        perm.ensure();
        assertTrue(perm.isGranted());
        assertEquals(0, gw.requestCount);
    }
}

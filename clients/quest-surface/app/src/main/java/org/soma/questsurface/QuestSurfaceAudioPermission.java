package org.soma.questsurface;

/**
 * Small permission decision seam for RECORD_AUDIO.
 *
 * <p>Two paths must both work (Threshold never exercised already-granted):
 * <ul>
 *   <li>already-granted: check returns true, no request is issued.</li>
 *   <li>request-then-granted: check false, request issued, result callback marks granted.</li>
 * </ul>
 * Denial is fail-closed: capture never starts, panel/transport continue. Grant does NOT arm capture;
 * arming is the server-side episode.
 */
final class QuestSurfaceAudioPermission {

    interface Gateway {
        boolean isRecordAudioGranted();
        void requestRecordAudioPermission(int requestCode);
    }

    static final int REQUEST_CODE = 1001;

    private final Gateway gateway;
    private boolean granted = false;
    private boolean requestSent = false;

    QuestSurfaceAudioPermission(Gateway gateway) {
        this.gateway = gateway;
    }

    /**
     * Ensure permission. Returns true if already granted, false if a request was issued or will be.
     * Idempotent: at most one request.
     */
    synchronized boolean ensure() {
        if (isGranted()) {
            granted = true;
            return true;
        }
        if (!requestSent) {
            gateway.requestRecordAudioPermission(REQUEST_CODE);
            requestSent = true;
        }
        return false;
    }

    synchronized void onRequestPermissionsResult(int requestCode, boolean isGranted) {
        if (requestCode != REQUEST_CODE) return;
        granted = isGranted;
        // keep requestSent true so we do not re-request in a loop; explicit retry would need new instance
    }

    synchronized boolean isGranted() {
        return granted || gateway.isRecordAudioGranted();
    }

    synchronized boolean wasRequestSent() {
        return requestSent;
    }
}

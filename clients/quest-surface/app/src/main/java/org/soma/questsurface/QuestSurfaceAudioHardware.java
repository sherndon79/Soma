package org.soma.questsurface;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;

import java.util.HashMap;
import java.util.Map;

/**
 * Real playback hardware: writes 48 kHz stereo PCM_I16 to {@link AudioTrack}.
 * Capture is no-op (capture driver lives above the transport; see scope doc).
 *
 * <p>Streaming: playback arrives as successive 3840 / 7680-byte chunks per
 * (epoch, streamId) playback stream. Creates the AudioTrack once per stream,
 * writes chunks in order, releases synchronously on stop/latch. No PCM is
 * logged or retained beyond the AudioTrack write.
 */
final class QuestSurfaceAudioHardware implements QuestSurfaceAudioEngine.Hardware {

    static final int SAMPLE_RATE = 48000;
    static final int CHANNEL_MASK = AudioFormat.CHANNEL_OUT_STEREO;
    static final int ENCODING = AudioFormat.ENCODING_PCM_16BIT;

    /** Injectable seam for JVM tests. */
    interface AudioTrackHandle {
        void play();
        int write(byte[] audioData, int offsetInBytes, int sizeInBytes);
        void stop();
        void flush();
        void release();
        default int getPlaybackHeadPosition() { return 0; }
        default int getFramesWritten() { return 0; }
    }

    interface AudioTrackFactory {
        AudioTrackHandle create(int sampleRate, int channelMask, int encoding, int bufferSizeInBytes);
        int getMinBufferSize(int sampleRate, int channelMask, int encoding);
    }

    private static final class RealAudioTrackFactory implements AudioTrackFactory {
        @Override
        public int getMinBufferSize(int sampleRate, int channelMask, int encoding) {
            return AudioTrack.getMinBufferSize(sampleRate, channelMask, encoding);
        }

        @Override
        public AudioTrackHandle create(int sampleRate, int channelMask, int encoding, int bufferSizeInBytes) {
            AudioAttributes attributes = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
            AudioFormat format = new AudioFormat.Builder()
                    .setSampleRate(sampleRate)
                    .setEncoding(encoding)
                    .setChannelMask(channelMask)
                    .build();
            AudioTrack track = new AudioTrack(
                    attributes,
                    format,
                    bufferSizeInBytes,
                    AudioTrack.MODE_STREAM,
                    AudioManager.AUDIO_SESSION_ID_GENERATE);
            return new RealHandle(track);
        }
    }

    private static final class RealHandle implements AudioTrackHandle {
        private final AudioTrack track;
        private int framesWritten = 0;
        RealHandle(AudioTrack track) { this.track = track; }
        @Override public void play() { track.play(); }
        @Override public int write(byte[] audioData, int offsetInBytes, int sizeInBytes) {
            int ret = track.write(audioData, offsetInBytes, sizeInBytes);
            if (ret > 0) framesWritten += ret / 4;
            return ret;
        }
        @Override public void stop() { track.stop(); }
        @Override public void flush() { track.flush(); }
        @Override public void release() { track.release(); }
        @Override public int getPlaybackHeadPosition() { return track.getPlaybackHeadPosition(); }
        @Override public int getFramesWritten() { return framesWritten; }
    }

    private final AudioTrackFactory factory;
    private final Map<String, AudioTrackHandle> tracks = new HashMap<>();

    QuestSurfaceAudioHardware(AudioTrackFactory factory) {
        this.factory = factory != null ? factory : new RealAudioTrackFactory();
    }

    QuestSurfaceAudioHardware() {
        this(null);
    }

    @Override
    public void startHardwareCapture(String sessionEpoch, long streamId, String leaseRef) {
        // no-op: capture driver lives above transport (scope doc asymmetric finding)
    }

    @Override
    public void stopHardwareCapture(String sessionEpoch, long streamId) {
        // no-op
    }

    @Override
    public synchronized void startHardwarePlayback(String sessionEpoch, long streamId, String leaseRef, byte[] pcm) throws Exception {
        if (pcm == null || pcm.length == 0) {
            throw new IllegalArgumentException("pcm required");
        }
        String key = sessionEpoch + ":" + streamId;
        AudioTrackHandle track = tracks.get(key);
        if (track == null) {
            int minBuf = factory.getMinBufferSize(SAMPLE_RATE, CHANNEL_MASK, ENCODING);
            int bufSize = Math.max(minBuf, 4 * 3840);
            if (bufSize % 4 != 0) bufSize += 4 - (bufSize % 4);
            track = factory.create(SAMPLE_RATE, CHANNEL_MASK, ENCODING, bufSize);
            track.play();
            tracks.put(key, track);
        }
        // Handle short/error returns: loop until full chunk written
        int offset = 0;
        int remaining = pcm.length;
        while (remaining > 0) {
            int written = track.write(pcm, offset, remaining);
            if (written <= 0) {
                throw new java.io.IOException("AudioTrack write failed: " + written);
            }
            offset += written;
            remaining -= written;
        }
    }

    @Override
    public synchronized void stopHardwarePlayback(String sessionEpoch, long streamId, String answerId) {
        // Immediate teardown for lifecycle (latch/focus/disconnect/reject): stop+flush discards
        String key = sessionEpoch + ":" + streamId;
        AudioTrackHandle track = tracks.remove(key);
        if (track != null) {
            try { track.stop(); } catch (Exception ignored) {}
            try { track.flush(); } catch (Exception ignored) {}
            try { track.release(); } catch (Exception ignored) {}
        }
    }

    @Override
    public void stopHardwarePlaybackGraceful(String sessionEpoch, long streamId, String answerId) {
        // Graceful terminal completion for ANSWER_END: drain to playback head then release, preemptible by lifecycle
        // Keep track playing while polling head toward written; do not hold monitor during wait;
        // retain ownership in map so immediate teardown can atomically remove and stop+flush+release.
        String key = sessionEpoch + ":" + streamId;
        AudioTrackHandle track;
        synchronized (this) {
            track = tracks.get(key);
            if (track == null) return;
        }
        long deadlineMs = System.currentTimeMillis() + 2000; // 2s bound
        while (System.currentTimeMillis() < deadlineMs) {
            int head;
            int written;
            try {
                head = track.getPlaybackHeadPosition();
                written = track.getFramesWritten();
            } catch (Exception ignored) { break; }
            if (head >= written) break;
            // Check if still owned; if immediate teardown removed it, exit without touching
            synchronized (this) {
                if (tracks.get(key) != track) return;
            }
            try { Thread.sleep(5); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); break; }
        }
        // After head reached (or timeout as bounded forced teardown), atomically remove-if-same before stop+release
        synchronized (this) {
            if (tracks.get(key) != track) return; // preempted by immediate
            tracks.remove(key);
        }
        try { track.stop(); } catch (Exception ignored) {}
        // Do NOT flush — flush would discard tail
        try { track.release(); } catch (Exception ignored) {}
    }

    // Visible for tests: number of active tracks
    synchronized int activeTrackCount() {
        return tracks.size();
    }
}

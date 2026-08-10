package org.soma.questsurface;

import java.io.IOException;
import java.math.BigInteger;
import java.util.HashMap;
import java.util.Map;

/** Monotonic sequence state keyed by the exact wire tuple. */
final class QuestSurfaceSequenceTracker {
    private final Map<String, BigInteger> received = new HashMap<>();
    private final Map<String, Long> sent = new HashMap<>();

    synchronized void accept(
            BigInteger epoch, long streamId, String direction, BigInteger sequence)
            throws IOException {
        String key = key(epoch.toString(), streamId, direction);
        BigInteger prior = received.getOrDefault(key, BigInteger.ZERO);
        if (sequence.compareTo(prior) <= 0) {
            throw new IOException("sequence_stale");
        }
        received.put(key, sequence);
    }

    synchronized long next(String epoch, long streamId, String direction) throws IOException {
        String key = key(epoch, streamId, direction);
        long prior = sent.getOrDefault(key, 0L);
        if (prior == -1L) {
            throw new IOException("sequence_exhausted");
        }
        long next = prior + 1L;
        sent.put(key, next);
        return next;
    }

    synchronized void clear() {
        received.clear();
        sent.clear();
    }

    private static String key(String epoch, long streamId, String direction) {
        return epoch + ":" + streamId + ":" + direction;
    }
}

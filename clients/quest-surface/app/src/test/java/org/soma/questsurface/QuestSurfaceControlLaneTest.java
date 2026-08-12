package org.soma.questsurface;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.lang.reflect.Field;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.Test;

/** Deterministic acceptance tests for the Activity-owned native control lane. */
public final class QuestSurfaceControlLaneTest {
    @Test
    public void terminalSurvivesFullQueueAndConcurrentSuspend() throws Exception {
        CountDownLatch blockerEntered = new CountDownLatch(1);
        CountDownLatch blockerRelease = new CountDownLatch(1);
        CountDownLatch terminalEntered = new CountDownLatch(1);
        CountDownLatch terminalRelease = new CountDownLatch(1);
        AtomicBoolean ackRan = new AtomicBoolean(false);
        AtomicBoolean suspendRan = new AtomicBoolean(false);
        AtomicBoolean terminalRan = new AtomicBoolean(false);
        AtomicBoolean duplicateTerminalRan = new AtomicBoolean(false);
        QuestSurfaceControlLane lane = new QuestSurfaceControlLane(11, 2, null);

        assertTrue(lane.offer(command(QuestSurfaceControlLane.Kind.START, 11, 1, () -> {
            blockerEntered.countDown();
            blockerRelease.await();
            return true;
        }, false)));
        assertTrue(blockerEntered.await(1, TimeUnit.SECONDS));
        assertTrue(lane.offer(command(
                QuestSurfaceControlLane.Kind.ACK, 11, 2, flag(ackRan), false)));
        assertTrue(lane.offer(command(
                QuestSurfaceControlLane.Kind.ACK, 11, 3, flag(ackRan), false)));
        assertEquals(2, lane.normalSize());
        assertTrue(lane.offer(command(
                QuestSurfaceControlLane.Kind.SUSPEND, 11, 4, flag(suspendRan), false)));
        assertTrue(lane.offer(command(
                QuestSurfaceControlLane.Kind.TERMINAL, 11, 5, () -> {
                    terminalRan.set(true);
                    terminalEntered.countDown();
                    terminalRelease.await();
                    return true;
                }, false)));
        assertTrue(lane.isTerminalWatermarked());
        assertFalse(lane.offer(command(
                QuestSurfaceControlLane.Kind.SUSPEND, 11, 6, () -> true, false)));
        assertFalse(lane.offer(command(
                QuestSurfaceControlLane.Kind.TOGGLE, 11, 7, () -> true, false)));

        blockerRelease.countDown();
        assertTrue(terminalEntered.await(1, TimeUnit.SECONDS));
        assertTrue("a repeated terminal is satisfied by the durable watermark", lane.offer(command(
                QuestSurfaceControlLane.Kind.TERMINAL,
                11,
                8,
                flag(duplicateTerminalRan),
                false)));
        terminalRelease.countDown();
        assertTrue(lane.awaitStopped(1, TimeUnit.SECONDS));
        assertTrue(terminalRan.get());
        assertFalse(duplicateTerminalRan.get());
        assertFalse(suspendRan.get());
        assertFalse(ackRan.get());
    }

    @Test
    public void resultsCarryExactGenerationSequenceAndActionOutcome() throws Exception {
        CountDownLatch resultReady = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        AtomicBoolean staleActionRan = new AtomicBoolean(false);
        QuestSurfaceControlLane lane = new QuestSurfaceControlLane(
                22,
                3,
                (generation, sequence, kind, accepted) -> {
                    result.set(generation + ":" + sequence + ":" + kind + ":" + accepted);
                    resultReady.countDown();
                });

        assertFalse(lane.offer(command(
                QuestSurfaceControlLane.Kind.START, 21, 8, flag(staleActionRan), true)));
        assertTrue(lane.offer(command(
                QuestSurfaceControlLane.Kind.START, 22, 9, () -> false, true)));
        assertTrue(resultReady.await(1, TimeUnit.SECONDS));
        assertEquals("22:9:START:false", result.get());
        assertFalse(staleActionRan.get());

        assertTrue(lane.offer(command(
                QuestSurfaceControlLane.Kind.SUSPEND, 22, 10, () -> true, false)));
        assertFalse("a pre-suspend command cannot reopen the lane", lane.offer(command(
                QuestSurfaceControlLane.Kind.RESUME, 22, 9, () -> true, true)));

        closeLane(lane, 22, 11);
    }

    @Test
    public void fullNonAckQueueRejectsStartSynchronously() throws Exception {
        CountDownLatch blockerEntered = new CountDownLatch(1);
        CountDownLatch blockerRelease = new CountDownLatch(1);
        AtomicBoolean rejectedStartRan = new AtomicBoolean(false);
        QuestSurfaceControlLane lane = new QuestSurfaceControlLane(33, 1, null);

        assertTrue(lane.offer(command(QuestSurfaceControlLane.Kind.TOGGLE, 33, 1, () -> {
            blockerEntered.countDown();
            blockerRelease.await();
            return true;
        }, false)));
        assertTrue(blockerEntered.await(1, TimeUnit.SECONDS));
        assertTrue(lane.offer(command(
                QuestSurfaceControlLane.Kind.TOGGLE, 33, 2, () -> true, false)));
        assertFalse(lane.offer(command(
                QuestSurfaceControlLane.Kind.START, 33, 3, flag(rejectedStartRan), true)));
        assertFalse(rejectedStartRan.get());

        assertTrue(lane.offer(command(
                QuestSurfaceControlLane.Kind.TERMINAL, 33, 4, () -> true, false)));
        blockerRelease.countDown();
        assertTrue(lane.awaitStopped(1, TimeUnit.SECONDS));
    }

    @Test
    public void importantNormalCommandEvictsAckWhenQueueIsFull() throws Exception {
        CountDownLatch blockerEntered = new CountDownLatch(1);
        CountDownLatch blockerRelease = new CountDownLatch(1);
        CountDownLatch startResult = new CountDownLatch(1);
        AtomicBoolean ackRan = new AtomicBoolean(false);
        AtomicBoolean toggleRan = new AtomicBoolean(false);
        AtomicBoolean startRan = new AtomicBoolean(false);
        QuestSurfaceControlLane lane = new QuestSurfaceControlLane(
                44,
                2,
                (generation, sequence, kind, accepted) -> {
                    if (sequence == 4 && accepted) startResult.countDown();
                });

        assertTrue(lane.offer(command(QuestSurfaceControlLane.Kind.TOGGLE, 44, 1, () -> {
            blockerEntered.countDown();
            blockerRelease.await();
            return true;
        }, false)));
        assertTrue(blockerEntered.await(1, TimeUnit.SECONDS));
        assertTrue(lane.offer(command(
                QuestSurfaceControlLane.Kind.ACK, 44, 2, flag(ackRan), false)));
        assertTrue(lane.offer(command(
                QuestSurfaceControlLane.Kind.TOGGLE, 44, 3, flag(toggleRan), false)));
        assertTrue(lane.offer(command(
                QuestSurfaceControlLane.Kind.START, 44, 4, flag(startRan), true)));

        blockerRelease.countDown();
        assertTrue(startResult.await(1, TimeUnit.SECONDS));
        assertFalse(ackRan.get());
        assertTrue(toggleRan.get());
        assertTrue(startRan.get());
        closeLane(lane, 44, 5);
    }

    @Test
    public void finalPttFalseBypassesStateAndOldGateCannotMutateNewGate() throws Exception {
        AtomicBoolean oldGate = new AtomicBoolean(true);
        AtomicBoolean newGate = new AtomicBoolean(false);
        QuestSurfaceTransport oldTransport = transport(oldGate, 51);
        QuestSurfaceTransport newTransport = transport(newGate, 52);
        QuestSurfaceCaptureDriver oldDriver = installFakeDriver(oldTransport);
        installFakeDriver(newTransport);
        setTransportState(oldTransport, "ACTIVE");

        oldTransport.setPttHeld(true);
        assertTrue(oldDriver.pttHeld());

        CountDownLatch suspendEntered = new CountDownLatch(1);
        CountDownLatch suspendRelease = new CountDownLatch(1);
        QuestSurfaceControlLane lane = new QuestSurfaceControlLane(51, 1, null);
        assertTrue(lane.offer(command(QuestSurfaceControlLane.Kind.SUSPEND, 51, 1, () -> {
            suspendEntered.countDown();
            suspendRelease.await();
            return true;
        }, false)));
        assertTrue(suspendEntered.await(1, TimeUnit.SECONDS));

        oldGate.set(false);
        oldTransport.forcePttReleased();
        assertFalse("release is visible before heavy suspend returns", oldDriver.pttHeld());
        oldGate.set(true);
        assertFalse("an old Activity gate cannot reopen a new Activity", newGate.get());

        assertTrue(lane.offer(command(
                QuestSurfaceControlLane.Kind.TERMINAL, 51, 2, () -> true, false)));
        suspendRelease.countDown();
        assertTrue(lane.awaitStopped(1, TimeUnit.SECONDS));
        oldTransport.stopPermanently("test_complete");
        newTransport.stopPermanently("test_complete");
    }

    private static QuestSurfaceControlLane.Command command(
            QuestSurfaceControlLane.Kind kind,
            long generation,
            long sequence,
            QuestSurfaceControlLane.Action action,
            boolean reportsResult) {
        return new QuestSurfaceControlLane.Command(
                kind, generation, sequence, action, reportsResult);
    }

    private static QuestSurfaceControlLane.Action flag(AtomicBoolean value) {
        return () -> {
            value.set(true);
            return true;
        };
    }

    private static void closeLane(
            QuestSurfaceControlLane lane, long generation, long sequence) throws Exception {
        assertTrue(lane.offer(command(
                QuestSurfaceControlLane.Kind.TERMINAL,
                generation,
                sequence,
                () -> true,
                false)));
        assertTrue(lane.awaitStopped(1, TimeUnit.SECONDS));
    }

    private static QuestSurfaceTransport transport(AtomicBoolean gate, long generation) {
        return new QuestSurfaceTransport(
                null,
                "unused",
                1,
                (state, code, attempt) -> {},
                (epoch, lease, revision, hash, surface, text, x, y, z, qx, qy, qz, qw,
                 width, height, deadline) -> {},
                new QuestSurfaceRuntime(new QuestSurfaceAudioEngine()),
                freshEpoch -> false,
                gate,
                generation);
    }

    private static QuestSurfaceCaptureDriver installFakeDriver(QuestSurfaceTransport transport)
            throws Exception {
        QuestSurfaceCaptureDriver driver = new QuestSurfaceCaptureDriver(
                new QuestSurfaceCaptureDriver.MicSource() {
                    @Override public void open() {}
                    @Override public int read(byte[] bytes, int offset, int length) { return -1; }
                    @Override public void close() {}
                },
                () -> false,
                new QuestSurfaceCaptureDriver.UplinkSink() {
                    @Override public void utteranceStart(long streamId, String utteranceId) {}
                    @Override public void audioChunk(
                            long streamId, String utteranceId, byte[] pcm) {}
                    @Override public void utteranceEnd(long streamId, String utteranceId) {}
                    @Override public void cancel(
                            long streamId, String utteranceId, String reason) {}
                });
        Field field = QuestSurfaceTransport.class.getDeclaredField("captureDriver");
        field.setAccessible(true);
        field.set(transport, driver);
        return driver;
    }

    private static void setTransportState(QuestSurfaceTransport transport, String state)
            throws Exception {
        Field field = QuestSurfaceTransport.class.getDeclaredField("sessionState");
        field.setAccessible(true);
        @SuppressWarnings("unchecked")
        AtomicReference<Object> reference = (AtomicReference<Object>) field.get(transport);
        Class<?> enumClass = Class.forName(
                "org.soma.questsurface.QuestSurfaceTransport$SessionState");
        @SuppressWarnings("unchecked")
        Object value = Enum.valueOf((Class<Enum>) enumClass, state);
        reference.set(value);
    }
}

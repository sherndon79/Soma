package org.soma.questsurface;

import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

/**
 * One Activity's non-blocking native-to-Java control lane.
 *
 * <p>Terminal and resumable-suspend commands have dedicated coalescing slots. Normal commands use
 * a bounded lock-free queue; a full queue may discard an ACK, but never a critical command.
 * Publishing terminal is a durable watermark: subsequent non-terminal admission is rejected and
 * the worker exits only after the terminal action completes.
 */
final class QuestSurfaceControlLane {
    enum Kind { TERMINAL, SUSPEND, RESUME, START, TOGGLE, ACK }

    interface Action {
        boolean run() throws Exception;
    }

    interface ResultSink {
        void accept(long activityGeneration, long sequence, Kind kind, boolean accepted);
    }

    static final class Command {
        final Kind kind;
        final long activityGeneration;
        final long sequence;
        final Action action;
        final boolean reportsResult;

        Command(
                Kind kind,
                long activityGeneration,
                long sequence,
                Action action,
                boolean reportsResult) {
            this.kind = kind;
            this.activityGeneration = activityGeneration;
            this.sequence = sequence;
            this.action = action;
            this.reportsResult = reportsResult;
        }
    }

    private final long activityGeneration;
    private final int normalCapacity;
    private final ResultSink resultSink;
    private final AtomicReference<Command> terminalSlot = new AtomicReference<>();
    private final AtomicReference<Command> suspendSlot = new AtomicReference<>();
    private final AtomicBoolean terminalWatermark = new AtomicBoolean(false);
    private final AtomicLong suspendWatermark = new AtomicLong(0);
    private final AtomicLong completedSuspendWatermark = new AtomicLong(0);
    private final ConcurrentLinkedQueue<Command> normalQueue = new ConcurrentLinkedQueue<>();
    private final AtomicInteger normalCount = new AtomicInteger(0);
    private final AtomicBoolean running = new AtomicBoolean(true);
    private final Semaphore wake = new Semaphore(0);
    private final Thread worker;

    QuestSurfaceControlLane(
            long activityGeneration, int normalCapacity, ResultSink resultSink) {
        if (activityGeneration <= 0) throw new IllegalArgumentException("activityGeneration");
        if (normalCapacity <= 0) throw new IllegalArgumentException("normalCapacity");
        this.activityGeneration = activityGeneration;
        this.normalCapacity = normalCapacity;
        this.resultSink = resultSink == null ? (generation, sequence, kind, accepted) -> {} : resultSink;
        worker = new Thread(this::runLoop, "quest-control-" + activityGeneration);
        worker.setDaemon(true);
        worker.start();
    }

    boolean offer(Command command) {
        if (command == null
                || command.action == null
                || command.activityGeneration != activityGeneration
                || command.sequence <= 0
                || !running.get()) {
            return false;
        }
        switch (command.kind) {
            case TERMINAL:
                return offerTerminal(command);
            case SUSPEND:
                return offerSuspend(command);
            default:
                return offerNormal(command);
        }
    }

    private boolean offerTerminal(Command command) {
        if (terminalWatermark.get()) {
            return true;
        }
        if (!terminalSlot.compareAndSet(null, command)) {
            return true;
        }
        // Publish the action before the watermark so the worker cannot observe a terminal with
        // an empty slot. The watermark then closes all lower-priority admissions.
        if (!terminalWatermark.compareAndSet(false, true)) {
            terminalSlot.compareAndSet(command, null);
            return true;
        }
        suspendSlot.set(null);
        clearNormalQueue();
        wake.release();
        return true;
    }

    private boolean offerSuspend(Command command) {
        if (terminalWatermark.get()) return false;
        suspendWatermark.accumulateAndGet(command.sequence, Math::max);
        suspendSlot.accumulateAndGet(
                command,
                (prior, next) -> prior == null || next.sequence > prior.sequence ? next : prior);
        if (terminalWatermark.get()) {
            suspendSlot.compareAndSet(command, null);
            return false;
        }
        discardNormalsThrough(command.sequence);
        wake.release();
        return true;
    }

    private boolean offerNormal(Command command) {
        if (terminalWatermark.get() || command.sequence <= suspendWatermark.get()) return false;
        if (!reserveNormalSlot()) {
            if (command.kind == Kind.ACK || !evictOneAck() || !reserveNormalSlot()) {
                return false;
            }
        }
        normalQueue.offer(command);
        if ((terminalWatermark.get() || command.sequence <= suspendWatermark.get())
                && normalQueue.remove(command)) {
            normalCount.decrementAndGet();
            return false;
        }
        wake.release();
        return true;
    }

    private boolean reserveNormalSlot() {
        for (;;) {
            int observed = normalCount.get();
            if (observed >= normalCapacity) return false;
            if (normalCount.compareAndSet(observed, observed + 1)) return true;
        }
    }

    private boolean evictOneAck() {
        for (Command queued : normalQueue) {
            if (queued.kind == Kind.ACK && normalQueue.remove(queued)) {
                normalCount.decrementAndGet();
                return true;
            }
        }
        return false;
    }

    private Command pollNormal() {
        Command command = normalQueue.poll();
        if (command != null) normalCount.decrementAndGet();
        return command;
    }

    private void clearNormalQueue() {
        while (pollNormal() != null) {
            // Terminal supersedes queued normal work.
        }
    }

    private void discardNormalsThrough(long sequence) {
        for (Command queued : normalQueue) {
            if (queued.sequence <= sequence && normalQueue.remove(queued)) {
                normalCount.decrementAndGet();
            }
        }
    }

    private void runLoop() {
        while (running.get()) {
            try {
                wake.acquire();
            } catch (InterruptedException ignored) {
                if (!running.get()) break;
            }
            drainReady();
        }
    }

    private void drainReady() {
        while (running.get()) {
            if (terminalWatermark.get()) {
                Command terminal = terminalSlot.getAndSet(null);
                if (terminal != null) execute(terminal);
                suspendSlot.set(null);
                clearNormalQueue();
                running.set(false);
                return;
            }

            long requiredSuspend = suspendWatermark.get();
            if (requiredSuspend > completedSuspendWatermark.get()) {
                Command suspend = suspendSlot.getAndSet(null);
                if (suspend == null) return;
                if (!terminalWatermark.get()) {
                    execute(suspend);
                    completedSuspendWatermark.accumulateAndGet(suspend.sequence, Math::max);
                }
                continue;
            }

            Command normal = pollNormal();
            if (normal == null) return;
            if (!terminalWatermark.get()
                    && normal.sequence > completedSuspendWatermark.get()) {
                execute(normal);
            }
        }
    }

    private void execute(Command command) {
        if (command.activityGeneration != activityGeneration) return;
        boolean accepted = false;
        try {
            accepted = command.action.run();
        } catch (Throwable ignored) {
            accepted = false;
        }
        if (command.reportsResult) {
            try {
                resultSink.accept(
                        command.activityGeneration, command.sequence, command.kind, accepted);
            } catch (Throwable ignored) {
                // A result callback cannot kill the Activity's control worker.
            }
        }
    }

    void shutdownNow() {
        if (terminalWatermark.get()) {
            wake.release();
            return;
        }
        running.set(false);
        wake.release();
    }

    boolean awaitStopped(long timeout, TimeUnit unit) throws InterruptedException {
        worker.join(unit.toMillis(timeout));
        return !worker.isAlive();
    }

    boolean isTerminalWatermarked() {
        return terminalWatermark.get();
    }

    int normalSize() {
        return normalCount.get();
    }
}

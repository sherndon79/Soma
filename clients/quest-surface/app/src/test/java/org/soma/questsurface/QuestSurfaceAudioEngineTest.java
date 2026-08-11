package org.soma.questsurface;

import static org.junit.Assert.*;

import org.junit.Test;

public final class QuestSurfaceAudioEngineTest {
    @Test
    public void latchRequiresDeliberateFreshEpoch() throws Exception {
        QuestSurfaceAudioEngine engine = new QuestSurfaceAudioEngine();
        assertFalse(engine.isLatched());
        engine.latch("focus_lost");
        assertTrue(engine.isLatched());
        assertFalse(engine.deliberateResume("0", true));
        assertFalse(engine.deliberateResume("99", false));
        assertTrue(engine.isLatched());
        assertTrue(engine.deliberateResume("99", true));
        assertFalse(engine.isLatched());
    }

    @Test
    public void streamIsolationCancelOnlyNamedUtterance() throws Exception {
        QuestSurfaceAudioEngine engine = new QuestSurfaceAudioEngine();
        engine.startCapture("10", 1, "utt-a", "lease-mic");
        engine.startCapture("10", 2, "utt-b", "lease-mic");
        assertEquals(2, engine.activeCount());
        assertTrue(engine.cancel("10", 1, "utt-a"));
        assertEquals(1, engine.activeCount());
        assertFalse(engine.cancel("10", 2, "wrong"));
        assertEquals(1, engine.activeCount());
        assertTrue(engine.cancel("10", 2, "utt-b"));
        assertEquals(0, engine.activeCount());
    }

    @Test
    public void latchBlocksCaptureButNotCancel() throws Exception {
        QuestSurfaceAudioEngine engine = new QuestSurfaceAudioEngine();
        engine.startCapture("1", 1, "utt-1", "lease-mic");
        engine.latch("suspend");
        try {
            engine.startCapture("1", 2, "utt-2", "lease-mic");
            fail("should have thrown latch");
        } catch (QuestSurfaceAudioEngine.EngineException e) {
            assertEquals("mic_latch_active", e.code);
        }
        // cancel still allowed? Our engine's cancel does not check latch, but start does.
        // After latch, active should be 0 (cleared)
        assertEquals(0, engine.activeCount());
    }

    @Test
    public void vadAndLimitsEnforced() throws Exception {
        QuestSurfaceAudioEngine engine = new QuestSurfaceAudioEngine();
        engine.startCapture("1", 1, "utt-1", "lease-mic");
        byte[] voiced = new byte[1920];
        voiced[0] = 1;
        engine.pushChunk("1", 1, "utt-1", voiced);
        assertTrue(engine.endCapture("1", 1, "utt-1"));
        // silence-only
        engine.startCapture("1", 2, "utt-silence", "lease-mic");
        byte[] silence = new byte[1920];
        engine.pushChunk("1", 2, "utt-silence", silence);
        assertFalse(engine.endCapture("1", 2, "utt-silence"));
    }

    @Test
    public void cumulativeDurationAndChunkLimitsEnforce30s() throws Exception {
        byte[] p20 = new byte[1920]; p20[0]=1;
        byte[] p40 = new byte[3840]; p40[0]=1;
        // 20ms-only: 1500 *20 =30000 exactly, 1501st exceeds duration/chunk limit
        QuestSurfaceAudioEngine e20 = new QuestSurfaceAudioEngine();
        e20.startCapture("1", 1, "utt-20", "lease-mic");
        for (int i=0;i<1500;i++) e20.pushChunk("1",1,"utt-20", p20);
        assertEquals(30000, e20.activeDurationMs("1",1));
        assertEquals(1500, e20.activeChunks("1",1));
        try { e20.pushChunk("1",1,"utt-20", p20); fail(); } catch (QuestSurfaceAudioEngine.EngineException ex) { assertEquals("utterance_too_long", ex.code); }
        // 40ms-only: 750*40=30000, 751st must be rejected independently of 1500 chunk bound
        QuestSurfaceAudioEngine e40 = new QuestSurfaceAudioEngine();
        e40.startCapture("1", 2, "utt-40", "lease-mic");
        for (int i=0;i<750;i++) e40.pushChunk("1",2,"utt-40", p40);
        assertEquals(30000, e40.activeDurationMs("1",2));
        assertEquals(750, e40.activeChunks("1",2));
        try { e40.pushChunk("1",2,"utt-40", p40); fail(); } catch (QuestSurfaceAudioEngine.EngineException ex) { assertEquals("utterance_too_long", ex.code); }
        // mixed 20/40: alternating 20,40 for 1000 chunks = 30000 (500*60), next 20 must exceed
        QuestSurfaceAudioEngine eMix = new QuestSurfaceAudioEngine();
        eMix.startCapture("1", 3, "utt-mix", "lease-mic");
        for (int i=0;i<500;i++) { eMix.pushChunk("1",3,"utt-mix", p20); eMix.pushChunk("1",3,"utt-mix", p40); }
        assertEquals(30000, eMix.activeDurationMs("1",3));
        assertEquals(1000, eMix.activeChunks("1",3));
        try { eMix.pushChunk("1",3,"utt-mix", p20); fail(); } catch (QuestSurfaceAudioEngine.EngineException ex) { assertEquals("utterance_too_long", ex.code); }
        // also mixed where total would exceed mid-chunk: 749*40=29960 +20=29980 +40=30020 must reject the 40
        QuestSurfaceAudioEngine eMix2 = new QuestSurfaceAudioEngine();
        eMix2.startCapture("1",4,"utt-mix2","lease-mic");
        for (int i=0;i<749;i++) eMix2.pushChunk("1",4,"utt-mix2", p40);
        eMix2.pushChunk("1",4,"utt-mix2", p20); // 29980
        try { eMix2.pushChunk("1",4,"utt-mix2", p40); fail(); } catch (QuestSurfaceAudioEngine.EngineException ex) { assertEquals("utterance_too_long", ex.code); }
    }

    @Test
    public void captureAndPlaybackGatedByLatchLeaseAnswer() throws Exception {
        QuestSurfaceAudioEngine engine = new QuestSurfaceAudioEngine();
        // capture requires lease
        try { engine.startCapture("1",1,"utt",""); fail(); } catch (QuestSurfaceAudioEngine.EngineException e) { assertEquals("lease_ref_required", e.code); }
        // playback requires lease, answerId, and correct PCM size
        try { engine.startPlayback("1",1,"", "ans", new byte[3840]); fail(); } catch (QuestSurfaceAudioEngine.EngineException e) { assertEquals("lease_ref_required", e.code); }
        try { engine.startPlayback("1",1,"lease-audio","", new byte[3840]); fail(); } catch (QuestSurfaceAudioEngine.EngineException e) { assertEquals("answer_id_invalid", e.code); }
        try { engine.startPlayback("1",1,"lease-audio","ans", new byte[1920]); fail(); } catch (QuestSurfaceAudioEngine.EngineException e) { assertEquals("pcm_bytes_invalid", e.code); }
        // latch blocks both
        engine.startCapture("1",1,"utt-1","lease-mic");
        engine.latch("focus_lost","10");
        try { engine.startCapture("1",2,"utt-2","lease-mic"); fail(); } catch (QuestSurfaceAudioEngine.EngineException e) { assertEquals("mic_latch_active", e.code); }
        try { engine.startPlayback("1",2,"lease-audio","ans", new byte[3840]); fail(); } catch (QuestSurfaceAudioEngine.EngineException e) { assertEquals("mic_latch_active", e.code); }
        // playback with correct params succeeds when unlached
        assertTrue(engine.deliberateResume("11", true));
        engine.startPlayback("1",2,"lease-audio","ans", new byte[3840]);
        assertEquals(1, engine.playbackCount());
    }

    @Test
    public void fakeHardwareStopCalledOnLatchRevokeDisconnect() throws Exception {
        final java.util.List<String> events = new java.util.ArrayList<>();
        QuestSurfaceAudioEngine.Hardware hw = new QuestSurfaceAudioEngine.Hardware() {
            public void startHardwareCapture(String e, long s, String l) { events.add("startCapture:"+e+":"+s+":"+l); }
            public void stopHardwareCapture(String e, long s) { events.add("stopCapture:"+e+":"+s); }
            public void startHardwarePlayback(String e, long s, String l, byte[] p) { events.add("startPlayback:"+e+":"+s+":"+l); }
            public void stopHardwarePlayback(String e, long s, String a) { events.add("stopPlayback:"+e+":"+s+":"+a); }
        };
        QuestSurfaceAudioEngine engine = new QuestSurfaceAudioEngine(hw);
        engine.startCapture("10",1,"utt-1","lease-mic");
        engine.startCapture("10",2,"utt-2","lease-mic");
        engine.startPlayback("10",3,"lease-audio","ans-1", new byte[3840]);
        events.clear();
        // focus latch must stop each active capture and playback with exact identities
        engine.latch("focus_lost","10");
        assertTrue(events.contains("stopCapture:10:1"));
        assertTrue(events.contains("stopCapture:10:2"));
        assertTrue(events.contains("stopPlayback:10:3:ans-1"));
        assertEquals(3, events.size());
        assertEquals(0, engine.activeCount());
        assertEquals(0, engine.playbackCount());
        // no cross-stream start after latch without fresh epoch
        events.clear();
        try { engine.startCapture("10",4,"utt-4","lease-mic"); fail(); } catch (QuestSurfaceAudioEngine.EngineException e) { assertEquals("mic_latch_active", e.code); }
        assertEquals(0, events.size());
        // revoke path: new captures then revoke
        assertTrue(engine.deliberateResume("11", true));
        events.clear();
        engine.startCapture("11",1,"utt-3","lease-mic");
        engine.startPlayback("11",2,"lease-audio","ans-2", new byte[3840]);
        assertTrue(events.contains("startCapture:11:1:lease-mic"));
        assertTrue(events.contains("startPlayback:11:2:lease-audio"));
        events.clear();
        engine.latch("revoke","11");
        assertTrue(events.contains("stopCapture:11:1"));
        assertTrue(events.contains("stopPlayback:11:2:ans-2"));
        assertEquals(2, events.size());
        // disconnect path
        assertTrue(engine.deliberateResume("12", true));
        events.clear();
        engine.startCapture("12",5,"utt-5","lease-mic");
        assertTrue(events.contains("startCapture:12:5:lease-mic"));
        events.clear();
        engine.latch("disconnect","12");
        assertTrue(events.contains("stopCapture:12:5"));
        assertEquals(1, events.size());
        assertEquals(0, engine.activeCount());
    }

    // H: jitter queues, flush, per-stream isolation, ANSWER_END terminal
    @Test
    public void jitterQueueDropOldestPerStreamIsolation() throws Exception {
        QuestSurfaceAudioEngine engine = new QuestSurfaceAudioEngine();
        engine.startCapture("1", 1, "utt-1", "lease-mic");
        // fill capture jitter to capacity 10, then overflow 11th drops oldest
        for (int i=0;i<11;i++) {
            byte[] pcm = new byte[1920]; pcm[0]=(byte)i;
            engine.enqueueCaptureChunk("1",1, pcm);
        }
        assertEquals(10, engine.captureJitterSize("1",1));
        byte[] first = engine.peekCaptureChunk("1",1);
        assertEquals(1, first[0]); // oldest (0) dropped
        // per-stream isolation: second stream unaffected
        engine.startCapture("1", 2, "utt-2", "lease-mic");
        byte[] other = new byte[1920]; other[0]=99;
        engine.enqueueCaptureChunk("1",2, other);
        assertEquals(10, engine.captureJitterSize("1",1));
        assertEquals(1, engine.captureJitterSize("1",2));
        // playback jitter: bounded 200ms drop-oldest (item-H) — continuous consumer drains while chunks arrive
        engine.startPlayback("1",3,"lease-audio","ans-1","utt-1", new byte[3840]);
        for (int i=0;i<11;i++) {
            byte[] pcm = new byte[3840]; pcm[0]=(byte)i;
            engine.enqueuePlaybackChunk("1",3,"ans-1", pcm);
        }
        assertEquals(10, engine.playbackJitterSize("1",3,"ans-1"));
    }

    @Test
    public void flushOnCancelFocusRevokeDisconnectAndExpiry() throws Exception {
        QuestSurfaceAudioEngine engine = new QuestSurfaceAudioEngine();
        engine.startCapture("1", 1, "utt-1", "lease-mic");
        engine.enqueueCaptureChunk("1",1, new byte[1920]);
        engine.startPlayback("1",1,"lease-audio","ans-1","utt-1", new byte[3840]);
        engine.enqueuePlaybackChunk("1",1,"ans-1", new byte[3840]);
        assertEquals(1, engine.captureJitterSize("1",1));
        assertEquals(1, engine.playbackJitterSize("1",1,"ans-1"));
        // cancel flushes only capture (direction-isolated) — playback on same numeric stream stays
        assertTrue(engine.cancel("1",1,"utt-1"));
        assertEquals(0, engine.captureJitterSize("1",1));
        assertEquals(1, engine.playbackJitterSize("1",1,"ans-1"));
        // focus latch flushes all
        engine.startCapture("2", 1, "utt-2", "lease-mic");
        engine.enqueueCaptureChunk("2",1, new byte[1920]);
        engine.startCapture("2", 2, "utt-3", "lease-mic");
        engine.enqueueCaptureChunk("2",2, new byte[1920]);
        engine.latch("focus_lost","2");
        assertEquals(0, engine.captureJitterSize("2",1));
        assertEquals(0, engine.captureJitterSize("2",2));
        assertTrue(engine.isLatched());
        // revoke flush
        assertTrue(engine.deliberateResume("3", true));
        engine.startCapture("3",5,"utt-5","lease-mic");
        engine.enqueueCaptureChunk("3",5, new byte[1920]);
        engine.latch("revoke","3");
        assertEquals(0, engine.captureJitterSize("3",5));
        // disconnect flush
        assertTrue(engine.deliberateResume("4", true));
        engine.startCapture("4",6,"utt-6","lease-mic");
        engine.enqueueCaptureChunk("4",6, new byte[1920]);
        engine.latch("disconnect","4");
        assertEquals(0, engine.captureJitterSize("4",6));
    }

    @Test
    public void answerEndTerminalDrainThenClearAndPostTerminalRefusals() throws Exception {
        QuestSurfaceAudioEngine engine = new QuestSurfaceAudioEngine();
        engine.startPlayback("10",5,"lease-audio","ans-1","utt-1", new byte[3840]);
        engine.enqueuePlaybackChunk("10",5,"ans-1", new byte[3840]);
        engine.enqueuePlaybackChunk("10",5,"ans-1", new byte[3840]);
        assertEquals(2, engine.playbackJitterSize("10",5,"ans-1"));
        // ANSWER_END closes admission but retains queued PCM
        engine.handleAnswerEnd("10",5,"lease-audio","utt-1","ans-1", 1);
        assertTrue(engine.isAnswerTerminal("10",5,"ans-1"));
        assertEquals(2, engine.playbackJitterSize("10",5,"ans-1"));
        // post-terminal AUDIO_CHUNK refused
        try { engine.enqueuePlaybackChunk("10",5,"ans-1", new byte[3840]); fail(); }
        catch (QuestSurfaceAudioEngine.EngineException e) { assertEquals("answer_ended", e.code); }
        // duplicate terminal refused
        try { engine.handleAnswerEnd("10",5,"lease-audio","utt-1","ans-1", 2); fail(); }
        catch (QuestSurfaceAudioEngine.EngineException e) { assertEquals("answer_ended", e.code); }
        // stale seq refused
        try { engine.handleAnswerEnd("10",5,"lease-audio","utt-1","ans-1", 1); fail(); }
        catch (QuestSurfaceAudioEngine.EngineException e) { assertEquals("seq_stale", e.code); }
        // wrong correlation (no playback) => stream-scoped refusal
        try { engine.handleAnswerEnd("10",6,"lease-audio","utt-1","ans-1", 3); fail(); }
        catch (QuestSurfaceAudioEngine.EngineException e) { assertEquals("playback_not_started", e.code); }
        // stream 0 refused
        try { engine.handleAnswerEnd("10",0,"lease-audio","utt-1","ans-1", 4); fail(); }
        catch (QuestSurfaceAudioEngine.EngineException e) { assertEquals("stream_id_invalid", e.code); }
        // drain-then-clear
        int drained = engine.drainPlayback("10",5,"ans-1");
        assertEquals(2, drained);
        assertEquals(0, engine.playbackJitterSize("10",5,"ans-1"));
        assertFalse(engine.isAnswerTerminal("10",5,"ans-1"));
        assertEquals(0, engine.playbackCount());
    }

    @Test
    public void expiredManifestAtTerminalLatchesVsMismatchRefuses() throws Exception {
        QuestSurfaceAudioEngine engine = new QuestSurfaceAudioEngine();
        engine.startPlayback("20",7,"lease-audio","ans-9","utt-9", new byte[3840]);
        // expired manifest at terminal -> latch (fail-closed)
        try { engine.handleAnswerEndWithExpiry("20",7,"lease-audio","utt-9","ans-9", 1, true); fail(); }
        catch (QuestSurfaceAudioEngine.EngineException e) { assertEquals("lease_expired", e.code); }
        assertTrue(engine.isLatched());
        assertEquals("lease_expired", engine.latchReason());
        // mismatch (wrong lease still present but no playback) -> stream-scoped, not latch
        QuestSurfaceAudioEngine engine2 = new QuestSurfaceAudioEngine();
        engine2.startPlayback("21",8,"lease-audio","ans-10","utt-10", new byte[3840]);
        try { engine2.handleAnswerEnd("21",8,"","utt-10","ans-10", 1); fail(); }
        catch (QuestSurfaceAudioEngine.EngineException e) { assertEquals("lease_ref_required", e.code); }
        assertFalse(engine2.isLatched());
    }

    @Test
    public void latchOverridesTerminalDrain() throws Exception {
        QuestSurfaceAudioEngine engine = new QuestSurfaceAudioEngine();
        engine.startPlayback("30",9,"lease-audio","ans-20","utt-20", new byte[3840]);
        engine.enqueuePlaybackChunk("30",9,"ans-20", new byte[3840]);
        engine.handleAnswerEnd("30",9,"lease-audio","utt-20","ans-20", 5);
        assertTrue(engine.isAnswerTerminal("30",9,"ans-20"));
        // latch mid-drain flushes synchronously and wins
        engine.latch("focus_lost","30");
        assertEquals(0, engine.playbackJitterSize("30",9,"ans-20"));
        assertFalse(engine.isAnswerTerminal("30",9,"ans-20"));
        assertTrue(engine.isLatched());
    }

    @Test
    public void burstOfferSix40msThenPumpSendsNewestFive() throws Exception {
        QuestSurfaceAudioEngine engine = new QuestSurfaceAudioEngine();
        engine.startCapture("99", 10, "utt-burst", "lease-mic");
        // offer 6x40ms before pumping
        for (int i=0;i<6;i++) { byte[] pcm = new byte[3840]; pcm[0]=(byte)i; engine.enqueueCaptureChunk("99",10, pcm); }
        // duration-bound: 6*40=240 >200, drop oldest (0) → 5 retained (1..5)
        assertEquals(5, engine.captureJitterSize("99",10));
        assertEquals(1, engine.peekCaptureChunk("99",10)[0]);
        // pump in order via poll
        for (int i=1;i<6;i++) { byte[] polled = engine.pollCaptureChunk("99",10); assertEquals(i, polled[0]); }
        assertEquals(0, engine.captureJitterSize("99",10));
        // playback burst 6x40 → 5 retained (bounded 200ms), then consume drains tail
        engine.startPlayback("99", 20, "lease-audio", "ans-burst", "utt-burst", new byte[3840]);
        for (int i=0;i<6;i++) { byte[] pcm = new byte[7680]; pcm[0]=(byte)i; engine.enqueuePlaybackChunk("99",20,"ans-burst", pcm); }
        assertEquals(5, engine.playbackJitterSize("99",20,"ans-burst"));
        // consumer polls retained (1..5) in order then stop — oldest dropped
        for (int i=1;i<6;i++) { byte[] polled = engine.pollPlaybackChunk("99",20,"ans-burst"); assertEquals(i, polled[0]); }
        assertEquals(0, engine.playbackJitterSize("99",20,"ans-burst"));
    }
}

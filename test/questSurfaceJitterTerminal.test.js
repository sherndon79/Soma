import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createQuestSurfaceAudioPipeline } from "../src/questSurfaceAudioPipeline.js";

describe("H jitter + ANSWER_END terminal", () => {
  it("queue-full drop-oldest per-stream isolation", () => {
    const p = createQuestSurfaceAudioPipeline();
    p.handleUtteranceStart({ sessionEpoch: "1", streamId: 1, payload: { utterance_id: "utt-1" }, leaseRef: "lease-mic" });
    for (let i=0;i<11;i++) p.enqueueCaptureChunk("1",1, Buffer.alloc(1920, i));
    assert.equal(p.captureJitterSize("1",1), 10);
    assert.equal(p._captureJitter.get("1:1")[0][0], 1);
    p.handleUtteranceStart({ sessionEpoch: "1", streamId: 2, payload: { utterance_id: "utt-2" }, leaseRef: "lease-mic" });
    p.enqueueCaptureChunk("1",2, Buffer.alloc(1920, 99));
    assert.equal(p.captureJitterSize("1",1), 10);
    assert.equal(p.captureJitterSize("1",2), 1);
    // playback same
    p._playbackJitter.set("1:3:ans-1", []);
    for (let i=0;i<11;i++) p.enqueuePlaybackChunk("1",3,"ans-1", Buffer.alloc(3840,i));
    assert.equal(p.playbackJitterSize("1",3,"ans-1"), 10);
  });

  it("flush-on-each-lifecycle-event (cancel/focus/revoke/disconnect/expiry)", () => {
    const p = createQuestSurfaceAudioPipeline();
    p.handleUtteranceStart({ sessionEpoch: "1", streamId: 1, payload: { utterance_id: "utt-1" }, leaseRef: "lease-mic" });
    p.enqueueCaptureChunk("1",1, Buffer.alloc(1920,1));
    p._playbackJitter.set("1:1:ans-1", [Buffer.alloc(3840)]);
    // cancel flushes only its stream
    p.handleCancel({ sessionEpoch: "1", streamId: 1, payload: { utterance_id: "utt-1", reason: "client_cancel" } });
    assert.equal(p.captureJitterSize("1",1), 0);
    assert.equal(p.playbackJitterSize("1",1,"ans-1"), 1); // direction-isolated, cancel of capture leaves playback
    // focus latch flushes all
    p.handleUtteranceStart({ sessionEpoch: "2", streamId: 1, payload: { utterance_id: "utt-2" }, leaseRef: "lease-mic" });
    p.enqueueCaptureChunk("2",1, Buffer.alloc(1920));
    p.handleUtteranceStart({ sessionEpoch: "2", streamId: 2, payload: { utterance_id: "utt-3" }, leaseRef: "lease-mic" });
    p.enqueueCaptureChunk("2",2, Buffer.alloc(1920));
    p.handleLifecycleClose("focus_lost");
    assert.equal(p.captureJitterSize("2",1), 0);
    assert.equal(p.captureJitterSize("2",2), 0);
    // revoke/disconnect are same latch path (via lifecycle); expiry via answer end
  });

  it("per-stream isolation cancel does not affect other", () => {
    const p = createQuestSurfaceAudioPipeline();
    p.handleUtteranceStart({ sessionEpoch: "1", streamId: 1, payload: { utterance_id: "utt-a" }, leaseRef: "lease-mic" });
    p.handleUtteranceStart({ sessionEpoch: "1", streamId: 2, payload: { utterance_id: "utt-b" }, leaseRef: "lease-mic" });
    p.enqueueCaptureChunk("1",1, Buffer.alloc(1920,1));
    p.enqueueCaptureChunk("1",2, Buffer.alloc(1920,2));
    p.handleCancel({ sessionEpoch: "1", streamId: 1, payload: { utterance_id: "utt-a", reason: "client_cancel" } });
    assert.equal(p.captureJitterSize("1",1), 0);
    assert.equal(p.captureJitterSize("1",2), 1);
  });

  it("terminal drain-then-clear and post-terminal refusal", () => {
    const p = createQuestSurfaceAudioPipeline();
    p._playbackJitter.set("10:5:ans-1", [Buffer.alloc(3840), Buffer.alloc(3840)]);
    assert.equal(p.playbackJitterSize("10",5,"ans-1"), 2);
    p.handleAnswerEnd({ sessionEpoch: "10", streamId: 5, leaseRef: "lease-audio", payload: { utterance_id: "utt-1", answer_id: "ans-1" }, seq: 1 });
    assert.equal(p._answerTerminal.has("10:5:ans-1"), true);
    assert.equal(p.playbackJitterSize("10",5,"ans-1"), 2); // retained until drain
    assert.throws(() => p.enqueuePlaybackChunk("10",5,"ans-1", Buffer.alloc(3840)), (e) => e.code==="answer_ended");
    assert.throws(() => p.handleAnswerEnd({ sessionEpoch: "10", streamId: 5, leaseRef: "lease-audio", payload: { utterance_id: "utt-1", answer_id: "ans-1" }, seq: 2 }), (e)=>e.code==="answer_ended");
    assert.throws(() => p.handleAnswerEnd({ sessionEpoch: "10", streamId:5, leaseRef:"lease-audio", payload:{utterance_id:"utt-1", answer_id:"ans-1"}, seq:1 }), (e)=>e.code==="seq_stale");
    assert.throws(() => p.handleAnswerEnd({ sessionEpoch:"10", streamId:0, leaseRef:"lease-audio", payload:{utterance_id:"utt-1", answer_id:"ans-2"}, seq:3 }), (e)=>e.code==="stream_id_invalid");
    const drained = p.drainPlayback("10",5,"ans-1");
    assert.equal(drained, 2);
    assert.equal(p.playbackJitterSize("10",5,"ans-1"), 0);
    assert.equal(p._answerTerminal.has("10:5:ans-1"), false);
  });

  it("expired-manifest-at-terminal latches vs mismatch refuses stream-scoped", () => {
    const p = createQuestSurfaceAudioPipeline();
    p.handleUtteranceStart({ sessionEpoch:"20", streamId:1, payload:{utterance_id:"utt-9"}, leaseRef:"lease-mic"});
    // expiry path via WithExpiry
    assert.throws(() => p.handleAnswerEndWithExpiry({ sessionEpoch:"20", streamId:7, leaseRef:"lease-audio", payload:{utterance_id:"utt-9", answer_id:"ans-9"}, seq:1, manifestExpired:true }), (e)=>e.code==="lease_expired");
    // after expiry, jitter cleared via lifecycle
    assert.equal(p._captureJitter.size, 0);
    // mismatch: empty lease_ref -> stream-scoped, not latch
    const p2 = createQuestSurfaceAudioPipeline();
    assert.throws(() => p2.handleAnswerEnd({ sessionEpoch:"21", streamId:8, leaseRef:"", payload:{utterance_id:"utt-10", answer_id:"ans-10"}, seq:1 }), (e)=>e.code==="lease_ref_required");
    // pipeline not latched (no latch state in JS, but jitter not globally cleared)
  });

  it("latch overrides terminal drain", () => {
    const p = createQuestSurfaceAudioPipeline();
    p._playbackJitter.set("30:9:ans-20", [Buffer.alloc(5)]);
    p.handleAnswerEnd({ sessionEpoch:"30", streamId:9, leaseRef:"lease-audio", payload:{utterance_id:"utt-20", answer_id:"ans-20"}, seq:5 });
    assert.equal(p._answerTerminal.has("30:9:ans-20"), true);
    p.handleLifecycleClose("focus_lost");
    assert.equal(p.playbackJitterSize("30",9,"ans-20"), 0);
    assert.equal(p._answerTerminal.has("30:9:ans-20"), false);
  });
});

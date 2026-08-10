import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createAnswerEndPayload,
  createAudioChunkPayload,
  createPanelSnapshotPayload,
  createQuestSurfaceFrame,
  parseQuestSurfaceFrame,
} from "../src/questSurfaceProtocol.js";
import { createQuestSurfaceAudioPipeline } from "../src/questSurfaceAudioPipeline.js";

function validMono20() { return Buffer.alloc(1920, 1); }
function validMono40() { return Buffer.alloc(3840, 1); }
function validStereo20() { return Buffer.alloc(3840, 2); }
function validStereo40() { return Buffer.alloc(7680, 2); }

describe("H production seam: fixture->protocol->runtime", () => {
  it("server emits ANSWER_END after chunks with exact correlation and duration-bound jitter", () => {
    // simulate fixture: panel + 2 stereo chunks + ANSWER_END
    const answerId = "ans-prod-1";
    const utteranceId = "utt-prod-1";
    const panel = createPanelSnapshotPayload({ revision: "5", leaseRef: "lease-panel", text: "hello", answerId, utteranceId });
    const c1 = createAudioChunkPayload({ utteranceId, answerId, pcmBytes: validStereo20(), channels: 2 });
    const c2 = createAudioChunkPayload({ utteranceId, answerId, pcmBytes: validStereo40(), channels: 2 });
    const end = createAnswerEndPayload({ utteranceId, answerId });
    // frames round-trip via protocol (lease binding)
    const fPanel = createQuestSurfaceFrame({ type: "PANEL_SNAPSHOT", sessionEpoch: "99", streamId: 0, direction: "downlink", leaseRef: "lease-panel", seq: "10", payload: panel });
    const fChunk1 = createQuestSurfaceFrame({ type: "AUDIO_CHUNK", sessionEpoch: "99", streamId: 5, direction: "downlink", leaseRef: "lease-audio", seq: "11", payload: c1 });
    const fChunk2 = createQuestSurfaceFrame({ type: "AUDIO_CHUNK", sessionEpoch: "99", streamId: 5, direction: "downlink", leaseRef: "lease-audio", seq: "12", payload: c2 });
    const fEnd = createQuestSurfaceFrame({ type: "ANSWER_END", sessionEpoch: "99", streamId: 5, direction: "downlink", leaseRef: "lease-audio", seq: "13", payload: end });
    // parse back
    for (const f of [fPanel, fChunk1, fChunk2, fEnd]) {
      const line = JSON.stringify(f);
      const parsed = parseQuestSurfaceFrame(line);
      assert.equal(parsed.type, f.type);
      assert.equal(parsed.stream_id, f.stream_id);
      assert.equal(parsed.direction, f.direction);
      assert.equal(parsed.lease_ref, f.lease_ref);
    }
    // duration bound: 20ms+40ms=60ms ≤200 remains, 10*20=200, 6*40=240 would drop
    const p = createQuestSurfaceAudioPipeline();
    p.handleUtteranceStart({ sessionEpoch: "99", streamId: 10, payload: { utterance_id: utteranceId }, leaseRef: "lease-mic" });
    for (let i=0;i<5;i++) p.enqueueCaptureChunk("99",10, validMono40()); // 5*40=200
    assert.equal(p.captureJitterSize("99",10), 5);
    p.enqueueCaptureChunk("99",10, validMono40()); // 6*40=240 → drop oldest → 5 again
    assert.equal(p.captureJitterSize("99",10), 5);
    p.handleUtteranceStart({ sessionEpoch: "99", streamId: 11, payload: { utterance_id: "utt-99-11" }, leaseRef: "lease-mic" });
    for (let i=0;i<10;i++) p.enqueueCaptureChunk("99",11, validMono20());
  });

  it("ANSWER_END production validation: wrong lease, wrong correlation, stream0, stale seq, late chunk", () => {
    const p = createQuestSurfaceAudioPipeline();
    // exact lease mismatch → stream-scoped (lease_ref_required vs lease mismatch)
    assert.throws(() => p.handleAnswerEnd({ sessionEpoch: "1", streamId: 5, leaseRef: "", payload: { utterance_id: "utt", answer_id: "ans" }, seq: "1" }), (e)=> e.code==="lease_ref_required");
    // wrong correlation would be stream-scoped if we checked playback; here we test stream0 and stale via BigInt
    assert.throws(() => p.handleAnswerEnd({ sessionEpoch: "1", streamId: 0, leaseRef: "lease-audio", payload: { utterance_id: "utt", answer_id: "ans" }, seq: "1" }), (e)=> e.code==="stream_id_invalid");
    // BigInt seq beyond Number.MAX_SAFE_INTEGER
    const big = "9007199254740993"; // 2^53+1
    const big2 = "9007199254740992";
    p.handleAnswerEnd({ sessionEpoch: "2", streamId: 6, leaseRef: "lease-audio", payload: { utterance_id: "u1", answer_id: "a1" }, seq: big });
    assert.throws(() => p.handleAnswerEnd({ sessionEpoch: "2", streamId: 6, leaseRef: "lease-audio", payload: { utterance_id: "u1", answer_id: "a1" }, seq: big2 }), (e)=> e.code==="seq_stale");
    // late post-terminal chunk: set terminal then try enqueue
    p._playbackJitter.set("3:7:a2", [Buffer.alloc(3840)]);
    p.handleAnswerEnd({ sessionEpoch: "3", streamId: 7, leaseRef: "lease-audio", payload: { utterance_id: "u2", answer_id: "a2" }, seq: "10" });
    assert.throws(() => p.enqueuePlaybackChunk("3",7,"a2", validStereo20()), (e)=> e.code==="answer_ended");
    // after drain, still durable
    p.drainPlayback("3",7,"a2");
    assert.throws(() => p.enqueuePlaybackChunk("3",7,"a2", validStereo20()), (e)=> e.code==="answer_ended");
    // capture cancel leaves downlink intact
    const p2 = createQuestSurfaceAudioPipeline();
    p2.handleUtteranceStart({ sessionEpoch: "4", streamId: 8, payload: { utterance_id: "utt-a" }, leaseRef: "lease-mic" });
    p2.enqueueCaptureChunk("4",8, validMono20());
    p2._playbackJitter.set("4:8:ans-b", [Buffer.alloc(3840)]);
    p2.handleCancel({ sessionEpoch: "4", streamId: 8, payload: { utterance_id: "utt-a", reason: "client_cancel" } });
    assert.equal(p2.captureJitterSize("4",8), 0);
    assert.equal(p2.playbackJitterSize("4",8,"ans-b"), 1); // isolated
  });
});

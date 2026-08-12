import assert from "node:assert/strict";
import test from "node:test";

import {
  createAudioChunkPayload,
  QUEST_SURFACE_AUDIO_UPLINK_BYTES,
  QUEST_SURFACE_AUDIO_PLAYBACK_BYTES,
} from "../src/questSurfaceProtocol.js";
import { createQuestSurfaceAudioPipeline } from "../src/questSurfaceAudioPipeline.js";
import { QuestSurfaceMicLatch } from "../src/questSurfaceMicLatch.js";

function voicedPcm() {
  // S16LE with energy > threshold: fill with 0x7fff samples
  const buf = Buffer.alloc(QUEST_SURFACE_AUDIO_UPLINK_BYTES, 0);
  for (let i = 0; i < buf.length; i += 2) buf.writeInt16LE(1000, i);
  return buf;
}
function silencePcm() {
  return Buffer.alloc(QUEST_SURFACE_AUDIO_UPLINK_BYTES, 0);
}

test("v1b acceptance positive: on->ask->paired answer->off->nothing persists", async () => {
  const events = [];
  const pipeline = createQuestSurfaceAudioPipeline({
    transcribe: async (pcm, uid) => `transcript:${uid}`,
    chat: async (transcript, uid, answerId) => `Answer to: ${transcript}`,
    synthesize: async (text, answerId, uid) => [Buffer.alloc(QUEST_SURFACE_AUDIO_PLAYBACK_BYTES, 0x11)],
    panelBase: { surface_id: "panel.main" },
    leaseRefFor: () => "lease-panel",
    nextRevision: (() => { let r = 1n; return () => (++r).toString(10); })(),
    eventSink: (e) => events.push(e),
  });

  const epoch = "99";
  const streamId = 1;
  const utteranceId = "utt-positive-1";
  const leaseRef = "lease-mic";

  pipeline.handleUtteranceStart({ sessionEpoch: epoch, streamId, payload: { utterance_id: utteranceId }, leaseRef });
  const chunk = createAudioChunkPayload({ utteranceId, pcmBytes: voicedPcm(), channels: 1 });
  pipeline.handleAudioChunk({ sessionEpoch: epoch, streamId, payload: chunk });
  const result = await pipeline.handleUtteranceEnd({ sessionEpoch: epoch, streamId, payload: { utterance_id: utteranceId } });

  assert.equal(result.dropped, false);
  assert.equal(result.utteranceId, utteranceId);
  assert.match(result.answerId, /^ans-/);
  assert.equal(result.transcript, `transcript:${utteranceId}`);
  assert.equal(result.answerText, `Answer to: transcript:${utteranceId}`);
  // panel revision and playback pairing
  assert.equal(result.panelPayload.document_b64.length > 0, true);
  const panelDoc = JSON.parse(Buffer.from(result.panelPayload.document_b64, "base64").toString("utf8"));
  assert.equal(panelDoc.revision, result.revision);
  assert.equal(panelDoc.surface.resource.text, result.answerText);
  assert.equal(result.ttsChunks.length, 1);
  assert.equal(result.ttsChunks[0].answer_id, result.answerId);
  assert.equal(result.ttsChunks[0].utterance_id, utteranceId);
  assert.equal(result.ttsChunks[0].channels, 2);
  // provenance paired
  assert.ok(events.some((e) => e.event_type === "quest.surface.answer_paired" && e.answer_id === result.answerId));

  // off -> nothing persists: lifecycle close clears buffers
  pipeline.handleUtteranceStart({ sessionEpoch: epoch, streamId: streamId + 1, payload: { utterance_id: "utt-2" }, leaseRef });
  pipeline.handleAudioChunk({ sessionEpoch: epoch, streamId: streamId + 1, payload: createAudioChunkPayload({ utteranceId: "utt-2", pcmBytes: voicedPcm(), channels: 1 }) });
  const cleared = pipeline.handleLifecycleClose("focus_lost");
  assert.equal(cleared.length, 1);
  assert.equal(pipeline.getRemainingBufferBytes(), 0);
  assert.equal(pipeline.getActiveUtterance(epoch, streamId + 1), null);
});

test("VAD: silence-only utterance is dropped, no panel/playback", async () => {
  const pipeline = createQuestSurfaceAudioPipeline({
    eventSink: () => {},
  });
  pipeline.handleUtteranceStart({ sessionEpoch: "1", streamId: 1, payload: { utterance_id: "utt-silence" }, leaseRef: "lease-mic" });
  const silent = createAudioChunkPayload({ utteranceId: "utt-silence", pcmBytes: silencePcm(), channels: 1 });
  pipeline.handleAudioChunk({ sessionEpoch: "1", streamId: 1, payload: silent });
  pipeline.handleAudioChunk({ sessionEpoch: "1", streamId: 1, payload: silent });
  const result = await pipeline.handleUtteranceEnd({ sessionEpoch: "1", streamId: 1, payload: { utterance_id: "utt-silence" } });
  assert.equal(result.dropped, true);
  assert.equal(result.reason, "vad_silence_only");
  assert.equal(result.answerId, "");
  assert.equal(pipeline.getRemainingBufferBytes(), 0);
});

test("mic latch: focus loss latches and requires deliberate fresh-epoch explicit resume", async () => {
  const latch = new QuestSurfaceMicLatch({ resumeHandle: "resume-ep-1" });
  assert.equal(latch.isLatched(), false);
  latch.latch("focus_lost", "98", Date.now(), "ep-1");
  assert.equal(latch.isLatched(), true);
  assert.equal(latch.deliberateResume({ freshEpoch: "0", resumeHandle: "resume-ep-1", currentEpisodeId: "ep-1", explicit: true }), false);
  assert.equal(latch.deliberateResume({ freshEpoch: "99", resumeHandle: "wrong", currentEpisodeId: "ep-1", explicit: true }), false);
  assert.equal(latch.deliberateResume({ freshEpoch: "99", resumeHandle: "resume-ep-1", currentEpisodeId: "wrong", explicit: true }), false);
  assert.equal(latch.deliberateResume({ freshEpoch: "99", resumeHandle: "resume-ep-1", currentEpisodeId: "ep-1", explicit: false }), false);
  assert.equal(latch.isLatched(), true);
  assert.equal(latch.deliberateResume({ freshEpoch: "99", resumeHandle: "resume-ep-1", currentEpisodeId: "ep-1", explicit: true }), true);
  assert.equal(latch.isLatched(), false);

  // pipeline lifecycle also clears
  const pipeline = createQuestSurfaceAudioPipeline({ eventSink: () => {} });
  pipeline.handleUtteranceStart({ sessionEpoch: "1", streamId: 5, payload: { utterance_id: "utt-latch" }, leaseRef: "lease-mic" });
  pipeline.handleAudioChunk({ sessionEpoch: "1", streamId: 5, payload: createAudioChunkPayload({ utteranceId: "utt-latch", pcmBytes: voicedPcm(), channels: 1 }) });
  const cleared = pipeline.handleLifecycleClose("focus_lost");
  assert.equal(cleared[0].utteranceId, "utt-latch");
  assert.equal(pipeline.getRemainingBufferBytes(), 0);
});

test("stream isolation: cancel and failure on one stream does not affect another", async () => {
  const pipeline = createQuestSurfaceAudioPipeline({ eventSink: () => {}, leaseRefFor: () => "lease-panel" });
  pipeline.handleUtteranceStart({ sessionEpoch: "10", streamId: 1, payload: { utterance_id: "utt-a" }, leaseRef: "lease-mic" });
  pipeline.handleUtteranceStart({ sessionEpoch: "10", streamId: 2, payload: { utterance_id: "utt-b" }, leaseRef: "lease-mic" });
  pipeline.handleAudioChunk({ sessionEpoch: "10", streamId: 1, payload: createAudioChunkPayload({ utteranceId: "utt-a", pcmBytes: voicedPcm(), channels: 1 }) });
  pipeline.handleAudioChunk({ sessionEpoch: "10", streamId: 2, payload: createAudioChunkPayload({ utteranceId: "utt-b", pcmBytes: voicedPcm(), channels: 1 }) });

  // cancel only stream 1
  const c1 = pipeline.handleCancel({ sessionEpoch: "10", streamId: 1, payload: { utterance_id: "utt-a", reason: "client_cancel" } });
  assert.equal(c1.cancelled, true);
  assert.equal(pipeline.getActiveUtterance("10", 1), null);
  assert.notEqual(pipeline.getActiveUtterance("10", 2), null);

  // cancel with wrong utteranceId on stream 2 is no-op
  const c2 = pipeline.handleCancel({ sessionEpoch: "10", streamId: 2, payload: { utterance_id: "wrong", reason: "client_cancel" } });
  assert.equal(c2.cancelled, false);
  assert.notEqual(pipeline.getActiveUtterance("10", 2), null);

  // complete stream 2 still works
  const result = await pipeline.handleUtteranceEnd({ sessionEpoch: "10", streamId: 2, payload: { utterance_id: "utt-b" } });
  assert.equal(result.dropped, false);
  assert.equal(result.utteranceId, "utt-b");
  assert.equal(pipeline.getActiveUtterance("10", 2), null);
});

test("limits and negatives: wrong lease, utterance mismatch, too-long", async () => {
  const pipeline = createQuestSurfaceAudioPipeline({ eventSink: () => {} });
  pipeline.handleUtteranceStart({ sessionEpoch: "1", streamId: 1, payload: { utterance_id: "utt-1" }, leaseRef: "lease-mic" });
  // second start on same stream should fail
  assert.throws(() => pipeline.handleUtteranceStart({ sessionEpoch: "1", streamId: 1, payload: { utterance_id: "utt-2" }, leaseRef: "lease-mic" }), (e) => e.code === "utterance_already_active");
  // wrong utterance_id on chunk
  const badChunk = createAudioChunkPayload({ utteranceId: "utt-wrong", pcmBytes: voicedPcm(), channels: 1 });
  assert.throws(() => pipeline.handleAudioChunk({ sessionEpoch: "1", streamId: 1, payload: badChunk }), (e) => e.code === "utterance_id_mismatch");
  // end with wrong id
  await assert.rejects(() => pipeline.handleUtteranceEnd({ sessionEpoch: "1", streamId: 1, payload: { utterance_id: "utt-wrong" } }), (e) => e.code === "utterance_id_mismatch");

  // too-long: push max+1 chunks
  const p2 = createQuestSurfaceAudioPipeline({ eventSink: () => {} });
  p2.handleUtteranceStart({ sessionEpoch: "2", streamId: 1, payload: { utterance_id: "utt-long" }, leaseRef: "lease-mic" });
  for (let i = 0; i < 1500; i++) {
    p2.handleAudioChunk({ sessionEpoch: "2", streamId: 1, payload: createAudioChunkPayload({ utteranceId: "utt-long", pcmBytes: voicedPcm(), channels: 1 }) });
  }
  assert.throws(() => p2.handleAudioChunk({ sessionEpoch: "2", streamId: 1, payload: createAudioChunkPayload({ utteranceId: "utt-long", pcmBytes: voicedPcm(), channels: 1 }) }), (e) => e.code === "utterance_too_long");
});

test("local-only: no persistence, buffers cleared after each utterance", async () => {
  const pipeline = createQuestSurfaceAudioPipeline({ eventSink: () => {}, leaseRefFor: () => "lease-panel" });
  pipeline.handleUtteranceStart({ sessionEpoch: "5", streamId: 1, payload: { utterance_id: "utt-persist" }, leaseRef: "lease-mic" });
  pipeline.handleAudioChunk({ sessionEpoch: "5", streamId: 1, payload: createAudioChunkPayload({ utteranceId: "utt-persist", pcmBytes: voicedPcm(), channels: 1 }) });
  await pipeline.handleUtteranceEnd({ sessionEpoch: "5", streamId: 1, payload: { utterance_id: "utt-persist" } });
  assert.equal(pipeline.getRemainingBufferBytes(), 0);
  // no durable state leaked
  assert.equal(pipeline._streams.size, 1);
  assert.equal(pipeline._streams.get("5:1"), null);
});

test("answer_id pairing: panel and each playback chunk share same answer_id and utterance_id", async () => {
  const pipeline = createQuestSurfaceAudioPipeline({
    transcribe: async (pcm, uid) => "hello",
    chat: async () => "paired answer",
    synthesize: async (text, answerId, uid) => [
      Buffer.alloc(QUEST_SURFACE_AUDIO_PLAYBACK_BYTES, 0x22),
      Buffer.alloc(QUEST_SURFACE_AUDIO_PLAYBACK_BYTES, 0x33),
    ],
    leaseRefFor: () => "lease-panel",
  });
  pipeline.handleUtteranceStart({ sessionEpoch: "7", streamId: 3, payload: { utterance_id: "utt-pair" }, leaseRef: "lease-mic" });
  pipeline.handleAudioChunk({ sessionEpoch: "7", streamId: 3, payload: createAudioChunkPayload({ utteranceId: "utt-pair", pcmBytes: voicedPcm(), channels: 1 }) });
  const r = await pipeline.handleUtteranceEnd({ sessionEpoch: "7", streamId: 3, payload: { utterance_id: "utt-pair" } });
  assert.equal(r.ttsChunks.length, 2);
  for (const c of r.ttsChunks) {
    assert.equal(c.answer_id, r.answerId);
    assert.equal(c.utterance_id, "utt-pair");
  }
});

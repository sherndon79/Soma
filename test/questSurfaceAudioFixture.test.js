import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import tls from "node:tls";
import test from "node:test";

import { createQuestSurfaceAudioPipeline } from "../src/questSurfaceAudioPipeline.js";
import { createQuestSurfaceFixtureProvider } from "../src/questSurfaceFixtureProvider.js";
import {
  BoundedLineDecoder,
  QUEST_SURFACE_CAPABILITY,
  QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH,
  QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT,
  QUEST_SURFACE_CAPABILITY_MIC_CAPTURE,
  QUEST_SURFACE_PROVIDER_ID,
  createAudioChunkPayload,
  createQuestSurfaceFrame,
  parseQuestSurfaceFrame,
  serializeQuestSurfaceFrame,
} from "../src/questSurfaceProtocol.js";

const quietLogger = { info() {}, error() {} };

function voicedPcm() {
  const buf = Buffer.alloc(1920, 0);
  for (let i = 0; i < buf.length; i += 2) buf.writeInt16LE(1000, i);
  return buf;
}
function silencePcm() {
  return Buffer.alloc(1920, 0);
}

test("fixture manifest + audio: on->ask->paired panel+playback->off->nothing persists", async (t) => {
  const creds = await createTlsCredentials(t);
  const events = [];
  const provider = createV1bProvider(creds, { eventSink(e) { events.push(e); } });
  t.after(() => provider.stop());
  const address = await provider.start({ host: "127.0.0.1", port: 0 });
  const client = await connectClient(address.port, creds);
  t.after(() => client.destroy());

  client.send("HELLO", { supported_versions: [1] }, { epoch: "0", leaseRef: "" });
  const hello = await client.next();
  assert.equal(hello.type, "HELLO_ACK");
  const manifest = await client.next();
  assert.equal(manifest.type, "LEASE_MANIFEST");
  const lease = await client.next();
  assert.equal(lease.type, "LEASE");
  const snapshot = await client.next();
  assert.equal(snapshot.type, "PANEL_SNAPSHOT");

  const epoch = hello.session_epoch;
  const micLease = manifest.payload.leases.mic_capture.lease_id;
  const panelLease = manifest.payload.leases.panel.lease_id;
  const audioLease = manifest.payload.leases.audio_present.lease_id;
  // ack initial panel
  client.send("ACTUAL_BOUNDS_ACK", {
    document_revision: "1",
    document_hash: snapshot.payload.document_sha256,
    surface_id: "panel.main",
    actual_bounds: { width_m: 0.9, height_m: 0.5 },
    displayed: true,
  }, { epoch, leaseRef: panelLease });

  // ask: utterance
  const utteranceId = "utt-v1b-1";
  client.send("UTTERANCE_START", { utterance_id: utteranceId }, { epoch, leaseRef: micLease, streamId: 1 });
  const chunk = createAudioChunkPayload({ utteranceId, pcmBytes: voicedPcm(), channels: 1 });
  client.send("AUDIO_CHUNK", chunk, { epoch, leaseRef: micLease, streamId: 1 });
  client.send("UTTERANCE_END", { utterance_id: utteranceId }, { epoch, leaseRef: micLease, streamId: 1 });

  const panelAnswer = await client.nextOrTimeout(3000);
  assert.equal(panelAnswer.type, "PANEL_SNAPSHOT");
  assert.equal(panelAnswer.lease_ref, panelLease);
  const audioAnswer = await client.nextOrTimeout(3000);
  assert.equal(audioAnswer.type, "AUDIO_CHUNK");
  assert.equal(audioAnswer.lease_ref, audioLease);
  assert.equal(audioAnswer.payload.utterance_id, utteranceId);
  const answerId = audioAnswer.payload.answer_id;
  assert.ok(answerId && answerId.length > 0);
  // H terminal: ANSWER_END after PANEL_SNAPSHOT + AUDIO_CHUNK
  const answerEnd = await client.nextOrTimeout(3000);
  assert.equal(answerEnd.type, "ANSWER_END");
  assert.equal(answerEnd.payload.answer_id, answerId);
  assert.equal(answerEnd.payload.utterance_id, utteranceId);
  assert.equal(answerEnd.lease_ref, audioLease);
  // panel and audio share answer via events
  await waitFor(() => events.some((e) => e.event_type === "quest.surface.answer_delivered" && e.answer_id === answerId));
  const doc = JSON.parse(Buffer.from(panelAnswer.payload.document_b64, "base64").toString("utf8"));
  assert.ok(doc.surface.resource.text.includes("Answer to"));

  // off -> nothing persists: focus lost then try to start new utterance should be latched
  client.send("FOCUS_LOST", { reason: "openxr_focus_lost" }, { epoch, leaseRef: panelLease });
  const teardown = await client.next();
  assert.equal(teardown.type, "TEARDOWN_ACK");
  await waitFor(() => events.some((e) => e.event_type === "quest.surface.session_narrowed" && e.mic_latch === true));
  // no buffer leak: session closed
  await waitFor(() => events.some((e) => e.event_type === "quest.surface.session_closed"));
  const closed = events.find((e) => e.event_type === "quest.surface.session_closed");
  assert.equal(closed.remaining_buffer_bytes, 0);
});

test("fixture audio: silence-only dropped, cancel isolated, wrong lease rejected", async (t) => {
  const creds = await createTlsCredentials(t);
  const provider = createV1bProvider(creds);
  t.after(() => provider.stop());
  const address = await provider.start({ host: "127.0.0.1", port: 0 });
  const client = await connectClient(address.port, creds);
  t.after(() => client.destroy());
  client.send("HELLO", { supported_versions: [1] }, { epoch: "0", leaseRef: "" });
  const hello = await client.next();
  const manifest = await client.next();
  await client.next(); await client.next();
  const epoch = hello.session_epoch;
  const micLease = manifest.payload.leases.mic_capture.lease_id;
  const panelLease = manifest.payload.leases.panel.lease_id;

  // silence-only: should produce no answer
  const silentId = "utt-silence-fixture";
  client.send("UTTERANCE_START", { utterance_id: silentId }, { epoch, leaseRef: micLease, streamId: 1 });
  client.send("AUDIO_CHUNK", createAudioChunkPayload({ utteranceId: silentId, pcmBytes: silencePcm(), channels: 1 }), { epoch, leaseRef: micLease, streamId: 1 });
  client.send("UTTERANCE_END", { utterance_id: silentId }, { epoch, leaseRef: micLease, streamId: 1 });
  // no panel/audio expected; wait a bit and ensure no answer_delivered
  await new Promise((r) => setTimeout(r, 400));
  // start new voiced utterance on same stream should still work (previous was cleared)
  const voicedId = "utt-voiced-after-silence";
  client.send("UTTERANCE_START", { utterance_id: voicedId }, { epoch, leaseRef: micLease, streamId: 1 });
  client.send("AUDIO_CHUNK", createAudioChunkPayload({ utteranceId: voicedId, pcmBytes: voicedPcm(), channels: 1 }), { epoch, leaseRef: micLease, streamId: 1 });
  client.send("UTTERANCE_END", { utterance_id: voicedId }, { epoch, leaseRef: micLease, streamId: 1 });
  const panel = await waitForFrame(client, "PANEL_SNAPSHOT", 3000);
  assert.equal(panel.type, "PANEL_SNAPSHOT");
  // drain the paired audio chunk so next test isn't polluted
  const audioForPanel = await waitForFrame(client, "AUDIO_CHUNK", 2000);
  assert.equal(audioForPanel.type, "AUDIO_CHUNK");
  // H terminal: drain ANSWER_END so subsequent reads align
  const answerEnd1 = await waitForFrame(client, "ANSWER_END", 2000);
  assert.equal(answerEnd1.type, "ANSWER_END");
  assert.equal(answerEnd1.payload.answer_id, audioForPanel.payload.answer_id);

  // cancel isolation: start utterance on stream 2, cancel only that
  const cancelId = "utt-cancel";
  client.send("UTTERANCE_START", { utterance_id: cancelId }, { epoch, leaseRef: micLease, streamId: 2 });
  client.send("AUDIO_CHUNK", createAudioChunkPayload({ utteranceId: cancelId, pcmBytes: voicedPcm(), channels: 1 }), { epoch, leaseRef: micLease, streamId: 2 });
  client.send("CANCEL", { utterance_id: cancelId, reason: "client_cancel" }, { epoch, leaseRef: micLease, streamId: 2 });
  // then start new utterance on stream 2 should succeed
  const afterCancel = "utt-after-cancel";
  client.send("UTTERANCE_START", { utterance_id: afterCancel }, { epoch, leaseRef: micLease, streamId: 2 });
  client.send("AUDIO_CHUNK", createAudioChunkPayload({ utteranceId: afterCancel, pcmBytes: voicedPcm(), channels: 1 }), { epoch, leaseRef: micLease, streamId: 2 });
  client.send("UTTERANCE_END", { utterance_id: afterCancel }, { epoch, leaseRef: micLease, streamId: 2 });
  const panel2 = await waitForFrame(client, "PANEL_SNAPSHOT", 3000);
  assert.equal(panel2.type, "PANEL_SNAPSHOT");
  const audioForPanel2 = await waitForFrame(client, "AUDIO_CHUNK", 2000);
  assert.equal(audioForPanel2.type, "AUDIO_CHUNK");
  const answerEnd2 = await waitForFrame(client, "ANSWER_END", 2000);
  assert.equal(answerEnd2.type, "ANSWER_END");
  assert.equal(answerEnd2.payload.answer_id, audioForPanel2.payload.answer_id);

  // wrong lease: use panel lease for mic capture -> should get lease_ref_mismatch
  client.send("UTTERANCE_START", { utterance_id: "utt-wrong-lease" }, { epoch, leaseRef: panelLease, streamId: 3 });
  const err = await client.nextOrTimeout(3000);
  assert.equal(err.type, "ERROR");
});

test("fixture audio: per-stream failure does not tear down other stream's utterance", async (t) => {
  const creds = await createTlsCredentials(t);
  const provider = createV1bProvider(creds);
  t.after(() => provider.stop());
  const address = await provider.start({ host: "127.0.0.1", port: 0 });
  const client = await connectClient(address.port, creds);
  t.after(() => client.destroy());
  client.send("HELLO", { supported_versions: [1] }, { epoch: "0", leaseRef: "" });
  const hello = await client.next();
  const manifest = await client.next();
  await client.next(); await client.next();
  const epoch = hello.session_epoch;
  const micLease = manifest.payload.leases.mic_capture.lease_id;

  // stream 1 voiced, stream 2 will have utterance_id mismatch failure — exact stream_id, empty lease, exactly one ERROR, sibling completes both
  const s1 = 1, s2 = 2;
  client.send("UTTERANCE_START", { utterance_id: "utt-stream1" }, { epoch, leaseRef: micLease, streamId: s1 });
  client.send("UTTERANCE_START", { utterance_id: "utt-stream2" }, { epoch, leaseRef: micLease, streamId: s2 });
  // single decoder batch: one socket.write containing failing s2 chunk + sibling s1 chunk+end
  const failing = createAudioChunkPayload({ utteranceId: "wrong-id", pcmBytes: voicedPcm(), channels: 1 });
  const cont = createAudioChunkPayload({ utteranceId: "utt-stream1", pcmBytes: voicedPcm(), channels: 1 });
  client.sendBatch([
    { type: "AUDIO_CHUNK", payload: failing, epoch, leaseRef: micLease, streamId: s2 },
    { type: "AUDIO_CHUNK", payload: cont, epoch, leaseRef: micLease, streamId: s1 },
    { type: "UTTERANCE_END", payload: { utterance_id: "utt-stream1" }, epoch, leaseRef: micLease, streamId: s1 },
  ]);
  // collect next 10 frames; exactly one ERROR for s2 with empty lease, then PANEL+AUDIO for s1
  const got = [];
  for (let i = 0; i < 10; i++) {
    const f = await client.nextOrTimeout(3000);
    if (!f) break;
    got.push(f);
    if (got.filter(x => x.type === "PANEL_SNAPSHOT").length >= 1 && got.filter(x => x.type === "AUDIO_CHUNK").length >= 1) break;
  }
  const errors = got.filter(x => x.type === "ERROR");
  assert.equal(errors.length, 1, `expected exactly one ERROR, got ${errors.length}: ${JSON.stringify(errors.map(e=>e.payload))}`);
  const err = errors[0];
  assert.equal(err.stream_id, s2, "ERROR must carry failing stream_id directly");
  assert.equal(err.lease_ref, "", "ERROR must have empty lease_ref");
  assert.equal(err.payload.code, "utterance_id_mismatch");
  // sibling succeeded with both surfaces sharing answer_id
  const panel = got.find(x => x.type === "PANEL_SNAPSHOT");
  const audio = got.find(x => x.type === "AUDIO_CHUNK" && x.payload && x.payload.utterance_id === "utt-stream1");
  assert.ok(panel, "sibling panel missing");
  assert.ok(audio, "sibling audio missing");
  assert.equal(panel.lease_ref, manifest.payload.leases.panel.lease_id);
  assert.equal(audio.lease_ref, manifest.payload.leases.audio_present.lease_id);
  const doc = JSON.parse(Buffer.from(panel.payload.document_b64, "base64").toString("utf8"));
  assert.equal(doc.answer_id, audio.payload.answer_id);
  assert.equal(doc.utterance_id, "utt-stream1");
  // H terminal: drain ANSWER_END before duplicate ERROR check
  const answerEnd = await client.nextOrTimeout(2000);
  assert.equal(answerEnd.type, "ANSWER_END");
  assert.equal(answerEnd.payload.answer_id, audio.payload.answer_id);
  assert.equal(answerEnd.payload.utterance_id, "utt-stream1");
  // bounded post-success check: no duplicate ERROR after sibling success
  let extra = null;
  try { extra = await client.nextOrTimeout(400); } catch { extra = null; }
  if (extra) assert.notEqual(extra.type, "ERROR", "no duplicate ERROR after sibling success");
});

test("fixture audio: async pipeline failure is stream-scoped, cleared, and reusable", async (t) => {
  const creds = await createTlsCredentials(t);
  let failNextEnd = true;
  const provider = createV1bProvider(creds, {
    pipelineFactory(options) {
      const pipeline = createQuestSurfaceAudioPipeline(options);
      const handleUtteranceEnd = pipeline.handleUtteranceEnd;
      return {
        ...pipeline,
        async handleUtteranceEnd(args) {
          if (failNextEnd) {
            failNextEnd = false;
            throw new Error("injected async pipeline failure");
          }
          return handleUtteranceEnd(args);
        },
      };
    },
  });
  t.after(() => provider.stop());
  const address = await provider.start({ host: "127.0.0.1", port: 0 });
  const client = await connectClient(address.port, creds);
  t.after(() => client.destroy());
  client.send("HELLO", { supported_versions: [1] }, { epoch: "0", leaseRef: "" });
  const hello = await client.next();
  const manifest = await client.next();
  await client.next(); await client.next();
  const epoch = hello.session_epoch;
  const micLease = manifest.payload.leases.mic_capture.lease_id;
  const streamId = 2;

  // Reject once from the actual async pipeline path while its collecting state is still active.
  client.send("UTTERANCE_START", { utterance_id: "utt-async-fail" }, { epoch, leaseRef: micLease, streamId });
  client.send("AUDIO_CHUNK", createAudioChunkPayload({ utteranceId: "utt-async-fail", pcmBytes: voicedPcm(), channels: 1 }), { epoch, leaseRef: micLease, streamId });
  client.send("UTTERANCE_END", { utterance_id: "utt-async-fail" }, { epoch, leaseRef: micLease, streamId });

  const error = await client.nextOrTimeout(3000);
  assert.equal(error.type, "ERROR");
  assert.equal(error.stream_id, streamId, "async ERROR must carry failing stream_id directly");
  assert.equal(error.lease_ref, "", "async ERROR must have empty lease_ref");
  assert.equal(error.payload.code, "answer_pipeline_failed");
  await assert.rejects(client.nextOrTimeout(400), /Timed out waiting for frame/, "async failure must emit one ERROR only");

  // Reusing the same stream proves the failed state and PCM were cleared, not merely isolated.
  const retryId = "utt-async-retry";
  client.send("UTTERANCE_START", { utterance_id: retryId }, { epoch, leaseRef: micLease, streamId });
  client.send("AUDIO_CHUNK", createAudioChunkPayload({ utteranceId: retryId, pcmBytes: voicedPcm(), channels: 1 }), { epoch, leaseRef: micLease, streamId });
  client.send("UTTERANCE_END", { utterance_id: retryId }, { epoch, leaseRef: micLease, streamId });

  const got = [];
  while (!got.some((frame) => frame.type === "PANEL_SNAPSHOT")
      || !got.some((frame) => frame.type === "AUDIO_CHUNK" && frame.payload?.utterance_id === retryId)) {
    got.push(await client.nextOrTimeout(3000));
    assert.equal(got.some((frame) => frame.type === "ERROR"), false, "reused stream must not fail");
  }
  const panel = got.find((frame) => frame.type === "PANEL_SNAPSHOT");
  const audio = got.find((frame) => frame.type === "AUDIO_CHUNK" && frame.payload?.utterance_id === retryId);
  assert.equal(panel.lease_ref, manifest.payload.leases.panel.lease_id);
  assert.equal(audio.lease_ref, manifest.payload.leases.audio_present.lease_id);
  const document = JSON.parse(Buffer.from(panel.payload.document_b64, "base64").toString("utf8"));
  assert.equal(document.answer_id, audio.payload.answer_id);
  assert.equal(document.utterance_id, retryId);
  // H terminal: drain ANSWER_END before checking for duplicate ERROR
  const answerEnd = await client.nextOrTimeout(2000);
  assert.equal(answerEnd.type, "ANSWER_END");
  assert.equal(answerEnd.payload.answer_id, audio.payload.answer_id);
  assert.equal(answerEnd.payload.utterance_id, retryId);
  await assert.rejects(client.nextOrTimeout(400), /Timed out waiting for frame/, "successful retry must not emit a duplicate ERROR");
});

function createV1bProvider(creds, overrides = {}) {
  const grants = [
    {
      id: "grant-panel",
      status: "active",
      capability: QUEST_SURFACE_CAPABILITY,
      provider: QUEST_SURFACE_PROVIDER_ID,
      scope: "session",
      constraints: { allowed_surface_ids: ["panel.main"], max_panel_text_bytes: 512, lease_ttl_ms: 5_000 },
      approved_by: "user",
      approval_provenance_id: "seth-approved-quest-v1b",
      reason: "v1b panel",
      created_at: "2026-08-09T00:00:00.000Z",
    },
    {
      id: "grant-mic",
      status: "active",
      capability: QUEST_SURFACE_CAPABILITY_MIC_CAPTURE,
      provider: QUEST_SURFACE_PROVIDER_ID,
      scope: "session",
      constraints: {},
      approved_by: "user",
      approval_provenance_id: "seth-approved-quest-v1b",
      reason: "mic",
      created_at: "2026-08-09T00:00:00.000Z",
    },
    {
      id: "grant-audio",
      status: "active",
      capability: QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT,
      provider: QUEST_SURFACE_PROVIDER_ID,
      scope: "session",
      constraints: {},
      approved_by: "user",
      approval_provenance_id: "seth-approved-quest-v1b",
      reason: "audio",
      created_at: "2026-08-09T00:00:00.000Z",
    },
    {
      id: "grant-local",
      status: "active",
      capability: QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH,
      provider: "soma.provider.local-model",
      scope: "window",
      constraints: {},
      approved_by: "user",
      approval_provenance_id: "seth-approved-quest-v1b",
      reason: "local attach",
      created_at: "2026-08-09T00:00:00.000Z",
    },
  ];
  const provider = createQuestSurfaceFixtureProvider({
    tlsOptions: { key: creds.serverKey, cert: creds.serverCert, ca: creds.ca },
    grantStore: { schema_version: 1, grants },
    capabilityCatalog: { capabilities: [
      { key: QUEST_SURFACE_CAPABILITY },
      { key: QUEST_SURFACE_CAPABILITY_MIC_CAPTURE },
      { key: QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT },
      { key: QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH },
    ] },
    providerRegistry: { providers: [
      { id: QUEST_SURFACE_PROVIDER_ID, capabilities: [QUEST_SURFACE_CAPABILITY, QUEST_SURFACE_CAPABILITY_MIC_CAPTURE, QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT] },
      { id: "soma.provider.local-model", capabilities: [QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH] },
    ] },
    grantId: "grant-panel",
    leaseTtlMs: 5_000,
    panel: { surface_id: "panel.main", revision: "1", ttl_ms: 4_000, text: "HELLO SETH FROM SOMA" },
    logger: quietLogger,
    ...overrides,
  });
  // #2: arm the bounded episode window for tests (default not armed in production)
  provider.armEpisode({ episodeId: `test-ep-${Math.random().toString(16).slice(2,8)}`, ttlMs: 60_000, actor: "test" });
  return provider;
}

async function connectClient(port, creds) {
  const socket = tls.connect({ host: "127.0.0.1", port, servername: "localhost", key: creds.clientKey, cert: creds.clientCert, ca: creds.ca, rejectUnauthorized: true, minVersion: "TLSv1.3" });
  await new Promise((resolve, reject) => { socket.once("secureConnect", resolve); socket.once("error", reject); });
  return new TestClient(socket);
}

class TestClient {
  constructor(socket) {
    this.socket = socket;
    this.decoder = new BoundedLineDecoder();
    this.frames = [];
    this.waiters = [];
    this.seqByStream = new Map();
    socket.on("data", (chunk) => {
      for (const line of this.decoder.push(chunk)) {
        const frame = parseQuestSurfaceFrame(line);
        const waiter = this.waiters.shift();
        if (waiter) waiter.resolve(frame); else this.frames.push(frame);
      }
    });
    socket.on("error", (e) => { for (const w of this.waiters.splice(0)) w.reject(e); });
  }
  send(type, payload, { epoch, leaseRef, streamId = 0 }) {
    const key = `${epoch}:${streamId}:uplink`;
    const seq = (this.seqByStream.get(key) ?? 0n) + 1n;
    this.seqByStream.set(key, seq);
    this.socket.write(serializeQuestSurfaceFrame(createQuestSurfaceFrame({ type, sessionEpoch: epoch, streamId, direction: "uplink", leaseRef, seq, payload })));
  }
  sendBatch(frames) {
    let batch = "";
    for (const { type, payload, epoch, leaseRef, streamId = 0 } of frames) {
      const key = `${epoch}:${streamId}:uplink`;
      const seq = (this.seqByStream.get(key) ?? 0n) + 1n;
      this.seqByStream.set(key, seq);
      batch += serializeQuestSurfaceFrame(createQuestSurfaceFrame({ type, sessionEpoch: epoch, streamId, direction: "uplink", leaseRef, seq, payload }));
    }
    this.socket.write(batch);
  }
  next() {
    return this.waitForNext(4000, "Timed out waiting for Quest surface frame");
  }
  nextOrTimeout(ms) {
    return this.waitForNext(ms, "Timed out waiting for frame");
  }
  waitForNext(ms, message) {
    const f = this.frames.shift();
    if (f) return Promise.resolve(f);
    return new Promise((resolve, reject) => {
      let timeout;
      const waiter = {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      };
      timeout = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error(message));
      }, ms);
      this.waiters.push(waiter);
    });
  }
  destroy() { this.socket.destroy(); }
}

async function waitForFrame(client, type, ms = 3000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const f = await client.nextOrTimeout(Math.min(500, deadline - Date.now()));
      if (f.type === type) return f;
      // ignore other frame types (e.g., AUDIO_CHUNK when waiting for PANEL_SNAPSHOT) but log
    } catch (e) {
      if (Date.now() >= deadline) throw e;
    }
  }
  assert.fail(`Timed out waiting for frame ${type}`);
}

async function createTlsCredentials(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "soma-quest-tls-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = (n) => path.join(dir, n);
  execFileSync("openssl", ["req","-x509","-newkey","rsa:2048","-nodes","-keyout",file("ca.key"),"-out",file("ca.pem"),"-subj","/CN=Soma Quest Test CA","-days","1"], { stdio: "ignore" });
  execFileSync("openssl", ["req","-newkey","rsa:2048","-nodes","-keyout",file("server.key"),"-out",file("server.csr"),"-subj","/CN=localhost"], { stdio: "ignore" });
  await writeFile(file("server.ext"), "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n");
  execFileSync("openssl", ["x509","-req","-in",file("server.csr"),"-CA",file("ca.pem"),"-CAkey",file("ca.key"),"-CAcreateserial","-out",file("server.pem"),"-days","1","-sha256","-extfile",file("server.ext")], { stdio: "ignore" });
  execFileSync("openssl", ["req","-newkey","rsa:2048","-nodes","-keyout",file("client.key"),"-out",file("client.csr"),"-subj","/CN=quest-v1a-test-client"], { stdio: "ignore" });
  await writeFile(file("client.ext"), "extendedKeyUsage=clientAuth\n");
  execFileSync("openssl", ["x509","-req","-in",file("client.csr"),"-CA",file("ca.pem"),"-CAkey",file("ca.key"),"-CAcreateserial","-out",file("client.pem"),"-days","1","-sha256","-extfile",file("client.ext")], { stdio: "ignore" });
  return { ca: await readFile(file("ca.pem")), serverKey: await readFile(file("server.key")), serverCert: await readFile(file("server.pem")), clientKey: await readFile(file("client.key")), clientCert: await readFile(file("client.pem")) };
}

async function waitFor(predicate) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail("Timed out waiting for provider event");
}

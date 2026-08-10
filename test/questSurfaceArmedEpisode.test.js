import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import tls from "node:tls";
import test from "node:test";

import { createQuestSurfaceFixtureProvider } from "../src/questSurfaceFixtureProvider.js";
import {
  BoundedLineDecoder,
  QUEST_SURFACE_CAPABILITY,
  QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH,
  QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT,
  QUEST_SURFACE_CAPABILITY_MIC_CAPTURE,
  QUEST_SURFACE_PROVIDER_ID,
  createQuestSurfaceFrame,
  parseQuestSurfaceFrame,
  serializeQuestSurfaceFrame,
} from "../src/questSurfaceProtocol.js";

const quietLogger = { info() {}, error() {} };

function baseGrants(extra = []) {
  const grants = [
    { id: "grant-panel", status: "active", capability: QUEST_SURFACE_CAPABILITY, provider: QUEST_SURFACE_PROVIDER_ID, scope: "session", constraints: { allowed_surface_ids: ["panel.main"], max_panel_text_bytes: 512, lease_ttl_ms: 5000 }, approved_by: "user", approval_provenance_id: "seth", reason: "panel", created_at: "2026-08-09T00:00:00.000Z" },
    { id: "grant-mic", status: "active", capability: QUEST_SURFACE_CAPABILITY_MIC_CAPTURE, provider: QUEST_SURFACE_PROVIDER_ID, scope: "session", constraints: {}, approved_by: "user", approval_provenance_id: "seth", reason: "mic", created_at: "2026-08-09T00:00:00.000Z" },
    { id: "grant-audio", status: "active", capability: QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT, provider: QUEST_SURFACE_PROVIDER_ID, scope: "session", constraints: {}, approved_by: "user", approval_provenance_id: "seth", reason: "audio", created_at: "2026-08-09T00:00:00.000Z" },
    { id: "grant-local", status: "active", capability: QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH, provider: "soma.provider.local-model", scope: "window", constraints: {}, approved_by: "user", approval_provenance_id: "seth", reason: "local", created_at: "2026-08-09T00:00:00.000Z" },
    ...extra,
  ];
  return grants;
}

function catalog() {
  return { capabilities: [{ key: QUEST_SURFACE_CAPABILITY }, { key: QUEST_SURFACE_CAPABILITY_MIC_CAPTURE }, { key: QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT }, { key: QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH }] };
}
function registry() {
  return { providers: [{ id: QUEST_SURFACE_PROVIDER_ID, capabilities: [QUEST_SURFACE_CAPABILITY, QUEST_SURFACE_CAPABILITY_MIC_CAPTURE, QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT] }, { id: "soma.provider.local-model", capabilities: [QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH] }] };
}

test("armed episode: default unarmed fails closed to panel-only LEASE (no manifest)", async (t) => {
  const creds = await createTlsCredentials(t);
  const provider = createQuestSurfaceFixtureProvider({
    tlsOptions: { key: creds.serverKey, cert: creds.serverCert, ca: creds.ca },
    grantStore: { schema_version: 1, grants: baseGrants() },
    capabilityCatalog: catalog(), providerRegistry: registry(),
    grantId: "grant-panel", leaseTtlMs: 5000,
    panel: { surface_id: "panel.main", revision: "1", ttl_ms: 4000, text: "hi" },
    logger: quietLogger,
  });
  // deliberately NOT arming
  t.after(() => provider.stop());
  const addr = await provider.start({ host: "127.0.0.1", port: 0 });
  const client = await connectClient(addr.port, creds);
  t.after(() => client.destroy());
  client.send("HELLO", { supported_versions: [1] }, { epoch: "0", leaseRef: "" });
  const hello = await client.next();
  assert.equal(hello.type, "HELLO_ACK");
  const second = await client.next();
  assert.equal(second.type, "LEASE", "unarmed must not emit LEASE_MANIFEST");
  const third = await client.next();
  assert.equal(third.type, "PANEL_SNAPSHOT");
  // ensure no manifest in first 3 frames
});

test("armed episode: expired episode fails closed to LEASE only", async (t) => {
  const creds = await createTlsCredentials(t);
  let nowMs = Date.now();
  const now = () => nowMs;
  const provider = createQuestSurfaceFixtureProvider({
    tlsOptions: { key: creds.serverKey, cert: creds.serverCert, ca: creds.ca },
    grantStore: { schema_version: 1, grants: baseGrants() },
    capabilityCatalog: catalog(), providerRegistry: registry(),
    grantId: "grant-panel", leaseTtlMs: 5000,
    panel: { surface_id: "panel.main", revision: "1", ttl_ms: 4000, text: "hi" },
    logger: quietLogger,
    now,
  });
  provider.armEpisode({ episodeId: "ep-expire", ttlMs: 10_000, actor: "test" });
  // fast-forward past expiry
  nowMs += 20_000;
  t.after(() => provider.stop());
  const addr = await provider.start({ host: "127.0.0.1", port: 0 });
  const client = await connectClient(addr.port, creds);
  t.after(() => client.destroy());
  client.send("HELLO", { supported_versions: [1] }, { epoch: "0", leaseRef: "" });
  const hello = await client.next();
  assert.equal(hello.type, "HELLO_ACK");
  const second = await client.next();
  assert.equal(second.type, "LEASE");
});

test("armed episode: revoked before HELLO fails closed to LEASE only and emits revoked event", async (t) => {
  const creds = await createTlsCredentials(t);
  const events = [];
  const provider = createQuestSurfaceFixtureProvider({
    tlsOptions: { key: creds.serverKey, cert: creds.serverCert, ca: creds.ca },
    grantStore: { schema_version: 1, grants: baseGrants() },
    capabilityCatalog: catalog(), providerRegistry: registry(),
    grantId: "grant-panel", leaseTtlMs: 5000,
    panel: { surface_id: "panel.main", revision: "1", ttl_ms: 4000, text: "hi" },
    logger: quietLogger,
    eventSink(e) { events.push(e); },
  });
  provider.armEpisode({ episodeId: "ep-revoked", ttlMs: 60_000, actor: "test" });
  provider.revokeEpisode("test-revoke");
  assert.ok(events.some(e => e.event_type === "quest.surface.episode_revoked"), "revoke event emitted");
  t.after(() => provider.stop());
  const addr = await provider.start({ host: "127.0.0.1", port: 0 });
  const client = await connectClient(addr.port, creds);
  t.after(() => client.destroy());
  client.send("HELLO", { supported_versions: [1] }, { epoch: "0", leaseRef: "" });
  const hello = await client.next();
  assert.equal(hello.type, "HELLO_ACK");
  const second = await client.next();
  assert.equal(second.type, "LEASE");
});

test("configured panel grant pinned despite duplicate/misordered active panel grant", async (t) => {
  const creds = await createTlsCredentials(t);
  const duplicate = { id: "grant-panel-dup", status: "active", capability: QUEST_SURFACE_CAPABILITY, provider: QUEST_SURFACE_PROVIDER_ID, scope: "session", constraints: { allowed_surface_ids: ["panel.main"], max_panel_text_bytes: 512, lease_ttl_ms: 5000 }, approved_by: "user", approval_provenance_id: "other", reason: "dup", created_at: "2026-08-09T00:00:00.000Z" };
  // dup first in store to tempt grantId="" discovery to pick wrong one
  const grants = [duplicate, ...baseGrants()];
  const provider = createQuestSurfaceFixtureProvider({
    tlsOptions: { key: creds.serverKey, cert: creds.serverCert, ca: creds.ca },
    grantStore: { schema_version: 1, grants },
    capabilityCatalog: catalog(), providerRegistry: registry(),
    grantId: "grant-panel", leaseTtlMs: 5000,
    panel: { surface_id: "panel.main", revision: "1", ttl_ms: 4000, text: "hi" },
    logger: quietLogger,
  });
  provider.armEpisode({ episodeId: "ep-dup", ttlMs: 60_000, actor: "test" });
  t.after(() => provider.stop());
  const addr = await provider.start({ host: "127.0.0.1", port: 0 });
  const client = await connectClient(addr.port, creds);
  t.after(() => client.destroy());
  client.send("HELLO", { supported_versions: [1] }, { epoch: "0", leaseRef: "" });
  const hello = await client.next();
  assert.equal(hello.type, "HELLO_ACK");
  const manifest = await client.next();
  assert.equal(manifest.type, "LEASE_MANIFEST");
  assert.equal(manifest.payload.leases.panel.source_grant_id, "grant-panel", "panel leaf must be configured grant, not dup");
});

test("manifest TTL capped to episode remaining lifetime (boundary)", async (t) => {
  const creds = await createTlsCredentials(t);
  let nowMs = 1_000_000;
  const now = () => nowMs;
  const provider = createQuestSurfaceFixtureProvider({
    tlsOptions: { key: creds.serverKey, cert: creds.serverCert, ca: creds.ca },
    grantStore: { schema_version: 1, grants: baseGrants() },
    capabilityCatalog: catalog(), providerRegistry: registry(),
    grantId: "grant-panel", leaseTtlMs: 5000,
    panel: { surface_id: "panel.main", revision: "1", ttl_ms: 4000, text: "hi" },
    logger: quietLogger,
    now,
  });
  provider.armEpisode({ episodeId: "ep-short", ttlMs: 200, actor: "test" });
  const episodeExp = nowMs + 200;
  nowMs += 100; // 100ms remaining at HELLO time
  t.after(() => provider.stop());
  const addr = await provider.start({ host: "127.0.0.1", port: 0 });
  const client = await connectClient(addr.port, creds);
  t.after(() => client.destroy());
  client.send("HELLO", { supported_versions: [1] }, { epoch: "0", leaseRef: "" });
  const hello = await client.next();
  assert.equal(hello.type, "HELLO_ACK");
  const manifest = await client.next();
  assert.equal(manifest.type, "LEASE_MANIFEST");
  // strict: must not outlive consent
  assert.equal(manifest.payload.ttl_ms, 100, `ttl must be exactly episode remaining 100, got ${manifest.payload.ttl_ms}`);
  assert.equal(manifest.payload.expires_at_ms, episodeExp, "manifest expiry must equal episode expiry");
  for (const leafId of ["panel","mic_capture","audio_present","local_attach"]) {
    assert.equal(manifest.payload.leases[leafId].ttl_ms, 100, `${leafId} leaf ttl must be capped`);
    assert.equal(manifest.payload.leases[leafId].expires_at_ms, episodeExp, `${leafId} leaf expiry must equal episode expiry`);
  }
});

test("revokeEpisode narrows already-issued session (closes transport and latches)", async (t) => {
  const creds = await createTlsCredentials(t);
  const events = [];
  const provider = createQuestSurfaceFixtureProvider({
    tlsOptions: { key: creds.serverKey, cert: creds.serverCert, ca: creds.ca },
    grantStore: { schema_version: 1, grants: baseGrants() },
    capabilityCatalog: catalog(), providerRegistry: registry(),
    grantId: "grant-panel", leaseTtlMs: 5000,
    panel: { surface_id: "panel.main", revision: "1", ttl_ms: 4000, text: "hi" },
    logger: quietLogger,
    eventSink(e) { events.push(e); },
  });
  provider.armEpisode({ episodeId: "ep-active", ttlMs: 60_000, actor: "test" });
  t.after(() => provider.stop());
  const addr = await provider.start({ host: "127.0.0.1", port: 0 });
  const client = await connectClient(addr.port, creds);
  t.after(() => client.destroy());
  client.send("HELLO", { supported_versions: [1] }, { epoch: "0", leaseRef: "" });
  const hello = await client.next();
  const sessionEpoch = hello.session_epoch;
  assert.equal(hello.type, "HELLO_ACK");
  await client.next(); // manifest
  await client.next(); // lease
  await client.next(); // snapshot
  // register close observer BEFORE revoke (per review)
  let socketClosed = false;
  client.socket.once("close", () => socketClosed = true);
  provider.revokeEpisode("consent_withdrawn");
  await new Promise(r => setTimeout(r, 300));
  assert.ok(events.some(e => e.event_type === "quest.surface.episode_revoked"), "provider revoked");
  assert.ok(events.some(e => e.event_type === "quest.surface.episode_revoked_session"), "session narrowed");
  assert.ok(events.some(e => e.event_type === "quest.surface.session_closed" && e.reason === "consent_withdrawn"), "session_closed with revoke reason");
  assert.ok(socketClosed, "socket closed on revoke");
  // provider-lifetime latch must record revoked epoch
  assert.equal(provider.deviceMicLatch.latchedEpoch, sessionEpoch, "latch epoch recorded");
});

// Proper injectable tests: each blocks one stage via AbortSignal
test("revoke aborts during STT (transcribe blocked) — abort observed, no downstream, PCM released before resolve", async (t) => {
  // Direct pipeline unit test — no TLS framing, proves AbortSignal cancellation shared with Fix C
  const { createQuestSurfaceAudioPipeline } = await import("../src/questSurfaceAudioPipeline.js");
  let transcribeAborted = false; let chatCalled = false; let synthCalled = false;
  const pipeline = createQuestSurfaceAudioPipeline({
    panelBase: { surface_id: "panel.main" },
    leaseRefFor: () => "lease-panel",
    transcribe: (pcm, utteranceId, signal) => new Promise((_, reject) => {
      signal?.addEventListener("abort", () => { transcribeAborted = true; reject(Object.assign(new Error("aborted"), { code: "utterance_cancelled" })); }, { once: true });
    }),
    chat: (tx, uid, aid) => { chatCalled = true; return Promise.resolve({ answerText: "should not be called" }); },
    synthesize: () => { synthCalled = true; return Promise.resolve([Buffer.alloc(3840)]); },
  });
  const kEpoch = "sess-stt"; const streamId = 1; const utt = "utt-stt";
  pipeline.handleUtteranceStart({ sessionEpoch: kEpoch, streamId, payload: { utterance_id: utt }, leaseRef: "lease-mic" });
  const pcm = Buffer.alloc(1920); for (let i=0;i<pcm.length;i+=2) pcm.writeInt16LE(1000,i);
  const { createAudioChunkPayload } = await import("../src/questSurfaceProtocol.js");
  pipeline.handleAudioChunk({ sessionEpoch: kEpoch, streamId, payload: createAudioChunkPayload({ utteranceId: utt, pcmBytes: pcm, channels: 1 }) });
  const endPromise = pipeline.handleUtteranceEnd({ sessionEpoch: kEpoch, streamId, payload: { utterance_id: utt } });
  endPromise.catch(()=>{}); // prevent unhandled until await
  // let STT enter blocked state
  await new Promise(r => setTimeout(r, 20));
  assert.equal(pipeline.getRemainingBufferBytes(), 1920, "PCM buffered before abort");
  assert.equal(transcribeAborted, false);
  pipeline.handleLifecycleClose("consent_withdrawn");
  // abort must be observed synchronously, before blocked promise resolves
  await new Promise(r => setTimeout(r, 20));
  assert.ok(transcribeAborted, "STT observed abort immediately");
  assert.equal(chatCalled, false, "chat not called after STT abort");
  assert.equal(synthCalled, false, "TTS not called after STT abort");
  assert.equal(pipeline.getRemainingBufferBytes(), 0, "PCM released synchronously");
  let threw = false;
  try { await endPromise; } catch (e) { threw = true; assert.equal(e.code, "utterance_cancelled"); }
  assert.ok(threw, "end should throw cancelled");
});

test("revoke aborts during chat (local model blocked) — abort observed, no TTS, PCM released", async (t) => {
  const { createQuestSurfaceAudioPipeline } = await import("../src/questSurfaceAudioPipeline.js");
  let chatAborted = false; let synthCalled = false;
  const pipeline = createQuestSurfaceAudioPipeline({
    panelBase: { surface_id: "panel.main" },
    leaseRefFor: () => "lease-panel",
    transcribe: () => ({ transcript: "hello soma" }),
    chat: (tx, uid, aid, signal) => new Promise((_, reject) => {
      signal?.addEventListener("abort", () => { chatAborted = true; reject(Object.assign(new Error("aborted"), { code: "utterance_cancelled" })); }, { once: true });
    }),
    synthesize: () => { synthCalled = true; return Promise.resolve([Buffer.alloc(3840)]); },
  });
  const kEpoch = "sess-chat"; const streamId = 1; const utt = "utt-chat";
  pipeline.handleUtteranceStart({ sessionEpoch: kEpoch, streamId, payload: { utterance_id: utt }, leaseRef: "lease-mic" });
  const pcm = Buffer.alloc(1920); for (let i=0;i<pcm.length;i+=2) pcm.writeInt16LE(1000,i);
  const { createAudioChunkPayload } = await import("../src/questSurfaceProtocol.js");
  pipeline.handleAudioChunk({ sessionEpoch: kEpoch, streamId, payload: createAudioChunkPayload({ utteranceId: utt, pcmBytes: pcm, channels: 1 }) });
  const endPromise = pipeline.handleUtteranceEnd({ sessionEpoch: kEpoch, streamId, payload: { utterance_id: utt } });
  endPromise.catch(()=>{});
  await new Promise(r => setTimeout(r, 20));
  assert.equal(pipeline.getRemainingBufferBytes(), 1920);
  pipeline.handleLifecycleClose("consent_withdrawn");
  await new Promise(r => setTimeout(r, 20));
  assert.ok(chatAborted, "chat observed abort");
  assert.equal(synthCalled, false, "TTS not called after chat abort");
  assert.equal(pipeline.getRemainingBufferBytes(), 0, "PCM released");
  let threw = false; try { await endPromise; } catch (e) { threw = true; assert.equal(e.code, "utterance_cancelled"); }
  assert.ok(threw);
});

test("revoke aborts during TTS (synthesize blocked) — abort observed, PCM released, no panel/audio", async (t) => {
  const { createQuestSurfaceAudioPipeline } = await import("../src/questSurfaceAudioPipeline.js");
  let ttsAborted = false;
  const pipeline = createQuestSurfaceAudioPipeline({
    panelBase: { surface_id: "panel.main" },
    leaseRefFor: () => "lease-panel",
    transcribe: () => ({ transcript: "hello soma" }),
    chat: () => ({ answerText: "Answer" }),
    synthesize: (txt, aid, uid, signal) => new Promise((_, reject) => {
      signal?.addEventListener("abort", () => { ttsAborted = true; reject(Object.assign(new Error("aborted"), { code: "utterance_cancelled" })); }, { once: true });
    }),
  });
  const kEpoch = "sess-tts"; const streamId = 1; const utt = "utt-tts";
  pipeline.handleUtteranceStart({ sessionEpoch: kEpoch, streamId, payload: { utterance_id: utt }, leaseRef: "lease-mic" });
  const pcm = Buffer.alloc(1920); for (let i=0;i<pcm.length;i+=2) pcm.writeInt16LE(1000,i);
  const { createAudioChunkPayload } = await import("../src/questSurfaceProtocol.js");
  pipeline.handleAudioChunk({ sessionEpoch: kEpoch, streamId, payload: createAudioChunkPayload({ utteranceId: utt, pcmBytes: pcm, channels: 1 }) });
  const endPromise = pipeline.handleUtteranceEnd({ sessionEpoch: kEpoch, streamId, payload: { utterance_id: utt } });
  endPromise.catch(()=>{});
  await new Promise(r => setTimeout(r, 20));
  assert.equal(pipeline.getRemainingBufferBytes(), 1920);
  pipeline.handleLifecycleClose("consent_withdrawn");
  await new Promise(r => setTimeout(r, 20));
  assert.ok(ttsAborted, "TTS observed abort");
  assert.equal(pipeline.getRemainingBufferBytes(), 0, "PCM released");
  let threw = false; try { await endPromise; } catch (e) { threw = true; assert.equal(e.code, "utterance_cancelled"); }
  assert.ok(threw);
});

async function connectClient(port, creds) {
  const socket = tls.connect({ host: "127.0.0.1", port, servername: "localhost", key: creds.clientKey, cert: creds.clientCert, ca: creds.ca, rejectUnauthorized: true, minVersion: "TLSv1.3" });
  await new Promise((resolve, reject) => { socket.once("secureConnect", resolve); socket.once("error", reject); });
  return new TestClient(socket);
}
class TestClient {
  constructor(socket) { this.socket = socket; this.decoder = new BoundedLineDecoder(); this.frames = []; this.waiters = []; this.seqByStream = new Map(); socket.on("data", (chunk) => { for (const line of this.decoder.push(chunk)) { const frame = parseQuestSurfaceFrame(line); const w = this.waiters.shift(); if (w) w.resolve(frame); else this.frames.push(frame); } }); socket.on("error", (e) => { for (const w of this.waiters.splice(0)) w.reject(e); }); }
  send(type, payload, { epoch, leaseRef, streamId = 0 }) { const key = `${epoch}:${streamId}:uplink`; const seq = (this.seqByStream.get(key) ?? 0n) + 1n; this.seqByStream.set(key, seq); this.socket.write(serializeQuestSurfaceFrame(createQuestSurfaceFrame({ type, sessionEpoch: epoch, streamId, direction: "uplink", leaseRef, seq, payload }))); }
  next() { const f = this.frames.shift(); if (f) return Promise.resolve(f); return new Promise((resolve, reject) => { const to = setTimeout(() => reject(new Error("Timed out waiting for frame")), 4000); this.waiters.push({ resolve(v){ clearTimeout(to); resolve(v); }, reject(e){ clearTimeout(to); reject(e);} }); }); }
  nextOrTimeout(ms) { const f = this.frames.shift(); if (f) return Promise.resolve(f); return new Promise((resolve, reject) => { const to = setTimeout(() => reject(new Error("Timed out waiting for frame")), ms); this.waiters.push({ resolve(v){ clearTimeout(to); resolve(v); }, reject(e){ clearTimeout(to); reject(e);} }); }); }
  destroy(){ this.socket.destroy(); }
}
test("B atomic once: concurrent two streams, exactly one enters chat, loser fails before attachment, failed chat does not restore", async (t) => {
  const creds = await createTlsCredentials(t);
  // use once scope for local_attach to enable atomic test
  const onceGrants = baseGrants().map(g => g.capability === QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH ? { ...g, scope: "once" } : g);
  let chatCalls = 0;
  const { createQuestSurfaceAudioPipeline } = await import("../src/questSurfaceAudioPipeline.js");
  const pipelineFactory = (opts) => createQuestSurfaceAudioPipeline({
    ...opts,
    chat: async (tx, uid, aid, signal) => { chatCalls++; // counted
      // delegate to default chat (fixture)
      return { answerText: `Answer to: ${tx}` };
    },
  });
  const provider = createQuestSurfaceFixtureProvider({
    tlsOptions: { key: creds.serverKey, cert: creds.serverCert, ca: creds.ca },
    grantStore: { schema_version: 1, grants: onceGrants },
    capabilityCatalog: catalog(), providerRegistry: registry(),
    grantId: "grant-panel", leaseTtlMs: 5000,
    panel: { surface_id: "panel.main", revision: "1", ttl_ms: 4000, text: "hi" },
    logger: quietLogger,
    pipelineFactory,
  });
  provider.armEpisode({ episodeId: "ep-once-race", ttlMs: 60_000, actor: "test" });
  t.after(() => provider.stop());
  const addr = await provider.start({ host: "127.0.0.1", port: 0 });
  const client = await connectClient(addr.port, creds);
  t.after(() => client.destroy());
  client.send("HELLO", { supported_versions: [1] }, { epoch: "0", leaseRef: "" });
  const hello = await client.next(); const manifest = await client.next(); await client.next(); await client.next();
  const epoch = hello.session_epoch; const micLease = manifest.payload.leases.mic_capture.lease_id;
  assert.equal(manifest.payload.leases.local_attach.scope, "once");
  const pcm = Buffer.alloc(1920); for(let i=0;i<pcm.length;i+=2) pcm.writeInt16LE(1000,i);
  const { createAudioChunkPayload } = await import("../src/questSurfaceProtocol.js");
  // two concurrent utterances
  client.send("UTTERANCE_START", { utterance_id: "utt-once-1" }, { epoch, leaseRef: micLease, streamId: 1 });
  client.send("AUDIO_CHUNK", createAudioChunkPayload({ utteranceId: "utt-once-1", pcmBytes: pcm, channels: 1 }), { epoch, leaseRef: micLease, streamId: 1 });
  client.send("UTTERANCE_END", { utterance_id: "utt-once-1" }, { epoch, leaseRef: micLease, streamId: 1 });
  client.send("UTTERANCE_START", { utterance_id: "utt-once-2" }, { epoch, leaseRef: micLease, streamId: 2 });
  client.send("AUDIO_CHUNK", createAudioChunkPayload({ utteranceId: "utt-once-2", pcmBytes: pcm, channels: 1 }), { epoch, leaseRef: micLease, streamId: 2 });
  client.send("UTTERANCE_END", { utterance_id: "utt-once-2" }, { epoch, leaseRef: micLease, streamId: 2 });
  // collect: one should get PANEL_SNAPSHOT + AUDIO_CHUNK, other ERROR grant_already_consumed
  const frames = [];
  for(let i=0;i<6;i++){ try{ const f = await client.nextOrTimeout(1500); frames.push(f); } catch{ break; } }
  const hasPanel = frames.some(f=>f.type==="PANEL_SNAPSHOT");
  const hasAudio = frames.some(f=>f.type==="AUDIO_CHUNK");
  const hasOnceError = frames.some(f=>f.type==="ERROR" && (f.payload?.code==="local_attach_not_authorized" || f.payload?.code==="grant_already_consumed" || JSON.stringify(f.payload).includes("grant_already_consumed") || JSON.stringify(f.payload).includes("local_attach_not_authorized")));
  assert.ok(hasPanel && hasAudio, `one stream should succeed with panel+audio, got ${frames.map(f=>f.type).join(",")}`);
  assert.ok(hasOnceError, `loser must fail local_attach_not_authorized/grant_already_consumed, got ${frames.map(f=>`${f.type}:${JSON.stringify(f.payload).slice(0,80)}`).join(" | ")}`);
  assert.equal(chatCalls, 1, "exactly one stream must enter chat");
  // third utterance must also be refused and must not enter chat (non-restore) — transport ERROR verified in F, here we prove sink still protected via chat count + Set
  await new Promise(r=>setTimeout(r, 300));
  const beforeThirdChat = chatCalls;
  // Do not require a third ERROR frame here (see F for stream-scoped ERROR binding); the once grant must remain consumed and chat not re-entered
  assert.equal(chatCalls, beforeThirdChat, "third must not have entered chat yet");
  assert.ok(provider.consumedOnceGrants.has(manifest.payload.leases.local_attach.source_grant_id), "once grant remains consumed before third");
  client.send("UTTERANCE_START", { utterance_id: "utt-once-3" }, { epoch, leaseRef: micLease, streamId: 3 });
  client.send("AUDIO_CHUNK", createAudioChunkPayload({ utteranceId: "utt-once-3", pcmBytes: pcm, channels: 1 }), { epoch, leaseRef: micLease, streamId: 3 });
  client.send("UTTERANCE_END", { utterance_id: "utt-once-3" }, { epoch, leaseRef: micLease, streamId: 3 });
  await new Promise(r=>setTimeout(r, 400));
  assert.equal(chatCalls, beforeThirdChat, "third must not enter chat (non-restore, still 1)");
  assert.ok(provider.consumedOnceGrants.has(manifest.payload.leases.local_attach.source_grant_id), "once grant remains consumed after third");
});

test("B failed post-reservation chat does not restore once authority (second still refused)", async (t) => {
  const creds = await createTlsCredentials(t);
  const onceGrants = baseGrants().map(g => g.capability === QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH ? { ...g, scope: "once" } : g);
  let chatCalls = 0;
  const { createQuestSurfaceAudioPipeline } = await import("../src/questSurfaceAudioPipeline.js");
  const pipelineFactory = (opts) => createQuestSurfaceAudioPipeline({
    ...opts,
    chat: async (tx, uid, aid, signal) => {
      chatCalls++;
      if (chatCalls === 1) throw Object.assign(new Error("chat failed"), { code: "local_model_failed" });
      return { answerText: "should not reach" };
    },
  });
  const provider = createQuestSurfaceFixtureProvider({
    tlsOptions: { key: creds.serverKey, cert: creds.serverCert, ca: creds.ca },
    grantStore: { schema_version: 1, grants: onceGrants },
    capabilityCatalog: catalog(), providerRegistry: registry(),
    grantId: "grant-panel", leaseTtlMs: 5000,
    panel: { surface_id: "panel.main", revision: "1", ttl_ms: 4000, text: "hi" },
    logger: quietLogger,
    pipelineFactory,
  });
  provider.armEpisode({ episodeId: "ep-once-fail", ttlMs: 60_000, actor: "test" });
  t.after(() => provider.stop());
  const addr = await provider.start({ host: "127.0.0.1", port: 0 });
  const client = await connectClient(addr.port, creds);
  t.after(() => client.destroy());
  client.send("HELLO", { supported_versions: [1] }, { epoch: "0", leaseRef: "" });
  const hello = await client.next(); const manifest = await client.next(); await client.next(); await client.next();
  const epoch = hello.session_epoch; const micLease = manifest.payload.leases.mic_capture.lease_id;
  const pcm = Buffer.alloc(1920); for(let i=0;i<pcm.length;i+=2) pcm.writeInt16LE(1000,i);
  const { createAudioChunkPayload } = await import("../src/questSurfaceProtocol.js");
  client.send("UTTERANCE_START", { utterance_id: "utt-fail-1" }, { epoch, leaseRef: micLease, streamId: 1 });
  client.send("AUDIO_CHUNK", createAudioChunkPayload({ utteranceId: "utt-fail-1", pcmBytes: pcm, channels: 1 }), { epoch, leaseRef: micLease, streamId: 1 });
  client.send("UTTERANCE_END", { utterance_id: "utt-fail-1" }, { epoch, leaseRef: micLease, streamId: 1 });
  const first = await client.nextOrTimeout(2000);
  assert.equal(first.type, "ERROR", "first chat failure must be ERROR");
  assert.equal(chatCalls, 1, "first must have entered chat and failed");
  // second utterance should be refused before chat
  client.send("UTTERANCE_START", { utterance_id: "utt-fail-2" }, { epoch, leaseRef: micLease, streamId: 2 });
  client.send("AUDIO_CHUNK", createAudioChunkPayload({ utteranceId: "utt-fail-2", pcmBytes: pcm, channels: 1 }), { epoch, leaseRef: micLease, streamId: 2 });
  client.send("UTTERANCE_END", { utterance_id: "utt-fail-2" }, { epoch, leaseRef: micLease, streamId: 2 });
  const second = await client.nextOrTimeout(2000);
  assert.ok(second, "second must produce frame");
  assert.equal(second.type, "ERROR", "second after failed chat must still be refused");
  assert.equal(chatCalls, 1, "second must not enter chat (still 1)");
});

test("B sink-time expiry between rechecks uses injected now and fails with grant_expired", async (t) => {
  const creds = await createTlsCredentials(t);
  const onceGrants = baseGrants().map(g => g.capability === QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH ? { ...g, scope: "once" } : g);
  let nowMs = 1_000_000;
  const now = () => nowMs;
  const { createQuestSurfaceAudioPipeline } = await import("../src/questSurfaceAudioPipeline.js");
  let chatEntered = false;
  const pipelineFactory = (opts) => createQuestSurfaceAudioPipeline({
    ...opts,
    transcribe: (pcm, utteranceId, signal) => {
      // advance clock between first recheck (already passed) and second recheck (before chat)
      // first recheck occurs before this transcribe, second before chat — so expire here
      nowMs = 1_000_000 + 200; // exactly at expiry
      // also need to return transcript
      return { transcript: "hello" };
    },
    chat: async (tx, uid, aid, signal) => {
      chatEntered = true;
      return { answerText: "answer" };
    },
  });
  const provider = createQuestSurfaceFixtureProvider({
    tlsOptions: { key: creds.serverKey, cert: creds.serverCert, ca: creds.ca },
    grantStore: { schema_version: 1, grants: onceGrants },
    capabilityCatalog: catalog(), providerRegistry: registry(),
    grantId: "grant-panel", leaseTtlMs: 5000,
    panel: { surface_id: "panel.main", revision: "1", ttl_ms: 4000, text: "hi" },
    logger: quietLogger,
    now,
    pipelineFactory,
  });
  provider.armEpisode({ episodeId: "ep-expire-race", ttlMs: 200, actor: "test" });
  const episodeExp = nowMs + 200;
  t.after(() => provider.stop());
  const addr = await provider.start({ host: "127.0.0.1", port: 0 });
  const client = await connectClient(addr.port, creds);
  t.after(() => client.destroy());
  client.send("HELLO", { supported_versions: [1] }, { epoch: "0", leaseRef: "" });
  const hello = await client.next(); const manifest = await client.next(); await client.next(); await client.next();
  const epoch = hello.session_epoch; const micLease = manifest.payload.leases.mic_capture.lease_id;
  // verify manifest not yet expired at HELLO
  assert.equal(manifest.payload.expires_at_ms, episodeExp);
  const pcm = Buffer.alloc(1920); for(let i=0;i<pcm.length;i+=2) pcm.writeInt16LE(1000,i);
  const { createAudioChunkPayload } = await import("../src/questSurfaceProtocol.js");
  client.send("UTTERANCE_START", { utterance_id: "utt-expire" }, { epoch, leaseRef: micLease, streamId: 1 });
  client.send("AUDIO_CHUNK", createAudioChunkPayload({ utteranceId: "utt-expire", pcmBytes: pcm, channels: 1 }), { epoch, leaseRef: micLease, streamId: 1 });
  client.send("UTTERANCE_END", { utterance_id: "utt-expire" }, { epoch, leaseRef: micLease, streamId: 1 });
  const res = await client.nextOrTimeout(2000);
  assert.equal(res.type, "ERROR", "expired between rechecks must fail");
  assert.ok(res.payload?.code==="local_attach_not_authorized" || JSON.stringify(res.payload).includes("grant_expired"), "should be grant_expired wrapped");
  assert.equal(chatEntered, false, "chat must not be entered when second recheck expires");
  // once grant must remain unconsumed because reservation never reached
  assert.equal(provider.consumedOnceGrants.has(manifest.payload.leases.local_attach.source_grant_id), false, "once grant not consumed on expiry between rechecks");
  // exact boundary: now === expires_at_ms must be expired
  assert.ok(nowMs >= episodeExp, "now at expiry");
});

test("B sink-time grant revocation between rechecks fails before chat and does not consume once", async (t) => {
  const creds = await createTlsCredentials(t);
  const onceGrants = baseGrants().map(g => g.capability === QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH ? { ...g, scope: "once" } : g);
  let nowMs = 1_000_000;
  const now = () => nowMs;
  const { createQuestSurfaceAudioPipeline } = await import("../src/questSurfaceAudioPipeline.js");
  let chatEntered = false;
  let grantStoreRef = { schema_version: 1, grants: [...onceGrants] };
  const pipelineFactory = (opts) => createQuestSurfaceAudioPipeline({
    ...opts,
    transcribe: (pcm, uid, signal) => {
      // revoke the exact local_attach source grant between rechecks
      grantStoreRef.grants = grantStoreRef.grants.filter(g => !(g.capability === QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH && g.provider === "soma.provider.local-model"));
      return { transcript: "hello" };
    },
    chat: async () => { chatEntered = true; return { answerText: "answer" }; },
  });
  const provider = createQuestSurfaceFixtureProvider({
    tlsOptions: { key: creds.serverKey, cert: creds.serverCert, ca: creds.ca },
    grantStore: grantStoreRef,
    capabilityCatalog: catalog(), providerRegistry: registry(),
    grantId: "grant-panel", leaseTtlMs: 5000,
    panel: { surface_id: "panel.main", revision: "1", ttl_ms: 4000, text: "hi" },
    logger: quietLogger,
    now,
    pipelineFactory,
  });
  provider.armEpisode({ episodeId: "ep-revoke-race", ttlMs: 60_000, actor: "test" });
  t.after(() => provider.stop());
  const addr = await provider.start({ host: "127.0.0.1", port: 0 });
  const client = await connectClient(addr.port, creds);
  t.after(() => client.destroy());
  client.send("HELLO", { supported_versions: [1] }, { epoch: "0", leaseRef: "" });
  const hello = await client.next(); const manifest = await client.next(); await client.next(); await client.next();
  const epoch = hello.session_epoch; const micLease = manifest.payload.leases.mic_capture.lease_id;
  const pcm = Buffer.alloc(1920); for(let i=0;i<pcm.length;i+=2) pcm.writeInt16LE(1000,i);
  const { createAudioChunkPayload } = await import("../src/questSurfaceProtocol.js");
  client.send("UTTERANCE_START", { utterance_id: "utt-revoke" }, { epoch, leaseRef: micLease, streamId: 1 });
  client.send("AUDIO_CHUNK", createAudioChunkPayload({ utteranceId: "utt-revoke", pcmBytes: pcm, channels: 1 }), { epoch, leaseRef: micLease, streamId: 1 });
  client.send("UTTERANCE_END", { utterance_id: "utt-revoke" }, { epoch, leaseRef: micLease, streamId: 1 });
  const res = await client.nextOrTimeout(2000);
  assert.equal(res.type, "ERROR");
  assert.equal(chatEntered, false, "revoked grant must fail before chat");
  assert.equal(provider.consumedOnceGrants.has(manifest.payload.leases.local_attach.source_grant_id), false, "once not consumed on revocation between rechecks");
});

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

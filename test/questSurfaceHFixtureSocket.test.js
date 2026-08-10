import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import tls from "node:tls";
import test from "node:test";

import { createQuestSurfaceFixtureProvider } from "../src/questSurfaceFixtureProvider.js";
import {
  BoundedLineDecoder,
  QUEST_SURFACE_CAPABILITY,
  QUEST_SURFACE_PROVIDER_ID,
  createAudioChunkPayload,
  createQuestSurfaceFrame,
  parseQuestSurfaceFrame,
  serializeQuestSurfaceFrame,
} from "../src/questSurfaceProtocol.js";

const quietLogger = { info() {}, error() {} };

test("H fixture socket: UTTERANCE_END triggers PANEL_SNAPSHOT + AUDIO_CHUNK* then exact ANSWER_END via real session", async (t) => {
  const credentials = await createTlsCredentials(t);
  const provider = createHProvider(credentials);
  t.after(() => provider.stop());
  const address = await provider.start({ host: "127.0.0.1", port: 0 });
  const client = await connectClient(address.port, credentials);
  t.after(() => client.destroy());

  client.send("HELLO", { supported_versions: [1], client: "soma-quest-surface-v1a" }, { epoch: "0", leaseRef: "" });
  const helloAck = await client.next();
  const manifest = await client.next();
  const lease = await client.next();
  const snap0 = await client.next();
  assert.equal(helloAck.type, "HELLO_ACK");
  assert.equal(manifest.type, "LEASE_MANIFEST");
  assert.equal(lease.type, "LEASE");
  assert.equal(snap0.type, "PANEL_SNAPSHOT");
  const epoch = helloAck.session_epoch;
  const micLease = manifest.payload.leases.mic_capture.lease_id;
  const audioLease = manifest.payload.leases.audio_present.lease_id;

  const utteranceId = "utt-fixture-socket-1";
  client.send("UTTERANCE_START", { utterance_id: utteranceId }, { epoch, leaseRef: micLease, streamId: 7 });
  const pcm20 = Buffer.alloc(1920, 0);
  for (let i=0;i<1920;i+=2) pcm20.writeInt16LE(1000, i);
  const chunkPayload = createAudioChunkPayload({ utteranceId, pcmBytes: pcm20, channels: 1 });
  client.send("AUDIO_CHUNK", chunkPayload, { epoch, leaseRef: micLease, streamId: 7 });
  client.send("UTTERANCE_END", { utterance_id: utteranceId }, { epoch, leaseRef: micLease, streamId: 7 });

  const received = [];
  let answerId = "";
  let receivedUtterance = "";
  for (let i = 0; i < 20; i++) {
    const f = await client.nextWithTimeout(3000);
    if (!f) break;
    received.push(f);
    if (f.type === "PANEL_SNAPSHOT") {
      const docB64 = f.payload.document_b64;
      const doc = JSON.parse(Buffer.from(docB64, "base64").toString("utf8"));
      if (doc.answer_id) { answerId = doc.answer_id; receivedUtterance = doc.utterance_id; }
    }
    if (f.type === "ANSWER_END") break;
  }
  const answerEnd = received.find((f) => f.type === "ANSWER_END");
  assert.ok(answerEnd, "must receive ANSWER_END on real socket");
  assert.equal(answerEnd.session_epoch, epoch);
  assert.ok(Number(answerEnd.stream_id) !== 0, "ANSWER_END streamId !=0");
  assert.equal(answerEnd.direction, "downlink");
  assert.equal(answerEnd.lease_ref, audioLease);
  assert.equal(answerEnd.payload.answer_id, answerId);
  assert.equal(answerEnd.payload.utterance_id, receivedUtterance);
  assert.equal(answerEnd.payload.utterance_id, utteranceId);
  const chunks = received.filter((f) => f.type === "AUDIO_CHUNK");
  assert.ok(chunks.length >= 1, "must have at least one AUDIO_CHUNK before ANSWER_END");
  for (const c of chunks) {
    assert.equal(c.session_epoch, epoch);
    assert.equal(c.stream_id, answerEnd.stream_id);
    assert.equal(c.direction, "downlink");
    assert.equal(c.lease_ref, audioLease);
    assert.equal(c.payload.answer_id, answerId);
    assert.equal(c.payload.utterance_id, utteranceId);
  }
  let last = BigInt(0);
  for (const c of [...chunks, answerEnd]) {
    const seq = BigInt(c.seq);
    assert.ok(seq > last, "seq monotonic");
    last = seq;
  }
  const extra = await client.nextWithTimeout(500);
  assert.equal(extra, null, "no extra AUDIO_CHUNK after ANSWER_END");
});

function createHProvider(credentials) {
  const caps = [
    ["grant-quest-panel", QUEST_SURFACE_CAPABILITY, QUEST_SURFACE_PROVIDER_ID],
    ["grant-quest-mic", "interaction.quest.surface.microphone.capture", QUEST_SURFACE_PROVIDER_ID],
    ["grant-quest-audio", "interaction.quest.surface.audio.wearer_directed.present", QUEST_SURFACE_PROVIDER_ID],
    ["grant-quest-local", "model.context.audio.microphone.local.attach", "soma.provider.local-model"],
  ];
  const grants = caps.map(([id, cap, prov]) => ({
    id, status: "active", capability: cap, provider: prov, scope: cap === "model.context.audio.microphone.local.attach" ? "window" : "session",
    constraints: cap === QUEST_SURFACE_CAPABILITY ? { allowed_surface_ids: ["panel.main"], max_panel_text_bytes: 512, lease_ttl_ms: 5000 } : {},
    approved_by: "user", approval_provenance_id: "seth-approved-quest-v1a", reason: "H fixture", created_at: "2026-08-09T00:00:00.000Z",
  }));
  const provider = createQuestSurfaceFixtureProvider({
    tlsOptions: { key: credentials.serverKey, cert: credentials.serverCert, ca: credentials.ca },
    grantStore: { schema_version: 1, grants },
    capabilityCatalog: { capabilities: grants.map(g => ({ key: g.capability })) },
    providerRegistry: { providers: [{ id: QUEST_SURFACE_PROVIDER_ID, capabilities: [QUEST_SURFACE_CAPABILITY, "interaction.quest.surface.microphone.capture", "interaction.quest.surface.audio.wearer_directed.present"], answer: { input_class: "text", destination: "local", required_leaf: "model.context.audio.microphone.local.attach" } }, { id: "soma.provider.local-model", capabilities: ["model.context.audio.microphone.local.attach"] }] },
    grantId: "grant-quest-panel",
    leaseTtlMs: 5000,
    panel: { surface_id: "panel.main", revision: "1", ttl_ms: 4000, text: "HELLO SETH FROM SOMA" },
    logger: quietLogger,
  });
  provider.armEpisode({ episodeId: "ep-h-fixture-socket", ttlMs: 60000, actor: "test", mode: { input_class: "text", destination: "local" }, capability: "model.context.audio.microphone.local.attach", provider: QUEST_SURFACE_PROVIDER_ID, grant_id: "grant-quest-local" });
  return provider;
}

async function connectClient(port, credentials) {
  const socket = tls.connect({ host: "127.0.0.1", port, servername: "localhost", key: credentials.clientKey, cert: credentials.clientCert, ca: credentials.ca, rejectUnauthorized: true, minVersion: "TLSv1.3" });
  await new Promise((resolve, reject) => { socket.once("secureConnect", resolve); socket.once("error", reject); });
  return new TestClient(socket);
}

class TestClient {
  constructor(socket) {
    this.socket = socket;
    this.decoder = new BoundedLineDecoder();
    this.frames = [];
    this.waiters = [];
    this.seq = 0n;
    socket.on("data", (chunk) => {
      for (const line of this.decoder.push(chunk)) {
        const frame = parseQuestSurfaceFrame(line);
        const waiter = this.waiters.shift();
        if (waiter) waiter.resolve(frame); else this.frames.push(frame);
      }
    });
    socket.on("error", (error) => { for (const waiter of this.waiters.splice(0)) waiter.reject(error); });
  }
  send(type, payload, { epoch, leaseRef, streamId = 0 }) {
    this.seq += 1n;
    this.socket.write(serializeQuestSurfaceFrame(createQuestSurfaceFrame({ type, sessionEpoch: epoch, streamId, direction: "uplink", leaseRef, seq: this.seq, payload })));
  }
  next() {
    const frame = this.frames.shift();
    if (frame) return Promise.resolve(frame);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for Quest surface frame")), 2000);
      this.waiters.push({ resolve(value){ clearTimeout(timeout); resolve(value); }, reject(error){ clearTimeout(timeout); reject(error); } });
    });
  }
  nextWithTimeout(ms) {
    if (this.frames.length) return Promise.resolve(this.frames.shift());
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), ms);
      this.waiters.push({ resolve: (f)=>{ clearTimeout(timer); resolve(f); }, reject: ()=>{ clearTimeout(timer); resolve(null); } });
    });
  }
  destroy() { this.socket.destroy(); }
}

async function createTlsCredentials(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "soma-quest-tls-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = (name) => path.join(directory, name);
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", file("ca.key"), "-out", file("ca.pem"), "-subj", "/CN=Soma Quest Test CA", "-days", "1"], { stdio: "ignore" });
  execFileSync("openssl", ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", file("server.key"), "-out", file("server.csr"), "-subj", "/CN=localhost"], { stdio: "ignore" });
  await writeFile(file("server.ext"), "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n");
  execFileSync("openssl", ["x509", "-req", "-in", file("server.csr"), "-CA", file("ca.pem"), "-CAkey", file("ca.key"), "-CAcreateserial", "-out", file("server.pem"), "-days", "1", "-sha256", "-extfile", file("server.ext")], { stdio: "ignore" });
  execFileSync("openssl", ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", file("client.key"), "-out", file("client.csr"), "-subj", "/CN=quest-v1a-test-client"], { stdio: "ignore" });
  await writeFile(file("client.ext"), "extendedKeyUsage=clientAuth\n");
  execFileSync("openssl", ["x509", "-req", "-in", file("client.csr"), "-CA", file("ca.pem"), "-CAkey", file("ca.key"), "-CAcreateserial", "-out", file("client.pem"), "-days", "1", "-sha256", "-extfile", file("client.ext")], { stdio: "ignore" });
  return { ca: await readFile(file("ca.pem")), serverKey: await readFile(file("server.key")), serverCert: await readFile(file("server.pem")), clientKey: await readFile(file("client.key")), clientCert: await readFile(file("client.pem")) };
}

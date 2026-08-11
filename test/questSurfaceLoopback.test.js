// Item I-4: real-class host loopback + no-retention audit.
//
// Drives the FULL provider flow (arm text-local episode -> four-leaf manifest ->
// utterance capture -> UTTERANCE_END -> real STT->model->TTS answer -> PANEL +
// AUDIO_CHUNK* + ANSWER_END -> close) over a real TLS socket, with the REAL
// adapters (injected fetch standing in for the local services — the adapter code
// runs; only the HTTP is mocked). This is the pre-device gate leg: it exercises
// the real adapter marshaling, the once-sink, the manifest enforcement, and the
// wire, host-side with no headset.
//
// NO-RETENTION AUDIT (consent-critical): the answer legitimately reaches the
// wearer over the wire (PANEL/AUDIO), but the transcript and answer text must
// NEVER appear in the provider's logs or emitted events, and no session state
// may be retained after close. Distinctive strings make a leak detectable.
//
// Runnable as the loopback artifact: `npm run test:quest-v1b-loopback`.

import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import tls from "node:tls";
import test from "node:test";

import { createQuestSurfaceFixtureProvider } from "../src/questSurfaceFixtureProvider.js";
import { createRealAnswerStages } from "../src/questSurfaceRealAnswerProvider.js";
import {
  BoundedLineDecoder,
  QUEST_SURFACE_CAPABILITY,
  QUEST_SURFACE_PROVIDER_ID,
  createAudioChunkPayload,
  createQuestSurfaceFrame,
  parseQuestSurfaceFrame,
  serializeQuestSurfaceFrame,
} from "../src/questSurfaceProtocol.js";

// Distinctive so a retention leak is unambiguous.
const AUDIT_TRANSCRIPT = "AUDIT-TRANSCRIPT-turn-on-the-lights-9f3a7b";
const AUDIT_ANSWER = "AUDIT-ANSWER-sure-lights-on-7b2c1d";

function makeWav(monoPcm) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + monoPcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(48000, 24); h.writeUInt32LE(48000 * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(monoPcm.length, 40);
  return Buffer.concat([h, monoPcm]);
}

function loopbackFetch() {
  return async (url) => {
    const u = String(url);
    if (u.includes("/transcribe")) return { ok: true, status: 200, json: async () => ({ text: AUDIT_TRANSCRIPT }), headers: { get: () => null } };
    if (u.includes("/chat/completions")) return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: AUDIT_ANSWER }, finish_reason: "stop" }], model: "gemma-loopback" }), headers: { get: () => null } };
    if (u.includes("/synthesize")) { const wav = makeWav(Buffer.alloc(3840, 3)); const ab = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength); return { ok: true, status: 200, arrayBuffer: async () => ab, headers: { get: () => null } }; }
    throw new Error(`unexpected loopback url ${u}`);
  };
}

function createLoopbackProvider(credentials, audit) {
  const caps = [
    ["grant-quest-panel", QUEST_SURFACE_CAPABILITY, QUEST_SURFACE_PROVIDER_ID],
    ["grant-quest-mic", "interaction.quest.surface.microphone.capture", QUEST_SURFACE_PROVIDER_ID],
    ["grant-quest-audio", "interaction.quest.surface.audio.wearer_directed.present", QUEST_SURFACE_PROVIDER_ID],
    ["grant-quest-local", "model.context.audio.microphone.local.attach", "soma.provider.local-model"],
  ];
  const grants = caps.map(([id, cap, prov]) => ({
    id, status: "active", capability: cap, provider: prov, scope: cap === "model.context.audio.microphone.local.attach" ? "window" : "session",
    constraints: cap === QUEST_SURFACE_CAPABILITY
      ? { allowed_surface_ids: ["panel.main"], max_panel_text_bytes: 512, lease_ttl_ms: 5000, device_fingerprint256: credentials.clientFingerprint256 }
      : { device_fingerprint256: credentials.clientFingerprint256 },
    approved_by: "user", approval_provenance_id: "seth-approved", reason: "loopback", created_at: "2026-08-10T00:00:00.000Z",
  }));
  const provider = createQuestSurfaceFixtureProvider({
    tlsOptions: { key: credentials.serverKey, cert: credentials.serverCert, ca: credentials.ca },
    grantStore: { schema_version: 1, grants },
    capabilityCatalog: { capabilities: grants.map((g) => ({ key: g.capability })) },
    providerRegistry: { providers: [{ id: QUEST_SURFACE_PROVIDER_ID, capabilities: [QUEST_SURFACE_CAPABILITY, "interaction.quest.surface.microphone.capture", "interaction.quest.surface.audio.wearer_directed.present"], answer: { input_class: "text", destination: "local", required_leaf: "model.context.audio.microphone.local.attach" } }, { id: "soma.provider.local-model", capabilities: ["model.context.audio.microphone.local.attach"] }] },
    grantIds: {
      panel: "grant-quest-panel",
      mic_capture: "grant-quest-mic",
      audio_present: "grant-quest-audio",
      local_attach: "grant-quest-local",
    },
    leaseTtlMs: 5000,
    panel: { surface_id: "panel.main", revision: "1", ttl_ms: 4000, text: "SOMA READY" },
    // Real adapters (injected fetch) as the abort-aware pipeline stages.
    answerStages: createRealAnswerStages({ fetchImpl: loopbackFetch(), endpoints: { whisper: { url: "http://w" }, llm: { url: "http://l", model: "gemma-loopback" }, kokoro: { url: "http://k" }, llmModel: "gemma-loopback" } }),
    // Capture everything the provider logs / emits for the no-retention audit.
    logger: { info: (...a) => audit.push(["log", ...a]), error: (...a) => audit.push(["err", ...a]) },
    eventSink: (type, fields) => audit.push(["event", type, fields]),
  });
  provider.armEpisode({ episodeId: "ep-loopback", ttlMs: 60000, actor: "seth", mode: { input_class: "text", destination: "local" }, capability: "model.context.audio.microphone.local.attach", provider: QUEST_SURFACE_PROVIDER_ID, grant_id: "grant-quest-local" });
  return provider;
}

test("I-4 loopback: on -> ask -> [real STT/model/TTS] -> answer + panel -> off (real adapters, host-side)", async (t) => {
  const credentials = await createTlsCredentials(t);
  const audit = [];
  const provider = createLoopbackProvider(credentials, audit);
  t.after(() => provider.stop());
  const address = await provider.start({ host: "127.0.0.1", port: 0 });
  const client = await connectClient(address.port, credentials);

  client.send("HELLO", { supported_versions: [1], client: "soma-quest-surface-v1a" }, { epoch: "0", leaseRef: "" });
  const helloAck = await client.next();
  const manifest = await client.next();
  await client.next(); // LEASE
  await client.next(); // initial PANEL_SNAPSHOT
  assert.equal(helloAck.type, "HELLO_ACK");
  assert.equal(manifest.type, "LEASE_MANIFEST", "armed text-local episode issues the manifest");
  const epoch = helloAck.session_epoch;
  const micLease = manifest.payload.leases.mic_capture.lease_id;
  const audioLease = manifest.payload.leases.audio_present.lease_id;

  // ask
  const utteranceId = "utt-loopback-1";
  client.send("UTTERANCE_START", { utterance_id: utteranceId }, { epoch, leaseRef: micLease, streamId: 9 });
  const pcm = Buffer.alloc(1920, 0);
  for (let i = 0; i < 1920; i += 2) pcm.writeInt16LE(1000, i);
  client.send("AUDIO_CHUNK", createAudioChunkPayload({ utteranceId, pcmBytes: pcm, channels: 1 }), { epoch, leaseRef: micLease, streamId: 9 });
  client.send("UTTERANCE_END", { utterance_id: utteranceId }, { epoch, leaseRef: micLease, streamId: 9 });

  // answer: PANEL_SNAPSHOT (carries the real answer) + AUDIO_CHUNK* + ANSWER_END
  const received = [];
  let answerId = "";
  let panelAnswerText = "";
  for (let i = 0; i < 25; i++) {
    const f = await client.nextWithTimeout(3000);
    if (!f) break;
    received.push(f);
    if (f.type === "PANEL_SNAPSHOT" && f.payload.document_b64) {
      const doc = JSON.parse(Buffer.from(f.payload.document_b64, "base64").toString("utf8"));
      if (doc.answer_id) { answerId = doc.answer_id; panelAnswerText = doc.surface?.resource?.text ?? ""; }
    }
    if (f.type === "ANSWER_END") break;
  }
  const answerEnd = received.find((f) => f.type === "ANSWER_END");
  assert.ok(answerEnd, "must receive ANSWER_END (real answer completed)");
  assert.equal(answerEnd.payload.utterance_id, utteranceId);
  assert.equal(answerEnd.payload.answer_id, answerId);
  assert.equal(answerEnd.lease_ref, audioLease);
  const chunks = received.filter((f) => f.type === "AUDIO_CHUNK");
  assert.ok(chunks.length >= 1, "real TTS produced playback chunks");
  // The real MODEL answer reached the wearer over the wire (legitimate delivery).
  assert.ok(panelAnswerText.includes(AUDIT_ANSWER), "the panel carried the real model answer to the wearer");

  // --- NO-RETENTION AUDIT (consent-critical) ---
  // The answer is delivered over the wire, but the transcript and answer text
  // must never appear in the provider's logs or emitted events.
  const auditStr = JSON.stringify(audit);
  // Non-vacuous: the provider DID log/emit during the flow, and those events
  // carry the utterance_id metadata — so the content-absence checks below are
  // meaningful (a content-free event stream, not an empty one).
  assert.ok(audit.length > 0, "audit captured the provider's logs/events (not a vacuous check)");
  assert.ok(auditStr.includes(utteranceId), "events carry the utterance_id (metadata present)");
  assert.equal(auditStr.includes(AUDIT_TRANSCRIPT), false, "transcript must NOT appear in logs/events (no retention)");
  assert.equal(auditStr.includes(AUDIT_ANSWER), false, "answer text must NOT appear in logs/events (no retention)");
  assert.equal(auditStr.includes(pcm.toString("base64")), false, "raw PCM must NOT appear in logs/events");

  // off: close the session; no state is retained.
  client.destroy();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(provider.sessions.size, 0, "no session state retained after close");
});

// --- TLS test harness (mirrors the other quest-surface socket tests) ---

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
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for Quest surface frame")), 3000);
      this.waiters.push({ resolve(value) { clearTimeout(timeout); resolve(value); }, reject(error) { clearTimeout(timeout); reject(error); } });
    });
  }
  nextWithTimeout(ms) {
    if (this.frames.length) return Promise.resolve(this.frames.shift());
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), ms);
      this.waiters.push({ resolve: (f) => { clearTimeout(timer); resolve(f); }, reject: () => { clearTimeout(timer); resolve(null); } });
    });
  }
  destroy() { this.socket.destroy(); }
}

async function connectClient(port, credentials) {
  const socket = tls.connect({ host: "127.0.0.1", port, servername: "localhost", key: credentials.clientKey, cert: credentials.clientCert, ca: credentials.ca, rejectUnauthorized: true, minVersion: "TLSv1.3" });
  await new Promise((resolve, reject) => { socket.once("secureConnect", resolve); socket.once("error", reject); });
  return new TestClient(socket);
}

async function createTlsCredentials(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "soma-quest-loopback-tls-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = (name) => path.join(directory, name);
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", file("ca.key"), "-out", file("ca.pem"), "-subj", "/CN=Soma Quest Test CA", "-days", "1"], { stdio: "ignore" });
  execFileSync("openssl", ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", file("server.key"), "-out", file("server.csr"), "-subj", "/CN=localhost"], { stdio: "ignore" });
  await writeFile(file("server.ext"), "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n");
  execFileSync("openssl", ["x509", "-req", "-in", file("server.csr"), "-CA", file("ca.pem"), "-CAkey", file("ca.key"), "-CAcreateserial", "-out", file("server.pem"), "-days", "1", "-sha256", "-extfile", file("server.ext")], { stdio: "ignore" });
  execFileSync("openssl", ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", file("client.key"), "-out", file("client.csr"), "-subj", "/CN=quest-v1a-test-client"], { stdio: "ignore" });
  await writeFile(file("client.ext"), "extendedKeyUsage=clientAuth\n");
  execFileSync("openssl", ["x509", "-req", "-in", file("client.csr"), "-CA", file("ca.pem"), "-CAkey", file("ca.key"), "-CAcreateserial", "-out", file("client.pem"), "-days", "1", "-sha256", "-extfile", file("client.ext")], { stdio: "ignore" });
  const clientCert = await readFile(file("client.pem"));
  return { ca: await readFile(file("ca.pem")), serverKey: await readFile(file("server.key")), serverCert: await readFile(file("server.pem")), clientKey: await readFile(file("client.key")), clientCert, clientFingerprint256: new X509Certificate(clientCert).fingerprint256 };
}

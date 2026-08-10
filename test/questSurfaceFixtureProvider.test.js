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
  createQuestSurfaceFrame,
  parseQuestSurfaceFrame,
  serializeQuestSurfaceFrame,
} from "../src/questSurfaceProtocol.js";

const quietLogger = { info() {}, error() {} };

test("quest fixture completes an mTLS lease, snapshot, actual-bounds ack, and narrowing teardown", async (t) => {
  const credentials = await createTlsCredentials(t);
  const events = [];
  const provider = createProvider(credentials, {
    eventSink(event) {
      events.push(event);
    },
  });
  t.after(() => provider.stop());
  const address = await provider.start({ host: "127.0.0.1", port: 0 });
  const client = await connectClient(address.port, credentials);
  t.after(() => client.destroy());

  client.send("HELLO", {
    supported_versions: [0, 2, 1],
    client: "soma-quest-surface-v1a",
  }, { epoch: "0", leaseRef: "" });
  const hello = await client.next();
  const leaseFrame = await client.next();
  const snapshot = await client.next();

  assert.equal(hello.type, "HELLO_ACK");
  assert.equal(hello.payload.selected_version, 1);
  assert.equal(leaseFrame.type, "LEASE");
  assert.equal(leaseFrame.payload.session_epoch, hello.session_epoch);
  assert.equal(leaseFrame.payload.source_grant_id, "grant-quest-panel");
  assert.equal(snapshot.type, "PANEL_SNAPSHOT");
  assert.equal(snapshot.session_epoch, hello.session_epoch);
  assert.equal(snapshot.lease_ref, leaseFrame.payload.lease_id);

  client.send("ACTUAL_BOUNDS_ACK", {
    document_revision: "1",
    document_hash: snapshot.payload.document_sha256,
    surface_id: "panel.main",
    actual_bounds: { width_m: 0.9, height_m: 0.5 },
    displayed: true,
  }, {
    epoch: hello.session_epoch,
    leaseRef: leaseFrame.payload.lease_id,
  });
  await waitFor(() => events.some((event) => event.event_type === "quest.surface.snapshot_acknowledged"));

  client.send("FOCUS_LOST", { reason: "openxr_focus_lost" }, {
    epoch: hello.session_epoch,
    leaseRef: leaseFrame.payload.lease_id,
  });
  const teardown = await client.next();
  assert.equal(teardown.type, "TEARDOWN_ACK");
  await waitFor(() => events.some((event) => event.event_type === "quest.surface.session_narrowed"));

  const snapshotEvent = events.find((event) => event.event_type === "quest.surface.snapshot_sent");
  assert.equal(snapshotEvent.panel_text_included, false);
  assert.equal(snapshotEvent.payload_bytes_included, false);
  assert.equal(events.some((event) => Object.hasOwn(event, "text")), false);
});

test("quest fixture rejects a non-v1a stream before issuing capability content", async (t) => {
  const credentials = await createTlsCredentials(t);
  const provider = createProvider(credentials);
  t.after(() => provider.stop());
  const address = await provider.start({ host: "127.0.0.1", port: 0 });
  const client = await connectClient(address.port, credentials);
  t.after(() => client.destroy());

  client.send("HELLO", { supported_versions: [1] }, {
    epoch: "0",
    leaseRef: "",
    streamId: 7,
  });
  const error = await client.next();
  assert.equal(error.type, "ERROR");
  assert.equal(error.payload.code, "stream_id_unsupported");
});

test("quest fixture authenticates transport but sends no lease or panel for a wrong grant", async (t) => {
  const credentials = await createTlsCredentials(t);
  const events = [];
  const provider = createProvider(credentials, {
    grantId: "grant-does-not-exist",
    eventSink(event) {
      events.push(event);
    },
  });
  t.after(() => provider.stop());
  const address = await provider.start({ host: "127.0.0.1", port: 0 });
  const client = await connectClient(address.port, credentials);
  t.after(() => client.destroy());

  client.send("HELLO", { supported_versions: [1] }, { epoch: "0", leaseRef: "" });
  const error = await client.next();
  assert.equal(error.type, "ERROR");
  assert.equal(error.payload.code, "grant_not_authorized");
  await waitFor(() => events.some((event) => event.event_type === "quest.surface.lease_refused"));
  assert.equal(events.some((event) => event.event_type === "quest.surface.snapshot_sent"), false);
});

test("quest fixture rejects malformed exact-grant constraints instead of broadening defaults", async (t) => {
  const credentials = await createTlsCredentials(t);
  const events = [];
  const provider = createProvider(credentials, {
    grantConstraints: { allowed_surface_ids: "panel.main" },
    eventSink(event) {
      events.push(event);
    },
  });
  t.after(() => provider.stop());
  const address = await provider.start({ host: "127.0.0.1", port: 0 });
  const client = await connectClient(address.port, credentials);
  t.after(() => client.destroy());

  client.send("HELLO", { supported_versions: [1] }, { epoch: "0", leaseRef: "" });
  const error = await client.next();
  assert.equal(error.type, "ERROR");
  assert.equal(error.payload.code, "grant_not_authorized");
  assert.equal(events.some((event) => event.event_type === "quest.surface.snapshot_sent"), false);
});

test("quest fixture rejects an acknowledgement bound to a stale lease", async (t) => {
  const credentials = await createTlsCredentials(t);
  const events = [];
  const provider = createProvider(credentials, {
    eventSink(event) {
      events.push(event);
    },
  });
  t.after(() => provider.stop());
  const address = await provider.start({ host: "127.0.0.1", port: 0 });
  const client = await connectClient(address.port, credentials);
  t.after(() => client.destroy());
  client.send("HELLO", { supported_versions: [1] }, { epoch: "0", leaseRef: "" });
  const hello = await client.next();
  await client.next();
  const snapshot = await client.next();

  client.send("ACTUAL_BOUNDS_ACK", {
    document_revision: "1",
    document_hash: snapshot.payload.document_sha256,
    surface_id: "panel.main",
    actual_bounds: { width_m: 0.9, height_m: 0.5 },
    displayed: true,
  }, { epoch: hello.session_epoch, leaseRef: "stale-lease" });

  const error = await client.next();
  assert.equal(error.type, "ERROR");
  assert.equal(error.payload.code, "lease_ref_mismatch");
  assert.equal(events.some((event) => event.event_type === "quest.surface.snapshot_acknowledged"), false);
});

test("quest fixture rejects actual bounds that differ from the deterministic client clamp", async (t) => {
  const credentials = await createTlsCredentials(t);
  const events = [];
  const provider = createProvider(credentials, {
    eventSink(event) {
      events.push(event);
    },
  });
  t.after(() => provider.stop());
  const address = await provider.start({ host: "127.0.0.1", port: 0 });
  const client = await connectClient(address.port, credentials);
  t.after(() => client.destroy());
  client.send("HELLO", { supported_versions: [1] }, { epoch: "0", leaseRef: "" });
  const hello = await client.next();
  const lease = await client.next();
  const snapshot = await client.next();

  client.send("ACTUAL_BOUNDS_ACK", {
    document_revision: "1",
    document_hash: snapshot.payload.document_sha256,
    surface_id: "panel.main",
    actual_bounds: { width_m: 1.1, height_m: 0.5 },
    displayed: true,
  }, { epoch: hello.session_epoch, leaseRef: lease.payload.lease_id });

  const error = await client.next();
  assert.equal(error.type, "ERROR");
  assert.equal(error.payload.code, "bounds_ack_actual_mismatch");
  assert.equal(events.some((event) => event.event_type === "quest.surface.snapshot_acknowledged"), false);
});

test("quest fixture refuses TLS clients without a certificate", async (t) => {
  const credentials = await createTlsCredentials(t);
  const events = [];
  const provider = createProvider(credentials, {
    eventSink(event) {
      events.push(event);
    },
  });
  t.after(() => provider.stop());
  const address = await provider.start({ host: "127.0.0.1", port: 0 });

  const outcome = await new Promise((resolve) => {
    const socket = tls.connect({
      host: "127.0.0.1",
      port: address.port,
      servername: "localhost",
      ca: credentials.ca,
      rejectUnauthorized: true,
      minVersion: "TLSv1.3",
    });
    socket.once("secureConnect", () => socket.write("unauthenticated-client\n"));
    socket.once("data", () => resolve("unexpected_data"));
    socket.once("error", () => resolve("rejected"));
    socket.once("close", () => resolve("rejected"));
    socket.setTimeout(2_000, () => {
      socket.destroy();
      resolve("timeout");
    });
  });
  assert.equal(outcome, "rejected");
  assert.equal(events.some((event) => event.event_type === "quest.surface.transport_authenticated"), false);
});

test("quest fixture rejects oversized inline panel content before listening", async (t) => {
  const credentials = await createTlsCredentials(t);
  assert.throws(
    () => createProvider(credentials, { panel: { text: "x".repeat(2_049) } }),
    (error) => error.code === "panel_text_size_invalid",
  );
});

function createProvider(credentials, overrides = {}) {
  const activeGrant = {
    id: "grant-quest-panel",
    status: "active",
    capability: QUEST_SURFACE_CAPABILITY,
    provider: QUEST_SURFACE_PROVIDER_ID,
    scope: "session",
    constraints: {
      allowed_surface_ids: ["panel.main"],
      max_panel_text_bytes: 512,
      lease_ttl_ms: 5_000,
      ...(overrides.grantConstraints ?? {}),
    },
    approved_by: "user",
    approval_provenance_id: "seth-approved-quest-v1a",
    reason: "Exercise the approved Quest v1a panel session.",
    created_at: "2026-08-09T00:00:00.000Z",
  };
  return createQuestSurfaceFixtureProvider({
    tlsOptions: {
      key: credentials.serverKey,
      cert: credentials.serverCert,
      ca: credentials.ca,
    },
    grantStore: { schema_version: 1, grants: [activeGrant] },
    capabilityCatalog: { capabilities: [{ key: QUEST_SURFACE_CAPABILITY }] },
    providerRegistry: {
      providers: [{ id: QUEST_SURFACE_PROVIDER_ID, capabilities: [QUEST_SURFACE_CAPABILITY] }],
    },
    grantId: "grant-quest-panel",
    leaseTtlMs: 5_000,
    panel: {
      surface_id: "panel.main",
      revision: "1",
      ttl_ms: 4_000,
      text: "HELLO SETH FROM SOMA",
    },
    logger: quietLogger,
    ...overrides,
    panel: {
      surface_id: "panel.main",
      revision: "1",
      ttl_ms: 4_000,
      text: "HELLO SETH FROM SOMA",
      ...(overrides.panel ?? {}),
    },
  });
}

async function connectClient(port, credentials) {
  const socket = tls.connect({
    host: "127.0.0.1",
    port,
    servername: "localhost",
    key: credentials.clientKey,
    cert: credentials.clientCert,
    ca: credentials.ca,
    rejectUnauthorized: true,
    minVersion: "TLSv1.3",
  });
  await new Promise((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
  });
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
        if (waiter) {
          waiter.resolve(frame);
        } else {
          this.frames.push(frame);
        }
      }
    });
    socket.on("error", (error) => {
      for (const waiter of this.waiters.splice(0)) {
        waiter.reject(error);
      }
    });
  }

  send(type, payload, { epoch, leaseRef, streamId = 0 }) {
    this.seq += 1n;
    this.socket.write(serializeQuestSurfaceFrame(createQuestSurfaceFrame({
      type,
      sessionEpoch: epoch,
      streamId,
      direction: "uplink",
      leaseRef,
      seq: this.seq,
      payload,
    })));
  }

  next() {
    const frame = this.frames.shift();
    if (frame) {
      return Promise.resolve(frame);
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for Quest surface frame")), 2_000);
      this.waiters.push({
        resolve(value) {
          clearTimeout(timeout);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
  }

  destroy() {
    this.socket.destroy();
  }
}

async function createTlsCredentials(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "soma-quest-tls-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = (name) => path.join(directory, name);
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", file("ca.key"), "-out", file("ca.pem"),
    "-subj", "/CN=Soma Quest Test CA", "-days", "1",
  ], { stdio: "ignore" });
  execFileSync("openssl", [
    "req", "-newkey", "rsa:2048", "-nodes",
    "-keyout", file("server.key"), "-out", file("server.csr"),
    "-subj", "/CN=localhost",
  ], { stdio: "ignore" });
  await writeFile(file("server.ext"), "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n");
  execFileSync("openssl", [
    "x509", "-req", "-in", file("server.csr"),
    "-CA", file("ca.pem"), "-CAkey", file("ca.key"), "-CAcreateserial",
    "-out", file("server.pem"), "-days", "1", "-sha256", "-extfile", file("server.ext"),
  ], { stdio: "ignore" });
  execFileSync("openssl", [
    "req", "-newkey", "rsa:2048", "-nodes",
    "-keyout", file("client.key"), "-out", file("client.csr"),
    "-subj", "/CN=quest-v1a-test-client",
  ], { stdio: "ignore" });
  await writeFile(file("client.ext"), "extendedKeyUsage=clientAuth\n");
  execFileSync("openssl", [
    "x509", "-req", "-in", file("client.csr"),
    "-CA", file("ca.pem"), "-CAkey", file("ca.key"), "-CAcreateserial",
    "-out", file("client.pem"), "-days", "1", "-sha256", "-extfile", file("client.ext"),
  ], { stdio: "ignore" });
  return {
    ca: await readFile(file("ca.pem")),
    serverKey: await readFile(file("server.key")),
    serverCert: await readFile(file("server.pem")),
    clientKey: await readFile(file("client.key")),
    clientCert: await readFile(file("client.pem")),
  };
}

async function waitFor(predicate) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for provider event");
}

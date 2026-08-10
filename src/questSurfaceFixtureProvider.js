import tls from "node:tls";
import { randomUUID } from "node:crypto";

import { authorizeGrantUse } from "./grantAuthorization.js";
import {
  BoundedLineDecoder,
  QUEST_SURFACE_AUDIO_FRAME_TYPES,
  QUEST_SURFACE_CAPABILITY,
  QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH,
  QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT,
  QUEST_SURFACE_CAPABILITY_MIC_CAPTURE,
  QUEST_SURFACE_MAX_LEASE_TTL_MS,
  QUEST_SURFACE_MAX_PANEL_TEXT_BYTES,
  QUEST_SURFACE_PROTOCOL_VERSION,
  QUEST_SURFACE_PROVIDER_ID,
  QuestSurfaceProtocolError,
  createAudioChunkPayload,
  createLeaseManifestPayload,
  createPanelSnapshotPayload,
  createAnswerEndPayload,
  createQuestSurfaceFrame,
  createQuestSurfaceLease,
  decodeAudioChunkPayload,
  decodeCancelPayload,
  decodePanelSnapshotPayload,
  decodeUtteranceEndPayload,
  decodeUtteranceStartPayload,
  monotonicNowNs,
  parseQuestSurfaceFrame,
  randomSessionEpoch,
  selectHighestQuestSurfaceVersion,
  serializeQuestSurfaceFrame,
} from "./questSurfaceProtocol.js";
import { createQuestSurfaceAudioPipeline } from "./questSurfaceAudioPipeline.js";
import { QuestSurfaceMicLatch } from "./questSurfaceMicLatch.js";
import { matchAnswerProvider } from "./questSurfaceModeMatrix.js";

const DEFAULT_LEASE_TTL_MS = 60_000;
const DEFAULT_PANEL = Object.freeze({
  surface_id: "panel.main",
  text: "SOMA QUEST PANEL SESSION",
  revision: "1",
  ttl_ms: 30_000,
  pose: {
    position: { x: 0, y: 0, z: -1.5 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  },
  bounds: { width_m: 0.9, height_m: 0.5 },
});

export class QuestSurfaceFixtureProvider {
  constructor({
    tlsOptions,
    grantStore,
    grantRecoveryReport = null,
    capabilityCatalog = null,
    providerRegistry = null,
    grantId,
    panel = DEFAULT_PANEL,
    leaseTtlMs = DEFAULT_LEASE_TTL_MS,
    eventSink = () => {},
    logger = console,
    serverFactory = (options, handler) => tls.createServer(options, handler),
    now = () => Date.now(),
    pipelineFactory = null,
    answerStages = null,
  } = {}) {
    this.tlsOptions = validateTlsOptions(tlsOptions);
    this.grantStore = grantStore ?? { schema_version: 1, grants: [] };
    this.grantRecoveryReport = grantRecoveryReport;
    this.capabilityCatalog = capabilityCatalog;
    this.providerRegistry = providerRegistry;
    this.grantId = requireText(grantId, "quest_surface_grant_id_required");
    this.panel = normalizePanel(panel);
    this.leaseTtlMs = boundedInteger(
      leaseTtlMs,
      1,
      QUEST_SURFACE_MAX_LEASE_TTL_MS,
      "quest_surface_lease_ttl_invalid",
    );
    this.eventSink = eventSink;
    this.logger = logger;
    this.serverFactory = serverFactory;
    this.now = now;
    this.pipelineFactory = pipelineFactory;
    this.answerStages = answerStages;
    this.server = null;
    this.sessions = new Set();
    // #6: device latch persists across reconnects (provider lifetime)
    this.deviceMicLatch = new QuestSurfaceMicLatch();
    // #2: bounded armed episode window, default not armed
    this.armedEpisode = null;
    this.armedWindow = false; // legacy alias for tests
    // #3: track consumed once local_attach grants
    this.consumedOnceGrants = new Set();
  }

  armEpisode({ episodeId, ttlMs = 60_000, actor = "test", provenance = "", mode, capability, provider, grant_id, grantId } = {}) {
    const id = String(episodeId ?? `ep-${Date.now()}-${Math.random().toString(16).slice(2,8)}`).trim();
    if (!id) throw providerError("episode_id_required", "Episode id required");
    const ttl = boundedInteger(ttlMs, 1, QUEST_SURFACE_MAX_LEASE_TTL_MS, "episode_ttl_invalid");
    // I-1 tuple binding: {mode, capability, provider, grant_id} — default to text/local live if not supplied (backward compat)
    let boundMode = mode ?? null;
    let boundCapability = capability ?? null;
    let boundProvider = provider ?? null;
    let boundGrantId = grant_id ?? grantId ?? null;
    // allow mode as string "text:local" or object
    if (typeof boundMode === "string") {
      const [ic, dest] = String(boundMode).split(":");
      boundMode = { input_class: ic, destination: dest };
    }
    if (!boundMode && !boundCapability && !boundProvider && !boundGrantId) {
      // legacy audio path: default to text/local hard floor (fail-closed, no bypass) — panel-only sessions stay exempt because they never hit audio path
      boundMode = { input_class: "text", destination: "local" };
      boundCapability = "model.context.audio.microphone.local.attach";
      boundProvider = QUEST_SURFACE_PROVIDER_ID;
      boundGrantId = "grant-local";
      // allow grant-local as window or once; matcher will verify via hasLeaseFor mapping to local_attach
    } else {
      // default leaf for text/local if not supplied
      if (!boundMode) boundMode = { input_class: "text", destination: "local" };
      if (!boundCapability) {
        const leafFor = { "text:local": "model.context.audio.microphone.local.attach", "text:remote": "model.context.audio.microphone.remote.attach", "raw_audio:local": "model.context.audio.microphone.raw.local.attach", "raw_audio:remote": "model.context.audio.microphone.raw.remote.attach" };
        boundCapability = leafFor[`${boundMode.input_class}:${boundMode.destination}`] ?? "model.context.audio.microphone.local.attach";
      }
      if (!boundProvider) boundProvider = QUEST_SURFACE_PROVIDER_ID;
      if (!boundGrantId) boundGrantId = `grant-${boundCapability}`;
    }
    this.armedEpisode = { id, expiresAtMs: this.now() + ttl, actor: String(actor ?? ""), provenance: String(provenance ?? ""), ttlMs: ttl, mode: boundMode, capability: boundCapability, provider: boundProvider, grant_id: boundGrantId, grantId: boundGrantId };
    this.armedWindow = true;
    this.#emit("quest.surface.episode_armed", { episode_id: id, expires_at_ms: this.armedEpisode.expiresAtMs, actor, mode: boundMode, capability: boundCapability, provider: boundProvider, grant_id: boundGrantId });
    return this.armedEpisode;
  }

  revokeEpisode(reason = "revoked") {
    const episodeId = this.armedEpisode?.id ?? "none";
    if (this.armedEpisode) {
      this.#emit("quest.surface.episode_revoked", { episode_id: episodeId, reason });
    }
    this.armedEpisode = null;
    this.armedWindow = false;
    // Fix 4: narrow already-issued sessions — close active sessions and cancel pipelines
    // If a session is already issued, revocation must be observable; gating issuance only is
    // documented as insufficient for the consent core. Active sessions are torn down.
    for (const session of [...this.sessions]) {
      try {
        session.handleEpisodeRevoked?.(reason, episodeId);
      } catch {}
      try {
        session.close(reason);
      } catch {}
    }
  }

  async start({ host = "127.0.0.1", port = 0 } = {}) {
    if (this.server) {
      throw providerError("quest_surface_already_started", "Quest surface fixture is already started.");
    }
    const server = this.serverFactory({
      ...this.tlsOptions,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: "TLSv1.3",
    }, (socket) => this.#accept(socket));
    this.server = server;
    server.on("tlsClientError", (error) => {
      this.#emit("quest.surface.transport_refused", {
        reason: boundedErrorCode(error),
        client_authorized: false,
      });
    });
    server.on("error", (error) => {
      this.logger.error?.(`Quest surface fixture server error: ${boundedErrorCode(error)}`);
    });
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen({ host, port });
    });
    const address = server.address();
    this.#emit("quest.surface.provider_started", {
      host: typeof address === "object" && address ? address.address : String(host),
      port: typeof address === "object" && address ? address.port : port,
      provider: QUEST_SURFACE_PROVIDER_ID,
      capability: QUEST_SURFACE_CAPABILITY,
      authority_created: false,
    });
    return address;
  }

  async stop() {
    for (const session of [...this.sessions]) {
      session.close("runtime_shutdown");
    }
    if (!this.server) {
      return;
    }
    const server = this.server;
    this.server = null;
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  address() {
    return this.server?.address() ?? null;
  }

  #accept(socket) {
    if (!socket.authorized) {
      socket.destroy();
      return;
    }
    if (this.sessions.size >= 1) {
      this.#emit("quest.surface.transport_refused", {
        reason: "quest_surface_session_limit",
        client_authorized: true,
        authority_granted: false,
      });
      socket.destroy();
      return;
    }
    const peer = socket.getPeerCertificate?.() ?? {};
    // #2: enforce configured panel grant identity (not arbitrary)
    const panelAuth = this.#authorize(peer);
    if (!panelAuth.allowed) {
      this.#emit("quest.surface.lease_refused", { session_epoch: "pending", grant_id: this.grantId, reason: panelAuth.code, panel_sent: false });
      // still create session but it will fail hello with grant_not_authorized; we still need to track latch
    }
    const session = new QuestSurfaceProviderSession({
      socket,
      peerFingerprint256: normalizeFingerprint(peer.fingerprint256),
      authorize: () => this.#authorize(peer),
      grantStore: this.grantStore,
      grantRecoveryReport: this.grantRecoveryReport,
      capabilityCatalog: this.capabilityCatalog,
      providerRegistry: this.providerRegistry,
      panel: this.panel,
      leaseTtlMs: this.leaseTtlMs,
      deviceMicLatch: this.deviceMicLatch,
      armedWindow: this.armedWindow,
      getArmedEpisode: () => this.armedEpisode,
      consumedOnceGrants: this.consumedOnceGrants,
      configuredPanelGrantId: this.grantId,
      eventSink: (eventType, fields) => this.#emit(eventType, fields),
      now: this.now,
      onClose: () => this.sessions.delete(session),
      pipelineFactory: this.pipelineFactory,
      answerStages: this.answerStages,
    });
    this.sessions.add(session);
    session.start();
  }

  #authorize(peer) {
    const authorization = authorizeGrantUse({
      store: this.grantStore,
      grantId: this.grantId,
      capability: QUEST_SURFACE_CAPABILITY,
      provider: QUEST_SURFACE_PROVIDER_ID,
      scope: "session",
      recoveryReport: this.grantRecoveryReport,
      catalog: this.capabilityCatalog,
      providerRegistry: this.providerRegistry,
    });
    if (!authorization.allowed) {
      return authorization;
    }
    const constraints = authorization.grant.constraints ?? {};
    const constraintFailure = validateQuestGrantConstraints(constraints);
    if (constraintFailure) {
      return {
        allowed: false,
        code: constraintFailure,
        grant: null,
      };
    }
    const requiredFingerprint = normalizeFingerprint(constraints.device_fingerprint256);
    const presentedFingerprint = normalizeFingerprint(peer?.fingerprint256);
    if (requiredFingerprint && requiredFingerprint !== presentedFingerprint) {
      return {
        allowed: false,
        code: "quest_surface_device_identity_mismatch",
        grant: null,
      };
    }
    const allowedSurfaceIds = Array.isArray(constraints.allowed_surface_ids)
      ? constraints.allowed_surface_ids.map(String)
      : ["panel.main"];
    if (!allowedSurfaceIds.includes(this.panel.surface_id)) {
      return {
        allowed: false,
        code: "quest_surface_surface_not_granted",
        grant: null,
      };
    }
    const maxTextBytes = Number.isSafeInteger(constraints.max_panel_text_bytes)
      ? constraints.max_panel_text_bytes
      : QUEST_SURFACE_MAX_PANEL_TEXT_BYTES;
    if (Buffer.byteLength(this.panel.text, "utf8") > maxTextBytes) {
      return {
        allowed: false,
        code: "quest_surface_panel_text_exceeds_grant",
        grant: null,
      };
    }
    return authorization;
  }

  #emit(eventType, fields = {}) {
    const event = {
      event_type: eventType,
      timestamp: new Date(this.now()).toISOString(),
      content_included: false,
      payload_bytes_included: false,
      ...fields,
    };
    this.eventSink(event);
    this.logger.info?.("soma.quest_surface", event);
  }
}

class QuestSurfaceProviderSession {
  constructor({
    socket,
    peerFingerprint256,
    authorize,
    grantStore = null,
    grantRecoveryReport = null,
    capabilityCatalog = null,
    providerRegistry = null,
    panel,
    leaseTtlMs,
    deviceMicLatch = null,
    armedWindow = false,
    getArmedEpisode = null,
    consumedOnceGrants = null,
    configuredPanelGrantId = null,
    eventSink,
    now,
    onClose,
    pipelineFactory = null,
    answerStages = null,
  }) {
    this.socket = socket;
    this.peerFingerprint256 = peerFingerprint256;
    this.authorize = authorize;
    this.grantStore = grantStore;
    this.grantRecoveryReport = grantRecoveryReport;
    this.capabilityCatalog = capabilityCatalog;
    this.providerRegistry = providerRegistry;
    this.panel = panel;
    this.leaseTtlMs = leaseTtlMs;
    this.deviceMicLatch = deviceMicLatch;
    this.armedWindow = armedWindow;
    this.getArmedEpisode = getArmedEpisode;
    this.consumedOnceGrants = consumedOnceGrants;
    this.configuredPanelGrantId = configuredPanelGrantId;
    this.eventSink = eventSink;
    this.now = now;
    this.onClose = onClose;
    this.decoder = new BoundedLineDecoder();
    this.sessionEpoch = randomSessionEpoch();
    this.serverSequences = new Map();
    this.clientSequences = new Map();
    this.helloReceived = false;
    this.lease = null;
    this.snapshot = null;
    this.manifest = null;
    this.leaseTimer = null;
    this.closed = false;
    this.micLatch = deviceMicLatch ?? new QuestSurfaceMicLatch();
    this.pipeline = null;
    this.pipelineFactory = pipelineFactory;
    this.answerStages = answerStages;
    this.revisionCounter = BigInt(this.panel.revision ?? "1");
  }

  start() {
    this.socket.setNoDelay(true);
    this.socket.on("data", (chunk) => this.#onData(chunk));
    this.socket.once("close", () => this.#finish("transport_closed"));
    this.socket.once("error", (error) => {
      this.eventSink("quest.surface.transport_error", {
        session_epoch: this.sessionEpoch,
        reason: boundedErrorCode(error),
      });
    });
    this.eventSink("quest.surface.transport_authenticated", {
      session_epoch: this.sessionEpoch,
      client_fingerprint256: this.peerFingerprint256,
      mtls_authenticated: true,
      authority_granted: false,
    });
  }

  close(reason) {
    if (this.closed) {
      return;
    }
    this.closed = true;
    clearTimeout(this.leaseTimer);
    // #3: latch on disconnect/lease expiry at provider lifetime
    this.micLatch.latch(reason, this.sessionEpoch, this.now());
    if (this.pipeline) {
      this.pipeline.handleLifecycleClose(reason);
    }
    this.eventSink("quest.surface.session_closed", {
      session_epoch: this.sessionEpoch,
      lease_id: this.lease?.lease_id ?? this.manifest?.leases?.panel?.lease_id ?? "",
      reason,
      remaining_buffer_bytes: 0,
      latched_epoch: this.micLatch.latchedEpoch,
    });
    this.socket.destroy();
    this.onClose();
  }

  #finish(reason) {
    if (this.closed) {
      return;
    }
    this.closed = true;
    clearTimeout(this.leaseTimer);
    this.micLatch.latch(reason, this.sessionEpoch, this.now());
    if (this.pipeline) {
      this.pipeline.handleLifecycleClose(reason);
    }
    this.eventSink("quest.surface.session_closed", {
      session_epoch: this.sessionEpoch,
      lease_id: this.lease?.lease_id ?? this.manifest?.leases?.panel?.lease_id ?? "",
      reason,
      remaining_buffer_bytes: this.pipeline ? this.pipeline.getRemainingBufferBytes() : 0,
      latched_epoch: this.micLatch.latchedEpoch,
    });
    this.onClose();
  }

  handleEpisodeRevoked(reason, episodeId) {
    this.eventSink("quest.surface.episode_revoked_session", {
      session_epoch: this.sessionEpoch,
      lease_id: this.lease?.lease_id ?? this.manifest?.leases?.panel?.lease_id ?? "",
      reason: reason ?? "episode_revoked",
      episode_id: episodeId ?? "unknown",
      latched_epoch: this.micLatch.latchedEpoch,
    });
    if (this.pipeline) {
      try { this.pipeline.handleLifecycleClose(reason ?? "episode_revoked"); } catch {}
    }
  }

  tryReserveOnceGrant(grantId) {
    if (!grantId) return false;
    if (this.consumedOnceGrants.has(grantId)) return false;
    this.consumedOnceGrants.add(grantId);
    return true;
  }

  #onData(chunk) {
    if (this.closed) {
      return;
    }
    // #7: per-line handling to preserve stream context and continue batched frames
    for (const line of this.decoder.push(chunk)) {
      let frame = null;
      try {
        frame = parseQuestSurfaceFrame(line);
      } catch (error) {
        const code = error instanceof QuestSurfaceProtocolError ? error.code : "quest_surface_protocol_failure";
        this.#sendError(code);
        // envelope parse failure has no stream context — close session (cannot clear named stream)
        this.close(code);
        return;
      }
      try {
        this.#handle(frame);
      } catch (error) {
        const code = error instanceof QuestSurfaceProtocolError ? error.code : "quest_surface_protocol_failure";
        const streamScoped = new Set(["utterance_already_active","utterance_not_started","utterance_id_mismatch","utterance_too_long","utterance_cancelled","audio_direction_mismatch","sequence_stale","manifest_required","lease_ref_mismatch","lease_ref_required","mic_latch_active","local_attach_not_authorized","local_attach_missing","grant_already_consumed"]);
        if (code.startsWith("utterance_") || streamScoped.has(code)) {
          // #9: stream-scoped — emit error bound to failing frame's stream, continue other lines in same chunk
          this.eventSink("quest.surface.audio_stream_error", { session_epoch: frame.session_epoch, stream_id: frame.stream_id, reason: code, lease_ref: frame.lease_ref });
          try { this.#sendError(code, frame); } catch {}
          // clear only the named stream's utterance if any
          const state = this.pipeline ? this.pipeline.getActiveUtterance(frame.session_epoch, frame.stream_id) : null;
          if (state) {
            try { this.pipeline.handleCancel({ sessionEpoch: frame.session_epoch, streamId: frame.stream_id, payload: { utterance_id: state.utteranceId, reason: code } }); } catch {}
          }
          continue;
        }
        this.#sendError(code);
        this.close(code);
        return;
      }
    }
  }

  #handle(frame) {
    if (frame.direction !== "uplink") {
      throw new QuestSurfaceProtocolError("direction_mismatch", "Client frame direction must be uplink.");
    }
    // v1a bootstrap: hello must be stream 0
    if (!this.helloReceived && frame.stream_id !== 0) {
      throw new QuestSurfaceProtocolError("stream_id_unsupported", "v1a accepts stream 0 only.");
    }
    // after hello, panel ack must be stream 0; audio streams may use any id
    if (this.helloReceived && frame.type === "ACTUAL_BOUNDS_ACK" && frame.stream_id !== 0) {
      throw new QuestSurfaceProtocolError("stream_id_unsupported", "ACTUAL_BOUNDS_ACK must be stream 0.");
    }
    if (this.helloReceived && frame.type === "PANEL_SNAPSHOT" && frame.stream_id !== 0) {
      throw new QuestSurfaceProtocolError("stream_id_unsupported", "PANEL_SNAPSHOT must be stream 0.");
    }
    const sequenceKey = `${frame.session_epoch}:${frame.stream_id}:${frame.direction}`;
    const seq = BigInt(frame.seq);
    const priorSeq = this.clientSequences.get(sequenceKey) ?? 0n;
    if (seq <= priorSeq) {
      throw new QuestSurfaceProtocolError("sequence_stale", "Client sequence must increase.");
    }
    this.clientSequences.set(sequenceKey, seq);

    if (!this.helloReceived) {
      if (frame.type !== "HELLO" || frame.session_epoch !== "0") {
        throw new QuestSurfaceProtocolError("hello_required", "HELLO must be the first client frame.");
      }
      this.#handleHello(frame);
      return;
    }
    if (frame.session_epoch !== this.sessionEpoch) {
      throw new QuestSurfaceProtocolError("session_epoch_mismatch", "Client session epoch does not match.");
    }
    if (frame.type === "ACTUAL_BOUNDS_ACK") {
      this.#handleBoundsAck(frame);
      return;
    }
    if (frame.type === "FOCUS_LOST" || frame.type === "SUSPEND") {
      this.micLatch.latch(frame.type.toLowerCase(), this.sessionEpoch, this.now());
      if (this.pipeline) this.pipeline.handleLifecycleClose(frame.type.toLowerCase());
      this.eventSink("quest.surface.session_narrowed", {
        session_epoch: this.sessionEpoch,
        lease_id: this.lease?.lease_id ?? this.manifest?.leases?.panel?.lease_id ?? "",
        reason: frame.type.toLowerCase(),
        lifecycle_report_authority_effect: "narrow_only",
        mic_latch: this.micLatch.isLatched(),
        latched_epoch: this.micLatch.latchedEpoch,
      });
      this.#send("TEARDOWN_ACK", {}, { leaseRef: "", streamId: 0 });
      this.socket.end();
      return;
    }
    if (QUEST_SURFACE_AUDIO_FRAME_TYPES.has(frame.type)) {
      this.#handleAudioFrame(frame);
      return;
    }
    throw new QuestSurfaceProtocolError("message_type_unexpected", "Client message type is unexpected.");
  }

  #handleAudioFrame(frame) {
    // #1: audio requires active v1b manifest — panel-only lease must not authorize pipeline
    if (!this.manifest) {
      throw new QuestSurfaceProtocolError("manifest_required", "Audio requires active v1b manifest");
    }
    // mic-off latch: capture forbidden while latched
    if (this.micLatch.isLatched() && frame.type !== "CANCEL") {
      // CANCEL is allowed to clear, but other audio is rejected per-stream
      throw new QuestSurfaceProtocolError("mic_latch_active", "Mic capture is latched off; deliberate resume required.");
    }
    if (!frame.lease_ref) throw new QuestSurfaceProtocolError("lease_ref_required", "Audio frame requires lease_ref");
    // bind every audio frame including CANCEL to mic leaf
    if (frame.lease_ref !== this.manifest.leases.mic_capture.lease_id) {
      throw new QuestSurfaceProtocolError("lease_ref_mismatch", "Audio lease_ref must be mic_capture leaf");
    }
    // stream-scoped handling: delegate to pipeline with per-stream isolation
    try {
      switch (frame.type) {
        case "UTTERANCE_START": {
        if (!this.pipeline) this.#ensurePipeline();
        this.pipeline.handleUtteranceStart({ sessionEpoch: frame.session_epoch, streamId: frame.stream_id, payload: frame.payload, leaseRef: frame.lease_ref });
        break;
        }
        case "AUDIO_CHUNK": {
        if (!this.pipeline) throw new QuestSurfaceProtocolError("utterance_not_started", "No utterance");
        // decode and let pipeline validate channels/direction; pipeline will check utterance_id
        this.pipeline.handleAudioChunk({ sessionEpoch: frame.session_epoch, streamId: frame.stream_id, payload: frame.payload });
        break;
        }
        case "UTTERANCE_END": {
        if (!this.pipeline) throw new QuestSurfaceProtocolError("utterance_not_started", "No utterance");
        // F2 sync pre-check: utterance_id mismatch must clear exact stream synchronously before async, so retry on same stream can succeed
        try {
          const active = this.pipeline.getActiveUtterance(frame.session_epoch, frame.stream_id);
          const endId = frame.payload?.utterance_id;
          if (active && endId && active.utteranceId !== endId) {
            try { this.pipeline.handleCancel({ sessionEpoch: frame.session_epoch, streamId: frame.stream_id, payload: { utterance_id: active.utteranceId, reason: "utterance_id_mismatch" } }); } catch {}
            throw new QuestSurfaceProtocolError("utterance_id_mismatch", `End utterance ${endId} != active ${active.utteranceId}`);
          }
        } catch (e) {
          if (e instanceof QuestSurfaceProtocolError) throw e;
        }
        // async pipeline - do not block #handle; run and eventually send paired answer
        this.#handleUtteranceEndAsync(frame);
        break;
        }
        case "CANCEL": {
        // cancel flushes only its named stream/utterance (already bound to mic leaf above)
        if (!this.pipeline) break;
        const payload = frame.payload;
        try { decodeCancelPayload(payload); } catch (e) { throw e; }
        this.pipeline.handleCancel({ sessionEpoch: frame.session_epoch, streamId: frame.stream_id, payload });
        break;
        }
        default: throw new QuestSurfaceProtocolError("message_type_unexpected", "Audio type unexpected");
      }
    } catch (error) {
      if (error instanceof QuestSurfaceProtocolError) {
        // stream-scoped: clear only that stream's utterance if it exists, but do not emit here — let #onData emit once
        const state = this.pipeline ? this.pipeline.getActiveUtterance(frame.session_epoch, frame.stream_id) : null;
        if (state) {
          try { this.pipeline.handleCancel({ sessionEpoch: frame.session_epoch, streamId: frame.stream_id, payload: { utterance_id: state.utteranceId, reason: error.code } }); } catch {}
        }
        throw error;
      }
      throw error;
    }
  }

  #ensurePipeline() {
    if (this.pipeline) return;
    const leaseRefFor = (kind, epoch) => {
      if (this.manifest) {
        if (kind === "panel") return this.manifest.leases.panel.lease_id;
        if (kind === "audio_present") return this.manifest.leases.audio_present.lease_id;
      }
      return this.lease?.lease_id ?? "";
    };
    this.pipeline = (this.pipelineFactory ?? createQuestSurfaceAudioPipeline)({
      panelBase: this.panel,
      leaseRefFor,
      nextRevision: () => {
        this.revisionCounter += 1n;
        return this.revisionCounter.toString(10);
      },
      eventSink: (e) => this.eventSink(e.type ?? e.event_type, e),
      logger: this.logger,
      // Item-I real execution path: when real answer stages are configured they
      // replace the fixture transcribe/chat/synthesize; the pipeline's abort-aware
      // withAbort wrapping makes them interruptible. Absent, fixtures are used.
      ...(this.answerStages ?? {}),
    });
  }

  async #handleUtteranceEndAsync(frame) {
    const authorizeLocalAttach = async () => {
      if (!this.manifest || !this.manifest.leases.local_attach) return { allowed: false, code: "local_attach_missing" };
      const grantId = this.manifest.leases.local_attach.source_grant_id;
      // re-authorize exact grant id, provider, scope
      const scope = this.manifest.leases.local_attach.scope;
      const auth = authorizeGrantUse({
        store: this.grantStore,
        grantId,
        capability: QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH,
        provider: "soma.provider.local-model",
        scope,
        recoveryReport: this.grantRecoveryReport,
        catalog: this.capabilityCatalog,
        providerRegistry: this.providerRegistry,
      });
      if (!auth.allowed) return auth;
      // also check TTL expiry vs manifest expiry via injected clock (inclusive: now >= expiry is expired)
      if (this.now() >= this.manifest.expires_at_ms) {
        return { allowed: false, code: "grant_expired", grant: null };
      }
      // #B: for `once`, atomically reserve at sink boundary before chat (not during recheck)
      if (auth.grant.scope === "once") {
        if (!this.tryReserveOnceGrant(grantId)) {
          return { allowed: false, code: "grant_already_consumed", grant: null };
        }
      }
      return auth;
    };
    // wrap to separate recheck vs reserve: first recheck (no reserve), second recheck reserves
    let firstCheckDone = false;
    const authorizeLocalAttachRecheck = async () => {
      if (!firstCheckDone) {
        firstCheckDone = true;
        // first call after STT: just recheck without reserving
        if (!this.manifest || !this.manifest.leases.local_attach) return { allowed: false, code: "local_attach_missing" };
        const grantId = this.manifest.leases.local_attach.source_grant_id;
        const scope = this.manifest.leases.local_attach.scope;
        const auth = authorizeGrantUse({
          store: this.grantStore,
          grantId,
          capability: QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH,
          provider: "soma.provider.local-model",
          scope,
          recoveryReport: this.grantRecoveryReport,
          catalog: this.capabilityCatalog,
          providerRegistry: this.providerRegistry,
        });
        if (!auth.allowed) return auth;
        if (auth.grant.scope === "once" && this.consumedOnceGrants.has(grantId)) {
          return { allowed: false, code: "grant_already_consumed", grant: null };
        }
        if (this.now() >= this.manifest.expires_at_ms) return { allowed: false, code: "grant_expired", grant: null };
        return auth;
      }
      return authorizeLocalAttach();
    };
    // I-1 second enforcement point: provider selection must prove same tuple as manifest issuance (hard floor)
    const episodeForAnswer = this.getArmedEpisode ? this.getArmedEpisode() : null;
    if (episodeForAnswer && episodeForAnswer.mode) {
      try {
        // manifest for matching is the issued manifest (contains real leases)
        matchAnswerProvider({ armedEpisode: episodeForAnswer, providerRegistry: this.providerRegistry, manifest: this.manifest });
      } catch (err) {
        const code = err.code ?? "answer_mode_mismatch";
        this.eventSink("quest.surface.answer_failed", { session_epoch: frame.session_epoch, stream_id: frame.stream_id, reason: code, utterance_id: frame.payload?.utterance_id ?? "" });
        try { this.#sendError(code, frame); } catch {}
        return;
      }
    }
    try {
      const result = await this.pipeline.handleUtteranceEnd({ sessionEpoch: frame.session_epoch, streamId: frame.stream_id, payload: frame.payload, manifestLeases: this.manifest ? this.manifest.leases : null, authorizeLocalAttach: authorizeLocalAttachRecheck });
      if (result.dropped) {
        return;
      }
      // paired panel + playback: send as downlink with correlated answer_id
      // (once already reserved atomically before chat, no additional add needed)
      const panelLeaseRef = this.manifest ? this.manifest.leases.panel.lease_id : this.lease.lease_id;
      const audioLeaseRef = this.manifest ? this.manifest.leases.audio_present.lease_id : this.lease.lease_id;
      // new panel revision
      this.snapshot = result.panelPayload; // update for ack validation
      this.#send("PANEL_SNAPSHOT", result.panelPayload, { leaseRef: panelLeaseRef, streamId: 0 });
      // playback chunks: each with same answer_id+utterance_id, stereo downlink
      // use a dedicated playback stream (e.g., incoming streamId + 100) to keep isolation
      const playbackStreamId = (Number(frame.stream_id) + 100) % 0xffff_ffff;
      for (const chunk of result.ttsChunks) {
        this.#send("AUDIO_CHUNK", chunk, { leaseRef: audioLeaseRef, streamId: playbackStreamId });
      }
      // H: terminal ANSWER_END after chunks — same stream/lease, exact correlation, drain-then-clear
      const answerEnd = createAnswerEndPayload({ utteranceId: result.utteranceId, answerId: result.answerId });
      this.#send("ANSWER_END", answerEnd, { leaseRef: audioLeaseRef, streamId: playbackStreamId });
      this.eventSink("quest.surface.answer_delivered", {
        session_epoch: frame.session_epoch,
        stream_id: frame.stream_id,
        utterance_id: result.utteranceId,
        answer_id: result.answerId,
        panel_revision: result.revision,
        playback_stream_id: playbackStreamId,
        local_only: true,
      });
    } catch (error) {
      const code = error instanceof QuestSurfaceProtocolError ? error.code : "answer_pipeline_failed";
      // F2: clear exact failed stream's PCM/state when active, as sync path does
      try {
        const state = this.pipeline ? this.pipeline.getActiveUtterance(frame.session_epoch, frame.stream_id) : null;
        if (state) {
          try { this.pipeline.handleCancel({ sessionEpoch: frame.session_epoch, streamId: frame.stream_id, payload: { utterance_id: state.utteranceId, reason: code } }); } catch {}
        }
      } catch {}
      this.eventSink("quest.surface.answer_failed", { session_epoch: frame.session_epoch, stream_id: frame.stream_id, reason: code, utterance_id: frame.payload?.utterance_id ?? "" });
      try { this.#sendError(code, frame); } catch {}
    }
  }

  #handleHello(frame) {
    const selectedVersion = selectHighestQuestSurfaceVersion(frame.payload?.supported_versions);
    if (selectedVersion === null) {
      this.#sendError("version_no_overlap");
      this.close("version_no_overlap");
      return;
    }
    // #A: require exact configured panel grant + bounded episode for v1b
    const panelAuthForManifest = this.authorize();
    // Try v1b manifest first if the store has grants for all four capabilities and episode is armed
    const manifestAuth = this.#tryAuthorizeManifest(panelAuthForManifest);
    if (manifestAuth && manifestAuth.allowed) {
      this.helloReceived = true;
      this.lease = manifestAuth.leases.panel; // for backward compat ack path
      this.manifest = manifestAuth.manifest;
      const ttlMs = this.manifest.ttl_ms;
      this.snapshot = createPanelSnapshotPayload({
        revision: this.panel.revision,
        leaseRef: this.manifest.leases.panel.lease_id,
        text: this.panel.text,
        surfaceId: this.panel.surface_id,
        ttlMs: Math.min(this.panel.ttl_ms, ttlMs),
        pose: this.panel.pose,
        bounds: this.panel.bounds,
      });
      this.#send("HELLO_ACK", {
        selected_version: selectedVersion,
        provider: QUEST_SURFACE_PROVIDER_ID,
        supported_render_extensions: [],
      }, { leaseRef: "" });
      this.#send("LEASE_MANIFEST", this.manifest, { leaseRef: "" });
      // backward compat LEASE for existing clients
      this.#send("LEASE", this.manifest.leases.panel, { leaseRef: "" });
      this.#send("PANEL_SNAPSHOT", this.snapshot, { leaseRef: this.manifest.leases.panel.lease_id });
      this.eventSink("quest.surface.snapshot_sent", {
        session_epoch: this.sessionEpoch,
        lease_id: this.manifest.leases.panel.lease_id,
        source_grant_id: manifestAuth.grantIds.panel,
        capability: QUEST_SURFACE_CAPABILITY,
        provider: QUEST_SURFACE_PROVIDER_ID,
        document_revision: this.panel.revision,
        document_hash: this.snapshot.document_sha256,
        surface_id: this.panel.surface_id,
        panel_text_bytes: Buffer.byteLength(this.panel.text, "utf8"),
        panel_text_included: false,
        manifest: true,
      });
      this.leaseTimer = setTimeout(() => {
        this.#sendError("lease_expired");
        this.close("lease_expired");
      }, ttlMs);
      this.leaseTimer.unref?.();
      return;
    }

    const authorization = this.authorize();
    if (!authorization.allowed) {
      this.eventSink("quest.surface.lease_refused", {
        session_epoch: this.sessionEpoch,
        grant_id: "",
        reason: authorization.code,
        panel_sent: false,
      });
      this.#sendError("grant_not_authorized");
      this.socket.end();
      return;
    }

    this.helloReceived = true;
    const constraintTtl = Number.isSafeInteger(authorization.grant.constraints?.lease_ttl_ms)
      ? authorization.grant.constraints.lease_ttl_ms
      : this.leaseTtlMs;
    const ttlMs = Math.max(1, Math.min(
      this.leaseTtlMs,
      constraintTtl,
      QUEST_SURFACE_MAX_LEASE_TTL_MS,
    ));
    this.lease = createQuestSurfaceLease({
      sessionEpoch: this.sessionEpoch,
      sourceGrant: authorization.grant,
      ttlMs,
      issuedAtMs: this.now(),
    });
    this.snapshot = createPanelSnapshotPayload({
      revision: this.panel.revision,
      leaseRef: this.lease.lease_id,
      text: this.panel.text,
      surfaceId: this.panel.surface_id,
      ttlMs: Math.min(this.panel.ttl_ms, ttlMs),
      pose: this.panel.pose,
      bounds: this.panel.bounds,
    });

    this.#send("HELLO_ACK", {
      selected_version: selectedVersion,
      provider: QUEST_SURFACE_PROVIDER_ID,
      supported_render_extensions: [],
    }, { leaseRef: "" });
    this.#send("LEASE", this.lease, { leaseRef: "" });
    this.#send("PANEL_SNAPSHOT", this.snapshot, { leaseRef: this.lease.lease_id });
    this.eventSink("quest.surface.snapshot_sent", {
      session_epoch: this.sessionEpoch,
      lease_id: this.lease.lease_id,
      source_grant_id: authorization.grant.id,
      capability: QUEST_SURFACE_CAPABILITY,
      provider: QUEST_SURFACE_PROVIDER_ID,
      document_revision: this.panel.revision,
      document_hash: this.snapshot.document_sha256,
      surface_id: this.panel.surface_id,
      panel_text_bytes: Buffer.byteLength(this.panel.text, "utf8"),
      panel_text_included: false,
    });
    this.leaseTimer = setTimeout(() => {
      this.#sendError("lease_expired");
      this.close("lease_expired");
    }, ttlMs);
    this.leaseTimer.unref?.();
  }

  #tryAuthorizeManifest(panelAuth) {
    // #A: require exact configured panel grant and bounded episode
    if (!panelAuth || !panelAuth.allowed) {
      this.eventSink("quest.surface.manifest_not_armed", { reason: "panel_auth_failed", code: panelAuth?.code ?? "no_panel_auth" });
      return null;
    }
    // verify the panel grant is exactly the configured one and device-bound checks passed via #authorize
    if (panelAuth.grant.id !== this.configuredPanelGrantId) {
      this.eventSink("quest.surface.manifest_not_armed", { reason: "panel_grant_mismatch", expected: this.configuredPanelGrantId, actual: panelAuth.grant.id });
      return null;
    }
    // #2: require bounded armed episode (not timeless boolean) — provider lifetime, read via getter
    const episode = this.getArmedEpisode ? this.getArmedEpisode() : null;
    if (!episode || !episode.id || this.now() >= episode.expiresAtMs) {
      this.eventSink("quest.surface.manifest_not_armed", { reason: "episode_not_armed_or_expired", episode: episode?.id ?? "none" });
      return null;
    }
    // v1b: require exact grants for all four capabilities; returns manifest if all authorized
    // Fix 1: panel leaf pinned to panelAuth.grant to prevent divergence when multiple panel grants are active
    const caps = [
      { key: QUEST_SURFACE_CAPABILITY_MIC_CAPTURE, scope: "session", id: "mic_capture" },
      { key: QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT, scope: "session", id: "audio_present" },
      { key: QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH, scope: "once", id: "local_attach" },
    ];
    const leases = {};
    const grantIds = {};
    // verify non-panel leaves are authorized (also try window scope for local_attach)
    for (const { key, scope } of caps) {
      let auth = authorizeGrantUse({
        store: this.grantStore,
        grantId: "",
        capability: key,
        provider: key === QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH ? "soma.provider.local-model" : QUEST_SURFACE_PROVIDER_ID,
        scope,
        recoveryReport: this.grantRecoveryReport,
        catalog: this.capabilityCatalog,
        providerRegistry: this.providerRegistry,
      });
      if (!auth.allowed && key === QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH) {
        auth = authorizeGrantUse({
          store: this.grantStore,
          grantId: "",
          capability: key,
          provider: "soma.provider.local-model",
          scope: "window",
          recoveryReport: this.grantRecoveryReport,
          catalog: this.capabilityCatalog,
          providerRegistry: this.providerRegistry,
        });
      }
      if (!auth.allowed) {
        this.eventSink("quest.surface.manifest_auth_failed", { capability: key, scope, reason: auth.code, details: auth.details });
        return null;
      }
    }
    // #4: use minimum TTL across runtime and all leaves, preserve synchronous revocation (panel leaf via panelAuth)
    let ttlMs = this.leaseTtlMs;
    // panel leaf TTL from pinned grant
    if (Number.isSafeInteger(panelAuth.grant.constraints?.lease_ttl_ms)) {
      ttlMs = Math.min(ttlMs, panelAuth.grant.constraints.lease_ttl_ms);
    }
    for (const { key, scope } of caps) {
      let auth = authorizeGrantUse({
        store: this.grantStore,
        capability: key,
        provider: key === QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH ? "soma.provider.local-model" : QUEST_SURFACE_PROVIDER_ID,
        scope,
        recoveryReport: this.grantRecoveryReport,
        catalog: this.capabilityCatalog,
        providerRegistry: this.providerRegistry,
      });
      if (!auth.allowed && key === QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH) {
        auth = authorizeGrantUse({
          store: this.grantStore,
          capability: key,
          provider: "soma.provider.local-model",
          scope: "window",
          recoveryReport: this.grantRecoveryReport,
          catalog: this.capabilityCatalog,
          providerRegistry: this.providerRegistry,
        });
      }
      if (auth.allowed && Number.isSafeInteger(auth.grant.constraints?.lease_ttl_ms)) {
        ttlMs = Math.min(ttlMs, auth.grant.constraints.lease_ttl_ms);
      }
    }
    ttlMs = Math.max(1, Math.min(ttlMs, QUEST_SURFACE_MAX_LEASE_TTL_MS));
    const issuedAtMs = this.now();
    // Fix 3: cap manifest TTL to remaining episode lifetime
    const episodeRemaining = episode.expiresAtMs - issuedAtMs;
    if (episodeRemaining <= 0) {
      this.eventSink("quest.surface.manifest_not_armed", { reason: "episode_expired_at_issue", episode: episode.id });
      return null;
    }
    ttlMs = Math.min(ttlMs, episodeRemaining);
    // pin panel leaf to exact configured grant
    {
      const lease = createQuestSurfaceLease({
        sessionEpoch: this.sessionEpoch,
        sourceGrant: panelAuth.grant,
        ttlMs,
        issuedAtMs,
      });
      leases["panel"] = lease;
      grantIds["panel"] = panelAuth.grant.id;
    }
    for (const { key, scope, id } of caps) {
      const provider = key === QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH ? "soma.provider.local-model" : QUEST_SURFACE_PROVIDER_ID;
      let auth = authorizeGrantUse({
        store: this.grantStore,
        grantId: "",
        capability: key,
        provider,
        scope,
        recoveryReport: this.grantRecoveryReport,
        catalog: this.capabilityCatalog,
        providerRegistry: this.providerRegistry,
      });
      if (!auth.allowed && key === QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH) {
        auth = authorizeGrantUse({
          store: this.grantStore,
          capability: key,
          provider: "soma.provider.local-model",
          scope: "window",
          recoveryReport: this.grantRecoveryReport,
          catalog: this.capabilityCatalog,
          providerRegistry: this.providerRegistry,
        });
      }
      if (!auth.allowed) return null;
      const lease = createQuestSurfaceLease({
        sessionEpoch: this.sessionEpoch,
        sourceGrant: auth.grant,
        ttlMs,
        issuedAtMs,
      });
      leases[id] = lease;
      grantIds[id] = auth.grant.id;
    }
    try {
      const manifest = createLeaseManifestPayload({
        sessionEpoch: this.sessionEpoch,
        ttlMs,
        issuedAtMs,
        leases,
      });
      // I-1 first enforcement point: manifest issuance must prove same tuple as provider selection (hard floor for audio)
      const episodeForManifest = this.getArmedEpisode ? this.getArmedEpisode() : null;
      if (episodeForManifest && episodeForManifest.mode) {
        try {
          matchAnswerProvider({ armedEpisode: episodeForManifest, providerRegistry: this.providerRegistry, manifest });
        } catch (err) {
          this.eventSink("quest.surface.manifest_not_armed", { reason: "answer_mode_mismatch", code: err.code ?? String(err.message), mode: episodeForManifest.mode });
          return null;
        }
      }
      return { allowed: true, leases, manifest, grantIds };
    } catch {
      return null;
    }
  }

  #handleBoundsAck(frame) {
    if (!this.lease || frame.lease_ref !== this.lease.lease_id) {
      throw new QuestSurfaceProtocolError("lease_ref_mismatch", "Bounds acknowledgement lease does not match.");
    }
    const expectedDocument = decodePanelSnapshotPayload(this.snapshot);
    const payload = frame.payload;
    requireAckObject(payload);
    if (payload.document_revision !== expectedDocument.document.revision
        || payload.document_hash !== expectedDocument.document_hash
        || payload.surface_id !== expectedDocument.document.surface.id) {
      throw new QuestSurfaceProtocolError(
        "bounds_ack_snapshot_mismatch",
        "Bounds acknowledgement does not match the displayed snapshot.",
      );
    }
    const requestedBounds = expectedDocument.document.surface.bounds;
    const expectedBounds = {
      width_m: Math.max(0.35, Math.min(2.0, requestedBounds.width_m)),
      height_m: Math.max(0.20, Math.min(1.2, requestedBounds.height_m)),
    };
    if (Math.abs(payload.actual_bounds.width_m - expectedBounds.width_m) > 1e-5
        || Math.abs(payload.actual_bounds.height_m - expectedBounds.height_m) > 1e-5) {
      throw new QuestSurfaceProtocolError(
        "bounds_ack_actual_mismatch",
        "Bounds acknowledgement does not match the deterministic v1a clamp.",
      );
    }
    this.eventSink("quest.surface.snapshot_acknowledged", {
      session_epoch: this.sessionEpoch,
      lease_id: this.lease.lease_id,
      document_revision: payload.document_revision,
      document_hash: payload.document_hash,
      surface_id: payload.surface_id,
      actual_width_m: payload.actual_bounds.width_m,
      actual_height_m: payload.actual_bounds.height_m,
      displayed: payload.displayed === true,
    });
  }

  #send(type, payload, { leaseRef = this.lease?.lease_id ?? "", streamId = 0 } = {}) {
    if (this.closed) {
      return;
    }
    const epoch = type === "ERROR" && !this.helloReceived ? "0" : this.sessionEpoch;
    const sid = Number.isSafeInteger(streamId) ? streamId : 0;
    const sequenceKey = `${epoch}:${sid}:downlink`;
    const seq = (this.serverSequences.get(sequenceKey) ?? 0n) + 1n;
    this.serverSequences.set(sequenceKey, seq);
    const frame = createQuestSurfaceFrame({
      type,
      sessionEpoch: epoch,
      streamId: sid,
      direction: "downlink",
      leaseRef,
      seq,
      sendTsNs: monotonicNowNs(),
      payload,
    });
    this.socket.write(serializeQuestSurfaceFrame(frame));
  }

  #sendError(code, frame = null) {
    try {
      if (frame) {
        this.#send("ERROR", { code: String(code), retryable: false }, { leaseRef: "", streamId: Number(frame.stream_id ?? 0) });
      } else {
        this.#send("ERROR", { code: String(code), retryable: false }, { leaseRef: "" });
      }
    } catch {
      // The connection will close. Never broaden behavior to recover an error report.
    }
  }
}

export function createQuestSurfaceFixtureProvider(options) {
  return new QuestSurfaceFixtureProvider(options);
}

function validateTlsOptions(options) {
  if (!options || !options.key || !options.cert || !options.ca) {
    throw providerError(
      "quest_surface_tls_configuration_required",
      "Quest surface fixture requires server key, certificate, and client CA.",
    );
  }
  return options;
}

function normalizePanel(panel = {}) {
  const merged = {
    ...DEFAULT_PANEL,
    ...panel,
    pose: panel.pose ?? DEFAULT_PANEL.pose,
    bounds: panel.bounds ?? DEFAULT_PANEL.bounds,
  };
  createPanelSnapshotPayload({
    revision: merged.revision,
    leaseRef: "validation-lease",
    text: merged.text,
    surfaceId: merged.surface_id,
    ttlMs: merged.ttl_ms,
    pose: merged.pose,
    bounds: merged.bounds,
  });
  return merged;
}

function requireAckObject(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new QuestSurfaceProtocolError("bounds_ack_invalid", "Bounds acknowledgement must be an object.");
  }
  const expected = new Set([
    "document_revision",
    "document_hash",
    "surface_id",
    "actual_bounds",
    "displayed",
  ]);
  if (Object.keys(payload).length !== expected.size
      || Object.keys(payload).some((key) => !expected.has(key))) {
    throw new QuestSurfaceProtocolError("bounds_ack_fields_invalid", "Bounds acknowledgement fields are invalid.");
  }
  const bounds = payload.actual_bounds;
  if (!bounds || typeof bounds !== "object" || Array.isArray(bounds)
      || Object.keys(bounds).length !== 2
      || !Number.isFinite(bounds.width_m)
      || !Number.isFinite(bounds.height_m)
      || bounds.width_m <= 0
      || bounds.height_m <= 0) {
    throw new QuestSurfaceProtocolError("bounds_ack_actual_invalid", "Actual panel bounds are invalid.");
  }
  if (typeof payload.displayed !== "boolean") {
    throw new QuestSurfaceProtocolError("bounds_ack_displayed_invalid", "Displayed status must be boolean.");
  }
}

function normalizeFingerprint(value) {
  return String(value ?? "").replaceAll(":", "").trim().toUpperCase();
}

function validateQuestGrantConstraints(constraints) {
  if (!constraints || typeof constraints !== "object" || Array.isArray(constraints)) {
    return "quest_surface_grant_constraints_invalid";
  }
  const allowed = new Set([
    "allowed_surface_ids",
    "max_panel_text_bytes",
    "lease_ttl_ms",
    "device_fingerprint256",
  ]);
  if (Object.keys(constraints).some((key) => !allowed.has(key))) {
    return "quest_surface_grant_constraint_unknown";
  }
  if (Object.hasOwn(constraints, "allowed_surface_ids")) {
    const ids = constraints.allowed_surface_ids;
    if (!Array.isArray(ids)
        || ids.length < 1
        || ids.length > 16
        || ids.some((id) => typeof id !== "string" || !id.trim() || id.trim().length > 256)) {
      return "quest_surface_grant_surface_ids_invalid";
    }
  }
  if (Object.hasOwn(constraints, "max_panel_text_bytes")
      && (!Number.isSafeInteger(constraints.max_panel_text_bytes)
        || constraints.max_panel_text_bytes < 1
        || constraints.max_panel_text_bytes > QUEST_SURFACE_MAX_PANEL_TEXT_BYTES)) {
    return "quest_surface_grant_text_bound_invalid";
  }
  if (Object.hasOwn(constraints, "lease_ttl_ms")
      && (!Number.isSafeInteger(constraints.lease_ttl_ms)
        || constraints.lease_ttl_ms < 1
        || constraints.lease_ttl_ms > QUEST_SURFACE_MAX_LEASE_TTL_MS)) {
    return "quest_surface_grant_lease_ttl_invalid";
  }
  if (Object.hasOwn(constraints, "device_fingerprint256")
      && typeof constraints.device_fingerprint256 !== "string") {
    return "quest_surface_grant_fingerprint_invalid";
  }
  return "";
}

function requireText(value, code) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw providerError(code, "Quest surface fixture requires a configured grant id.");
  }
  return text;
}

function boundedInteger(value, min, max, code) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw providerError(code, "Quest surface fixture integer is outside its allowed range.");
  }
  return value;
}

function boundedErrorCode(error) {
  const code = String(error?.code ?? error?.name ?? "transport_error");
  return code.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 96);
}

function providerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

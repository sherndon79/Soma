// SensoriumSubscriber — the composition layer that ties together the
// step-9c helper manager, the step-3 request validator, the step-5
// provenance shapes, and the step-6 disclosure shape into a single
// API surface that a future HTTP route (or capability handler) can
// invoke.
//
// Concrete responsibilities:
//
//   start(args)        validate the request body, ask the manager to
//                      open a Zenoh subscription, build the start
//                      provenance summary, track the subscription
//                      locally with declared constraints + grant
//                      context, return subscription_id + startSummary
//
//   stop(id, reason)   ask the manager to close the subscription,
//                      build the end provenance summary using the
//                      tracked counters, return endSummary
//
//   describeActive()   render the disclosure shape for currently
//                      active subscriptions
//
// Subscriptions track sample counts from helper notifications so the
// end summary's framesConsumed counter is honest.
//
// Public capability path stays fail-closed because no HTTP route or
// CLI command currently instantiates this class. It's the last
// building block before activation (step 9e).

import {
  createSensoriumSubscriptionEndSummary,
  createSensoriumSubscriptionStartSummary,
} from "./sensoriumSubscriptionProvenance.js";
import { summarizeSensoriumColorPayload } from "./sensoriumColorPayload.js";
import { summarizeSensoriumDepthPayload } from "./sensoriumDepthPayload.js";
import { summarizeSensoriumPresencePayload } from "./sensoriumPresencePayload.js";
import { summarizeSensoriumPosePayload } from "./sensoriumPosePayload.js";
import { summarizeSensoriumStatusPayload } from "./sensoriumStatusPayload.js";
import { createSensoriumStreamAnchor } from "./sensoriumStreamAnchor.js";
import { describeActiveSensoriumSubscriptions } from "./sensoriumSubscriptionDisclosure.js";
import { validateSensoriumSubscriptionRequest } from "./sensoriumSubscriptionRequest.js";
import {
  createDepthPresenceSemanticEvent,
  validateBrokerDepthPresenceEvent,
} from "./sensoriumTier.js";

const SENSORIUM_SAMPLE_NOTIFICATION = "sensorium.subscription.sample";
const SENSORIUM_ERROR_NOTIFICATION = "sensorium.subscription.error";
const PRESENCE_CAPABILITY = "perception.sensorium.presence.subscribe";
const POSE_CAPABILITY = "perception.sensorium.pose.subscribe";
const STALL_STARTUP_GRACE_MS = 10_000;
const STALL_MIN_SAMPLE_GAP_MS = 10_000;
const STALL_SAMPLE_PERIOD_MULTIPLIER = 4;
const RAW_FRAME_MODALITY_BY_CAPABILITY = Object.freeze({
  "perception.sensorium.color.subscribe": "color",
  "perception.sensorium.depth.subscribe": "depth",
  "perception.sensorium.pose.subscribe": "pose",
});

export class SensoriumSubscriber {
  #manager;
  #active = new Map();
  #notificationHandlerInstalled = false;
  #now;
  #zenohConfigPath;
  #setTimeout;
  #clearTimeout;
  #onSubscriptionEnded;
  #presenceState;
  #getPresenceEpisodeContext;
  #rawLatestFrames = new Map();

  constructor({
    manager,
    now = () => new Date(),
    zenohConfigPath = "",
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    onSubscriptionEnded = null,
    presenceState = null,
    getPresenceEpisodeContext = () => null,
  } = {}) {
    if (!manager) {
      throw new TypeError("SensoriumSubscriber requires a manager");
    }
    this.#manager = manager;
    this.#now = now;
    this.#zenohConfigPath = String(zenohConfigPath ?? "").trim();
    this.#setTimeout = setTimeoutFn;
    this.#clearTimeout = clearTimeoutFn;
    this.#onSubscriptionEnded =
      typeof onSubscriptionEnded === "function" ? onSubscriptionEnded : null;
    this.#presenceState = presenceState;
    this.#getPresenceEpisodeContext =
      typeof getPresenceEpisodeContext === "function" ? getPresenceEpisodeContext : () => null;
  }

  /**
   * Activate a Sensorium subscription. Composes the validator, the
   * helper invocation, and the start provenance summary.
   *
   * Throws synchronously on validation failure (the request body is
   * malformed) and asynchronously on helper failure (the helper
   * rejected the request — bad config, Zenoh open error, etc.).
   */
  async start({ capability, provider, grantId, scope, body, rawFrameRetention = null } = {}) {
    const validated = validateSensoriumSubscriptionRequest(body, { capability });

    this.#installNotificationHandlerIfNeeded();

    const helperResult = await this.#manager.send(
      "sensorium.subscribe.start",
      stripEmpty({
        topic: validated.topic,
        zenoh_config_path: this.#zenohConfigPath,
        max_fps: validated.constraints?.max_fps,
        downsample_to: cameraClassOnly(capability, validated.constraints?.downsample_to),
        format_required: cameraClassOnly(capability, validated.constraints?.format_required),
      }),
    );

    const subscriptionId = helperResult.subscription_id;
    const startedAtUnix =
      typeof helperResult.started_at === "number"
        ? helperResult.started_at
        : this.#now().getTime() / 1000;
    const startedAtISO = new Date(startedAtUnix * 1000).toISOString();

    const startSummary = createSensoriumSubscriptionStartSummary({
      capability,
      provider,
      grantId,
      scope,
      topic: validated.topic,
      constraints: validated.constraints,
      startedAt: startedAtISO,
    });

    const expiresAtISO = computeExpiresAtISO({
      startedAtUnix,
      maxSeconds: validated.constraints?.max_seconds,
    });

    const record = {
      subscription_id: subscriptionId,
      capability,
      provider,
      grant_id: grantId,
      scope,
      topic: validated.topic,
      constraints_declared: validated.constraints,
      started_at: startedAtUnix,
      started_at_iso: startedAtISO,
      expires_at_iso: expiresAtISO,
      _timeoutHandle: null,
      _startSummary: startSummary,
      _stats: {
        framesConsumed: 0,
        schemaVersionObserved: null,
        schemaMismatches: 0,
        firstFrameNumber: null,
        lastFrameNumber: null,
        statusSummaryObserved: null,
        streamSummaryObserved: null,
        poseSummaryObserved: null,
        helperErrorClass: "",
        lastNotificationAt: null,
      },
      _rawFrameRetention: normalizeRawFrameRetention(rawFrameRetention, {
        capability,
        grantId,
        topic: validated.topic,
        now: this.#now,
      }),
    };
    this.#active.set(subscriptionId, record);
    this.#scheduleTimeout(record, validated.constraints?.max_seconds);

    return {
      subscription_id: subscriptionId,
      topic: validated.topic,
      started_at: startedAtUnix,
      startSummary,
    };
  }

  /**
   * Terminate a tracked subscription. Returns the end provenance
   * summary built from the tracked counters.
   */
  async stop(subscriptionId, { terminationReason = "", errorClass = "" } = {}) {
    return this.#stop(subscriptionId, { terminationReason, errorClass, notifyEnded: false });
  }

  onSubscriptionEnded(handler) {
    this.#onSubscriptionEnded = typeof handler === "function" ? handler : null;
  }

  configurePresenceContext({ presenceState = null, getPresenceEpisodeContext = null } = {}) {
    if (presenceState) {
      this.#presenceState = presenceState;
    }
    if (typeof getPresenceEpisodeContext === "function") {
      this.#getPresenceEpisodeContext = getPresenceEpisodeContext;
    }
  }

  async #stop(
    subscriptionId,
    { terminationReason = "", errorClass = "", notifyEnded = false } = {},
  ) {
    const record = this.#active.get(subscriptionId);
    if (!record) {
      const err = new Error(
        `SensoriumSubscriber has no subscription with id ${subscriptionId}`,
      );
      err.code = "subscription_not_found";
      throw err;
    }

    await this.#manager.send("sensorium.subscribe.stop", {
      subscription_id: subscriptionId,
    });
    this.#clearTimeoutForRecord(record);

    const endedAtISO = this.#now().toISOString();
    const effectiveErrorClass = errorClass || record._stats.helperErrorClass;
    const effectiveTerminationReason =
      terminationReason || (effectiveErrorClass ? "error" : "clean_stop");
    const endSummary = createSensoriumSubscriptionEndSummary({
      startSummary: record._startSummary,
      startedAt: record.started_at_iso,
      endedAt: endedAtISO,
      terminationReason: effectiveTerminationReason,
      framesConsumed: record._stats.framesConsumed,
      schemaVersionObserved: record._stats.schemaVersionObserved,
      schemaMismatches: record._stats.schemaMismatches,
      firstFrameNumber: record._stats.firstFrameNumber,
      lastFrameNumber: record._stats.lastFrameNumber,
      statusSummaryObserved: record._stats.statusSummaryObserved,
      streamSummaryObserved: record._stats.streamSummaryObserved,
      errorClass: effectiveErrorClass,
    });

    this.#active.delete(subscriptionId);
    this.#dropRawLatestFrame(record);
    if (record.capability === PRESENCE_CAPABILITY) {
      this.#presenceState?.clear?.();
    }
    if (notifyEnded) {
      this.#notifySubscriptionEnded(subscriptionId, endSummary);
    }

    return { endSummary };
  }

  async stopByGrantId(grantId, { terminationReason = "revoked", errorClass = "" } = {}) {
    const ids = Array.from(this.#active.values())
      .filter((record) => record.grant_id === grantId)
      .map((record) => record.subscription_id);
    const stopped = [];

    for (const subscriptionId of ids) {
      const result = await this.stop(subscriptionId, {
        terminationReason,
        errorClass,
      });
      stopped.push({
        subscription_id: subscriptionId,
        endSummary: result.endSummary,
      });
    }

    return {
      stopped,
      stopped_count: stopped.length,
    };
  }

  async stopAll({ terminationReason = "runtime_shutdown", errorClass = "" } = {}) {
    const ids = Array.from(this.#active.keys());
    const stopped = [];
    const failed = [];

    for (const subscriptionId of ids) {
      try {
        const result = await this.stop(subscriptionId, {
          terminationReason,
          errorClass,
        });
        stopped.push({
          subscription_id: subscriptionId,
          endSummary: result.endSummary,
        });
      } catch (error) {
        failed.push({
          subscription_id: subscriptionId,
          error_class: sanitizeHelperErrorClass(error.code_name || error.code || error.message),
        });
      }
    }

    return {
      stopped,
      stopped_count: stopped.length,
      failed,
      failed_count: failed.length,
    };
  }

  async helperStatusAnchor() {
    const helperStatus = await this.#manager.send("sensorium.subscribe.status");
    return createSensoriumStreamAnchor({
      helperStatus,
      nodeSubscriptions: this.#nodeSubscriptionSnapshot(),
    });
  }

  /**
   * Render the disclosure shape for active subscriptions, suitable
   * for the operator/participant-facing surface.
   */
  describeActive({ now } = {}) {
    const evaluatedAt = now ?? this.#now();
    const subscriptions = Array.from(this.#active.values()).map((record) => {
      this.#refreshStallState(record, evaluatedAt);
      return {
        subscription_id: record.subscription_id,
        capability: record.capability,
        provider: record.provider,
        grant_id: record.grant_id,
        scope: record.scope,
        topic: record.topic,
        started_at: record.started_at_iso,
        expires_at: record.expires_at_iso,
        constraints_declared: record.constraints_declared,
        recent_frame_rate: estimateFrameRate(record, evaluatedAt),
        frames_consumed_so_far: record._stats.framesConsumed,
        status_summary_observed: record._stats.statusSummaryObserved,
        stream_summary_observed: record._stats.streamSummaryObserved,
        pose_summary_observed: record._stats.poseSummaryObserved,
        helper_error_class: record._stats.helperErrorClass,
      };
    });
    return describeActiveSensoriumSubscriptions(subscriptions, { now: evaluatedAt });
  }

  readLatestRawFrame({ subscriptionId = "", modality = "", now } = {}) {
    const key = rawFrameCacheKey(subscriptionId, modality);
    const entry = this.#rawLatestFrames.get(key);
    if (!entry) {
      return null;
    }
    const evaluatedAt = resolveDate(now ?? this.#now);
    if (Date.parse(entry.expires_at) <= evaluatedAt.getTime()) {
      this.#rawLatestFrames.delete(key);
      return null;
    }
    return {
      ...entry,
      payload_bytes: copyPayloadBytes(entry.payload_bytes),
    };
  }

  dropRawFrames({ subscriptionId = "", modality = "" } = {}) {
    if (subscriptionId || modality) {
      for (const [key, entry] of this.#rawLatestFrames.entries()) {
        if (subscriptionId && entry.subscription_id !== subscriptionId) {
          continue;
        }
        if (modality && entry.modality !== modality) {
          continue;
        }
        this.#rawLatestFrames.delete(key);
      }
      return;
    }
    this.#rawLatestFrames.clear();
  }

  /**
   * Number of active subscriptions. Useful for tests and disclosure
   * counters.
   */
  get activeCount() {
    return this.#active.size;
  }

  // ── internals ──────────────────────────────────────────────────────────

  #installNotificationHandlerIfNeeded() {
    if (this.#notificationHandlerInstalled) {
      return;
    }
    if (typeof this.#manager.on !== "function") {
      return;
    }
    this.#manager.on("notification", (msg) => this.#onNotification(msg));
    this.#notificationHandlerInstalled = true;
  }

  #onNotification(msg) {
    if (!msg) {
      return;
    }
    if (msg.method === SENSORIUM_ERROR_NOTIFICATION) {
      this.#recordHelperError(msg);
      return;
    }
    if (msg.method !== SENSORIUM_SAMPLE_NOTIFICATION) {
      return;
    }
    const sub = this.#active.get(msg.params?.subscription_id);
    if (!sub) {
      return;
    }
    sub._stats.lastNotificationAt = this.#now().toISOString();
    if (sub._stats.helperErrorClass === "notification_stalled") {
      sub._stats.helperErrorClass = "";
    }
    sub._stats.framesConsumed += 1;
    if (sub.capability === "perception.sensorium.color.subscribe") {
      this.#recordColorSample(sub, msg.params);
      return;
    }
    if (sub.capability === "perception.sensorium.depth.subscribe") {
      this.#recordDepthSample(sub, msg.params);
      return;
    }
    if (sub.capability === PRESENCE_CAPABILITY) {
      this.#recordPresenceSample(sub, msg.params?.payload_bytes);
      return;
    }
    if (sub.capability === POSE_CAPABILITY) {
      this.#recordPoseSample(sub, msg.params);
      return;
    }
    if (sub.capability !== "perception.sensorium.status.subscribe") {
      return;
    }
    this.#recordStatusSample(sub, msg.params?.payload_bytes);
  }

  #recordHelperError(msg) {
    const sub = this.#active.get(msg.params?.subscription_id);
    if (!sub) {
      return;
    }
    sub._stats.lastNotificationAt = this.#now().toISOString();
    sub._stats.helperErrorClass = sanitizeHelperErrorClass(msg.params?.error_class);
  }

  #refreshStallState(record, now) {
    const evaluatedAt = resolveDate(now ?? this.#now);
    if (record._stats.helperErrorClass && record._stats.helperErrorClass !== "notification_stalled") {
      return record;
    }
    const lastNotificationMs = Date.parse(record._stats.lastNotificationAt);
    const baselineMs = Number.isFinite(lastNotificationMs)
      ? lastNotificationMs
      : record.started_at * 1000;
    const maxSilenceMs = Number.isFinite(lastNotificationMs)
      ? maxSampleSilenceMs(record)
      : STALL_STARTUP_GRACE_MS;
    if (Number.isFinite(baselineMs) && evaluatedAt.getTime() - baselineMs > maxSilenceMs) {
      record._stats.helperErrorClass = "notification_stalled";
    }
    return record;
  }

  #scheduleTimeout(record, maxSeconds) {
    if (!Number.isInteger(maxSeconds) || maxSeconds <= 0) {
      return;
    }
    record._timeoutHandle = this.#setTimeout(() => {
      void this.#handleTimeout(record.subscription_id);
    }, maxSeconds * 1000);
    if (typeof record._timeoutHandle?.unref === "function") {
      record._timeoutHandle.unref();
    }
  }

  async #handleTimeout(subscriptionId) {
    if (!this.#active.has(subscriptionId)) {
      return;
    }
    try {
      await this.#stop(subscriptionId, {
        terminationReason: "timeout",
        notifyEnded: true,
      });
    } catch {
      const record = this.#active.get(subscriptionId);
      if (record) {
        record._stats.helperErrorClass = "timeout_stop_failed";
      }
    }
  }

  #clearTimeoutForRecord(record) {
    if (record?._timeoutHandle) {
      this.#clearTimeout(record._timeoutHandle);
      record._timeoutHandle = null;
    }
  }

  #notifySubscriptionEnded(subscriptionId, endSummary) {
    if (!this.#onSubscriptionEnded) {
      return;
    }
    this.#onSubscriptionEnded({
      subscription_id: subscriptionId,
      endSummary,
    });
  }

  #nodeSubscriptionSnapshot() {
    return Array.from(this.#active.values()).map((record) => ({
      subscription_id: record.subscription_id,
      topic: record.topic,
      started_at: record.started_at,
      active: true,
    }));
  }

  #recordStatusSample(sub, payloadBytes) {
    try {
      const summary = summarizeSensoriumStatusPayload(payloadBytes);
      sub._stats.schemaVersionObserved = summary.schema_version;
      if (!summary.schema_matches_expected) {
        sub._stats.schemaMismatches += 1;
        return;
      }
      sub._stats.statusSummaryObserved = {
        schema_version: summary.schema_version,
        hostname: summary.hostname,
        uptime_seconds: summary.uptime_seconds,
        node_version: summary.node_version,
        enabled_streams: summary.enabled_streams,
        stream_profiles: summary.stream_profiles,
      };
    } catch {
      sub._stats.schemaMismatches += 1;
    }
  }

  #recordColorSample(sub, params = {}) {
    try {
      const payloadBytes = params?.payload_bytes;
      const summary = summarizeSensoriumColorPayload(payloadBytes);
      sub._stats.schemaVersionObserved = summary.schema_version;
      if (!summary.schema_matches_expected) {
        sub._stats.schemaMismatches += 1;
        this.#dropRawLatestFrame(sub);
        return;
      }
      if (sub._stats.firstFrameNumber === null) {
        sub._stats.firstFrameNumber = summary.frame_number;
      }
      sub._stats.lastFrameNumber = summary.frame_number;
      sub._stats.streamSummaryObserved = {
        schema_version: summary.schema_version,
        frameset_sequence: summary.frameset_sequence,
        frame_number: summary.frame_number,
        width: summary.width,
        height: summary.height,
        format: summary.format,
        payload_size: summary.payload_size,
      };
      this.#storeRawLatestFrame(sub, payloadBytes, {
        frameId: summary.frame_number,
        framesetSequence: summary.frameset_sequence,
        captureTimestamp: params?.capture_timestamp,
        byteLength: params?.payload_size,
      });
    } catch {
      sub._stats.schemaMismatches += 1;
      this.#dropRawLatestFrame(sub);
    }
  }

  #recordDepthSample(sub, params = {}) {
    try {
      const payloadBytes = params?.payload_bytes;
      const summary = summarizeSensoriumDepthPayload(payloadBytes);
      sub._stats.schemaVersionObserved = summary.schema_version;
      if (!summary.schema_matches_expected) {
        sub._stats.schemaMismatches += 1;
        this.#dropRawLatestFrame(sub);
        return;
      }
      if (sub._stats.firstFrameNumber === null) {
        sub._stats.firstFrameNumber = summary.frame_number;
      }
      sub._stats.lastFrameNumber = summary.frame_number;
      sub._stats.streamSummaryObserved = {
        schema_version: summary.schema_version,
        frameset_sequence: summary.frameset_sequence,
        frame_number: summary.frame_number,
        width: summary.width,
        height: summary.height,
        format: summary.format,
        depth_units: summary.depth_units,
        payload_size: summary.payload_size,
      };
      this.#storeRawLatestFrame(sub, payloadBytes, {
        frameId: summary.frame_number,
        framesetSequence: summary.frameset_sequence,
        captureTimestamp: params?.capture_timestamp,
        byteLength: params?.payload_size,
      });
    } catch {
      sub._stats.schemaMismatches += 1;
      this.#dropRawLatestFrame(sub);
    }
  }

  #recordPresenceSample(sub, payloadBytes) {
    try {
      const summary = summarizeSensoriumPresencePayload(payloadBytes);
      sub._stats.schemaVersionObserved = summary.schema_matches_expected ? 1 : null;
      if (!summary.schema_matches_expected) {
        sub._stats.schemaMismatches += 1;
        sub._stats.streamSummaryObserved = null;
        this.#presenceState?.clear?.();
        return;
      }
      const brokerEvent = {
        schema_version: 1,
        event_type: "presence.depth",
        person_count: summary.person_count,
        count_bucket: summary.count_bucket,
        additional_person_present: summary.additional_person_present,
        confidence_bucket: summary.confidence_bucket,
        identity: "not_performed",
        copresence_source: "depth",
        raw_payload_allowed_to_node: false,
        raw_payload_included: false,
      };
      validateBrokerDepthPresenceEvent(brokerEvent);
      const semanticEvent = createDepthPresenceSemanticEvent({
        brokerEvent,
        episode: this.#getPresenceEpisodeContext(),
        sourceGrant: {
          id: sub.grant_id,
          provider: sub.provider,
        },
        sourceCapability: sub.capability,
        now: this.#now,
      });
      this.#presenceState?.updateFromSemanticEvent?.({
        ...semanticEvent,
        source_host: hostFromTopic(sub.topic),
      });
      sub._stats.streamSummaryObserved = {
        schema_version: semanticEvent.schema_version,
        sensorium_schema: summary.schema,
        event_type: semanticEvent.event_type,
        frameset_sequence: summary.frameset_sequence,
        present: summary.present,
        person_count: semanticEvent.payload.person_count,
        count_bucket: semanticEvent.payload.count_bucket,
        confidence_bucket: semanticEvent.confidence_bucket,
        additional_person_present: semanticEvent.audience_context.additional_person_present,
        source: summary.source,
        expires_at: semanticEvent.expires_at,
      };
    } catch {
      sub._stats.schemaMismatches += 1;
      sub._stats.helperErrorClass = "presence_event_rejected";
      sub._stats.streamSummaryObserved = null;
      this.#presenceState?.clear?.();
    }
  }

  #recordPoseSample(sub, params = {}) {
    try {
      const payloadBytes = params?.payload_bytes;
      const summary = summarizeSensoriumPosePayload(payloadBytes);
      sub._stats.schemaVersionObserved = summary.schema_matches_expected ? 1 : null;
      if (!summary.schema_matches_expected) {
        sub._stats.schemaMismatches += 1;
        sub._stats.poseSummaryObserved = null;
        this.#dropRawLatestFrame(sub);
        return;
      }
      sub._stats.firstFrameNumber = sub._stats.firstFrameNumber ?? summary.frameset_sequence;
      sub._stats.lastFrameNumber = summary.frameset_sequence;
      sub._stats.poseSummaryObserved = summary;
      this.#storeRawLatestFrame(sub, payloadBytes, {
        frameId: summary.frameset_sequence,
        captureTimestamp: summary.capture_timestamp,
        byteLength: params?.payload_size,
      });
    } catch {
      sub._stats.schemaMismatches += 1;
      sub._stats.helperErrorClass = "pose_payload_rejected";
      sub._stats.poseSummaryObserved = null;
      this.#dropRawLatestFrame(sub);
    }
  }

  #storeRawLatestFrame(sub, payloadBytes, { frameId, framesetSequence, captureTimestamp, byteLength } = {}) {
    const retention = sub._rawFrameRetention;
    if (!retention.enabled) {
      return;
    }
    const payload = copyPayloadBytes(payloadBytes);
    const declaredByteLength = Number.isInteger(byteLength) && byteLength >= 0
      ? byteLength
      : null;
    if ((declaredByteLength !== null && declaredByteLength > retention.max_bytes) || payload.byteLength > retention.max_bytes) {
      this.#dropRawLatestFrame(sub);
      return;
    }
    const storedAt = this.#now();
    const expiresAt = new Date(storedAt.getTime() + retention.ttl_ms);
    const modality = retention.modality;
    this.#rawLatestFrames.set(rawFrameCacheKey(sub.subscription_id, modality), Object.freeze({
      subscription_id: sub.subscription_id,
      source_grant_id: sub.grant_id,
      modality,
      source_host: hostFromTopic(sub.topic),
      topic: sub.topic,
      frame_id: String(frameId ?? ""),
      frameset_sequence: Number.isInteger(framesetSequence) && framesetSequence >= 0 ? framesetSequence : null,
      capture_timestamp: normalizeCaptureTimestamp(captureTimestamp, storedAt),
      byte_length: payload.byteLength,
      declared_byte_length: declaredByteLength,
      stored_at: storedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      payload_bytes: payload,
      payload_bytes_included: true,
      disk_persisted: false,
      provenance_appended: false,
      retention_mode: "latest_frame_cache",
    }));
  }

  #dropRawLatestFrame(sub) {
    const modality = sub?._rawFrameRetention?.modality || RAW_FRAME_MODALITY_BY_CAPABILITY[sub?.capability];
    if (!sub?.subscription_id || !modality) {
      return;
    }
    this.#rawLatestFrames.delete(rawFrameCacheKey(sub.subscription_id, modality));
  }
}

function computeExpiresAtISO({ startedAtUnix, maxSeconds }) {
  if (
    typeof startedAtUnix !== "number" ||
    !Number.isFinite(startedAtUnix) ||
    typeof maxSeconds !== "number" ||
    !Number.isInteger(maxSeconds) ||
    maxSeconds <= 0
  ) {
    return "";
  }
  return new Date((startedAtUnix + maxSeconds) * 1000).toISOString();
}

function estimateFrameRate(record, now) {
  const startedMs = record.started_at * 1000;
  const elapsedSec = (now.getTime() - startedMs) / 1000;
  if (elapsedSec <= 0) {
    return 0;
  }
  return record._stats.framesConsumed / elapsedSec;
}

function maxSampleSilenceMs(record) {
  const fps = record?.constraints_declared?.max_fps;
  if (!Number.isInteger(fps) || fps <= 0) {
    return STALL_MIN_SAMPLE_GAP_MS;
  }
  return Math.max(STALL_MIN_SAMPLE_GAP_MS, Math.ceil((1000 / fps) * STALL_SAMPLE_PERIOD_MULTIPLIER));
}

function stripEmpty(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== "" && value !== undefined),
  );
}

function cameraClassOnly(capability, value) {
  return capability === "perception.sensorium.color.subscribe" ||
    capability === "perception.sensorium.depth.subscribe"
    ? value
    : undefined;
}

function sanitizeHelperErrorClass(value) {
  if (typeof value !== "string") {
    return "helper_stream_error";
  }
  const normalized = value.trim();
  if (/^[a-z0-9_:-]{1,96}$/.test(normalized)) {
    return normalized;
  }
  return "helper_stream_error";
}

function normalizeRawFrameRetention(rawFrameRetention, { capability, grantId, topic, now } = {}) {
  const modality = RAW_FRAME_MODALITY_BY_CAPABILITY[capability] ?? "";
  const disabled = Object.freeze({ enabled: false, modality });
  if (!modality || !rawFrameRetention || typeof rawFrameRetention !== "object") {
    return disabled;
  }
  if (rawFrameRetention.enabled !== true) {
    return disabled;
  }
  if (rawFrameRetention.grant_allows_raw_visual_retention !== true) {
    return disabled;
  }
  if (rawFrameRetention.retention_mode !== "latest_frame_cache") {
    return disabled;
  }
  if (rawFrameRetention.modality !== modality) {
    return disabled;
  }
  if (rawFrameRetention.source_grant_id && rawFrameRetention.source_grant_id !== grantId) {
    return disabled;
  }
  const sourceHost = String(rawFrameRetention.source_host ?? "").trim();
  if (sourceHost && sourceHost !== hostFromTopic(topic)) {
    return disabled;
  }
  const maxBytes = rawFrameRetention.max_bytes;
  const ttlMs = rawFrameRetention.ttl_ms;
  if (!Number.isInteger(maxBytes) || maxBytes <= 0 || maxBytes > 50_000_000) {
    return disabled;
  }
  if (!Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > 60_000) {
    return disabled;
  }
  return Object.freeze({
    enabled: true,
    modality,
    max_bytes: maxBytes,
    ttl_ms: ttlMs,
    configured_at: resolveDate(now).toISOString(),
  });
}

function rawFrameCacheKey(subscriptionId, modality) {
  return `${String(subscriptionId ?? "")}\u0000${String(modality ?? "")}`;
}

function copyPayloadBytes(value) {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }
  return new Uint8Array();
}

function hostFromTopic(topic) {
  if (typeof topic !== "string") {
    return "";
  }
  const match = topic.match(/^(?:sensor|perception)\/([a-z0-9-]+)\//);
  return match ? match[1] : "";
}

function normalizeCaptureTimestamp(value, fallbackDate) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return fallbackDate.toISOString();
}

function resolveDate(value) {
  const candidate = typeof value === "function" ? value() : value;
  if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
    return candidate;
  }
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

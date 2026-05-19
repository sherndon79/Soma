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
import { summarizeSensoriumStatusPayload } from "./sensoriumStatusPayload.js";
import { describeActiveSensoriumSubscriptions } from "./sensoriumSubscriptionDisclosure.js";
import { validateSensoriumSubscriptionRequest } from "./sensoriumSubscriptionRequest.js";

const SENSORIUM_SAMPLE_NOTIFICATION = "sensorium.subscription.sample";
const SENSORIUM_ERROR_NOTIFICATION = "sensorium.subscription.error";

export class SensoriumSubscriber {
  #manager;
  #active = new Map();
  #notificationHandlerInstalled = false;
  #now;
  #zenohConfigPath;
  #setTimeout;
  #clearTimeout;
  #onSubscriptionEnded;

  constructor({
    manager,
    now = () => new Date(),
    zenohConfigPath = "",
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    onSubscriptionEnded = null,
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
  }

  /**
   * Activate a Sensorium subscription. Composes the validator, the
   * helper invocation, and the start provenance summary.
   *
   * Throws synchronously on validation failure (the request body is
   * malformed) and asynchronously on helper failure (the helper
   * rejected the request — bad config, Zenoh open error, etc.).
   */
  async start({ capability, provider, grantId, scope, body } = {}) {
    const validated = validateSensoriumSubscriptionRequest(body, { capability });

    this.#installNotificationHandlerIfNeeded();

    const helperResult = await this.#manager.send(
      "sensorium.subscribe.start",
      stripEmpty({
        topic: validated.topic,
        zenoh_config_path: this.#zenohConfigPath,
        max_fps: validated.constraints?.max_fps,
        downsample_to: colorOnly(capability, validated.constraints?.downsample_to),
        format_required: colorOnly(capability, validated.constraints?.format_required),
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
        helperErrorClass: "",
      },
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

  /**
   * Render the disclosure shape for active subscriptions, suitable
   * for the operator/participant-facing surface.
   */
  describeActive({ now } = {}) {
    const subscriptions = Array.from(this.#active.values()).map((record) => ({
      capability: record.capability,
      provider: record.provider,
      grant_id: record.grant_id,
      scope: record.scope,
      topic: record.topic,
      started_at: record.started_at_iso,
      expires_at: record.expires_at_iso,
      constraints_declared: record.constraints_declared,
      recent_frame_rate: estimateFrameRate(record, this.#now()),
      frames_consumed_so_far: record._stats.framesConsumed,
      status_summary_observed: record._stats.statusSummaryObserved,
      stream_summary_observed: record._stats.streamSummaryObserved,
      helper_error_class: record._stats.helperErrorClass,
    }));
    return describeActiveSensoriumSubscriptions(subscriptions, { now: now ?? this.#now() });
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
    sub._stats.framesConsumed += 1;
    if (sub.capability === "perception.sensorium.color.subscribe") {
      this.#recordColorSample(sub, msg.params?.payload_bytes);
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
    sub._stats.helperErrorClass = sanitizeHelperErrorClass(msg.params?.error_class);
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

  #recordColorSample(sub, payloadBytes) {
    try {
      const summary = summarizeSensoriumColorPayload(payloadBytes);
      sub._stats.schemaVersionObserved = summary.schema_version;
      if (!summary.schema_matches_expected) {
        sub._stats.schemaMismatches += 1;
        return;
      }
      if (sub._stats.firstFrameNumber === null) {
        sub._stats.firstFrameNumber = summary.frame_number;
      }
      sub._stats.lastFrameNumber = summary.frame_number;
      sub._stats.streamSummaryObserved = {
        schema_version: summary.schema_version,
        frame_number: summary.frame_number,
        width: summary.width,
        height: summary.height,
        format: summary.format,
        payload_size: summary.payload_size,
      };
    } catch {
      sub._stats.schemaMismatches += 1;
    }
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

function stripEmpty(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== ""),
  );
}

function colorOnly(capability, value) {
  return capability === "perception.sensorium.color.subscribe" ? value : undefined;
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

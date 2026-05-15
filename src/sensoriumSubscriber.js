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
import { describeActiveSensoriumSubscriptions } from "./sensoriumSubscriptionDisclosure.js";
import { validateSensoriumSubscriptionRequest } from "./sensoriumSubscriptionRequest.js";

const SENSORIUM_SAMPLE_NOTIFICATION = "sensorium.subscription.sample";

export class SensoriumSubscriber {
  #manager;
  #active = new Map();
  #notificationHandlerInstalled = false;
  #now;

  constructor({ manager, now = () => new Date() } = {}) {
    if (!manager) {
      throw new TypeError("SensoriumSubscriber requires a manager");
    }
    this.#manager = manager;
    this.#now = now;
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
      { topic: validated.topic },
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
      _startSummary: startSummary,
      _stats: {
        framesConsumed: 0,
        schemaVersionObserved: null,
        schemaMismatches: 0,
        firstFrameNumber: null,
        lastFrameNumber: null,
      },
    };
    this.#active.set(subscriptionId, record);

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
  async stop(subscriptionId, { terminationReason = "clean_stop", errorClass = "" } = {}) {
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

    const endedAtISO = this.#now().toISOString();
    const endSummary = createSensoriumSubscriptionEndSummary({
      startSummary: record._startSummary,
      startedAt: record.started_at_iso,
      endedAt: endedAtISO,
      terminationReason,
      framesConsumed: record._stats.framesConsumed,
      schemaVersionObserved: record._stats.schemaVersionObserved,
      schemaMismatches: record._stats.schemaMismatches,
      firstFrameNumber: record._stats.firstFrameNumber,
      lastFrameNumber: record._stats.lastFrameNumber,
      errorClass,
    });

    this.#active.delete(subscriptionId);

    return { endSummary };
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
    if (!msg || msg.method !== SENSORIUM_SAMPLE_NOTIFICATION) {
      return;
    }
    const sub = this.#active.get(msg.params?.subscription_id);
    if (!sub) {
      return;
    }
    sub._stats.framesConsumed += 1;
    // payload_size is the helper's view; we leave deeper introspection
    // (decoding msgpack to extract schema_version + frame_number) to
    // a future hardening slice. For now the counters that matter for
    // provenance are framesConsumed and time bounds.
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

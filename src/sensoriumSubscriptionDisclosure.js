// Active-subscription disclosure shape for Sensorium consumers.
//
// Step 6 of the disabled-first sequence: define what an active
// subscription should LOOK like in Soma's disclosure surfaces, before
// anything can actually activate. Pure-function shape — takes a list
// of active-subscription records (whatever data structure the future
// helper exposes) and produces the family-grouped, per-stream view
// the operator and the participant should see.
//
// Design constraints, from
// docs/concepts/drafts/sensorium_integration.md "Disclosure":
//
//   - Group at family level so the operator sees the digest first
//     ("perception via Sensorium: 3 streams active") and can expand
//     per-stream for detail.
//   - Per-stream detail includes host, scope, expiry, declared
//     constraints, recent throughput — enough for the participant to
//     notice if something is consuming more than expected.
//   - No frame content. Provenance principle applies here too: the
//     disclosure describes the shape of consumption, not the consumed
//     content.

const FAMILY = "perception.sensorium";

const CAPABILITY_LABELS = {
  "perception.sensorium.color.subscribe":    "color frames",
  "perception.sensorium.depth.subscribe":    "depth maps",
  "perception.sensorium.imu.subscribe":      "accel + gyro samples",
  "perception.sensorium.location.subscribe": "static location",
  "perception.sensorium.status.subscribe":   "heartbeat",
};

const SENSORIUM_CAPABILITY_KEYS = new Set(Object.keys(CAPABILITY_LABELS));

export function describeActiveSensoriumSubscriptions(subscriptions, options = {}) {
  if (!Array.isArray(subscriptions)) {
    throw new TypeError("subscriptions must be an array");
  }

  const now = resolveNow(options.now);

  const streams = subscriptions
    .filter((s) => SENSORIUM_CAPABILITY_KEYS.has(s?.capability))
    .map((s) => describeStream(s, now));

  return {
    family: FAMILY,
    active_count: streams.length,
    summary: summaryLine(streams.length),
    streams,
    frames_recorded: false,
  };
}

function describeStream(subscription, now) {
  const host = hostFromTopic(subscription.topic);
  const label = CAPABILITY_LABELS[subscription.capability] ?? "unknown stream";
  const recentFps = numberOrNull(subscription.recent_frame_rate);
  const description = describeStreamLine({
    capability: subscription.capability,
    host,
    label,
    recentFps,
  });

  return {
    capability: subscription.capability,
    host,
    scope: stringOrEmpty(subscription.scope),
    started_at: stringOrEmpty(subscription.started_at),
    expires_at: stringOrEmpty(subscription.expires_at),
    expires_in_seconds: expiresInSeconds(subscription.expires_at, now),
    constraints_declared: copyConstraints(subscription.constraints_declared),
    recent_frame_rate: recentFps,
    frames_consumed_so_far: nonNegativeIntOrZero(subscription.frames_consumed_so_far),
    status_summary_observed: copyStatusSummary(subscription.status_summary_observed),
    description,
  };
}

function describeStreamLine({ capability, host, label, recentFps }) {
  const hostPhrase = host ? ` from ${host}` : "";
  // Only color and depth get an fps phrase — IMU is downsampled to the
  // video rate (see Sensorium ROADMAP 5f), location and status are
  // heartbeat-cadenced, so rate isn't a useful surface for those.
  const showsFps =
    capability === "perception.sensorium.color.subscribe" ||
    capability === "perception.sensorium.depth.subscribe";
  const ratePhrase = showsFps && recentFps !== null
    ? ` at ~${formatRate(recentFps)} fps`
    : "";
  return `Receiving ${label}${hostPhrase}${ratePhrase}`;
}

function summaryLine(count) {
  if (count === 0) {
    return "No Sensorium subscriptions active";
  }
  if (count === 1) {
    return "perception via Sensorium: 1 stream active";
  }
  return `perception via Sensorium: ${count} streams active`;
}

// ── helpers ────────────────────────────────────────────────────────────────

function hostFromTopic(topic) {
  if (typeof topic !== "string") {
    return "";
  }
  // Expected shape: sensor/<host>/<tail>...
  const match = topic.match(/^sensor\/([a-z0-9-]+)\//);
  return match ? match[1] : "";
}

function expiresInSeconds(expiresAtISO, now) {
  if (typeof expiresAtISO !== "string" || expiresAtISO.length === 0) {
    return null;
  }
  const expiresAt = Date.parse(expiresAtISO);
  if (!Number.isFinite(expiresAt)) {
    return null;
  }
  const seconds = Math.round((expiresAt - now.getTime()) / 1000);
  return Math.max(seconds, 0);
}

function resolveNow(value) {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "function") {
    const result = value();
    if (result instanceof Date) {
      return result;
    }
  }
  return new Date();
}

function copyConstraints(constraints) {
  if (!isPlainObject(constraints)) {
    return {};
  }
  const out = {};
  for (const [key, value] of Object.entries(constraints)) {
    if (value !== undefined && value !== null) {
      out[key] = value;
    }
  }
  return out;
}

function copyStatusSummary(summary) {
  if (!isPlainObject(summary)) {
    return null;
  }
  const schemaVersion = numberOrNull(summary.schema_version);
  const uptimeSeconds = numberOrNull(summary.uptime_seconds);
  const hostname = stringOrEmpty(summary.hostname);
  const nodeVersion = stringOrEmpty(summary.node_version);
  const enabledStreams = Array.isArray(summary.enabled_streams)
    ? summary.enabled_streams.filter((item) => typeof item === "string")
    : [];
  if (
    schemaVersion === null ||
    uptimeSeconds === null ||
    hostname.length === 0 ||
    nodeVersion.length === 0
  ) {
    return null;
  }
  return {
    schema_version: schemaVersion,
    hostname,
    uptime_seconds: uptimeSeconds,
    node_version: nodeVersion,
    enabled_streams: enabledStreams,
  };
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function nonNegativeIntOrZero(value) {
  if (Number.isInteger(value) && value >= 0) {
    return value;
  }
  return 0;
}

function stringOrEmpty(value) {
  return typeof value === "string" ? value : "";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatRate(value) {
  // Round to 1 decimal for human-readability. The participant doesn't
  // need to see ~4.8362874 fps; "4.8" suffices to notice oddities.
  return (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, "");
}

export const SENSORIUM_DISCLOSURE_FAMILY = FAMILY;

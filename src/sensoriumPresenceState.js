import { localAudienceContext } from "./sensoriumTier.js";

export function createSensoriumPresenceState({ now = () => new Date() } = {}) {
  let current = null;

  return Object.freeze({
    updateFromSemanticEvent(event = {}) {
      const expiresAt = parseDate(event.expires_at);
      if (!expiresAt || !event.audience_context) {
        clear();
        return read();
      }
      current = Object.freeze({
        audience_context: localAudienceContext(event.audience_context),
        count_bucket: normalizeCountBucket(event.payload?.count_bucket),
        confidence_bucket: normalizeConfidenceBucket(event.confidence_bucket),
        observed_at: parseDate(event.observed_at)?.toISOString() ?? "",
        expires_at: expiresAt.toISOString(),
        event_id: typeof event.event_id === "string" ? event.event_id : "",
      });
      return current.audience_context;
    },
    read({ now: readNow } = {}) {
      return read(readNow);
    },
    snapshot({ now: readNow } = {}) {
      return snapshot(readNow);
    },
    clear,
  });

  function read(readNow = now) {
    if (!current) {
      return localAudienceContext();
    }
    const observedNow = asDate(readNow);
    const expiresAt = parseDate(current.expires_at);
    if (!expiresAt || expiresAt.getTime() <= observedNow.getTime()) {
      clear();
      return localAudienceContext();
    }
    return localAudienceContext(current.audience_context);
  }

  function snapshot(readNow = now) {
    if (!current) {
      return unavailableSnapshot("not_armed_or_cleared");
    }
    const observedNow = asDate(readNow);
    const expiresAt = parseDate(current.expires_at);
    if (!expiresAt || expiresAt.getTime() <= observedNow.getTime()) {
      clear();
      return unavailableSnapshot("stale");
    }
    return Object.freeze({
      status: "available",
      unavailable_reason: "",
      count_bucket: normalizeCountBucket(current.count_bucket),
      additional_person_present: current.audience_context.additional_person_present,
      confidence_bucket: normalizeConfidenceBucket(current.confidence_bucket),
      observed_at: current.observed_at,
      expires_at: current.expires_at,
    });
  }

  function clear() {
    current = null;
  }
}

function unavailableSnapshot(reason) {
  return Object.freeze({
    status: "unavailable",
    unavailable_reason: reason,
    count_bucket: "unknown",
    additional_person_present: "unknown",
    confidence_bucket: "unknown",
    observed_at: "",
    expires_at: "",
  });
}

function normalizeCountBucket(value) {
  return ["0", "1", "2_plus", "unknown"].includes(value) ? value : "unknown";
}

function normalizeConfidenceBucket(value) {
  return ["low", "medium", "high"].includes(value) ? value : "unknown";
}

function parseDate(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asDate(value) {
  const candidate = typeof value === "function" ? value() : value;
  if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
    return candidate;
  }
  return new Date();
}

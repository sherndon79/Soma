import { localAudienceContext } from "./sensoriumTier.js";

export function createSensoriumPresenceState({ now = () => new Date() } = {}) {
  let current = null;
  const timeline = [];
  const maxTimelineSamples = 128;

  return Object.freeze({
    updateFromSemanticEvent(event = {}) {
      const expiresAt = parseDate(event.expires_at);
      if (!expiresAt || !event.audience_context) {
        clear();
        return read();
      }
      current = Object.freeze({
        audience_context: localAudienceContext(event.audience_context),
        source_host: stringValue(event.source_host || event.source?.source_host || event.source?.host),
        frameset_sequence: normalizeFramesetSequence(event.frameset_sequence),
        person_count: normalizePersonCount(event.payload?.person_count),
        count_bucket: normalizeCountBucket(event.payload?.count_bucket),
        confidence_bucket: normalizeConfidenceBucket(event.confidence_bucket),
        observed_at: parseDate(event.observed_at)?.toISOString() ?? "",
        expires_at: expiresAt.toISOString(),
        event_id: typeof event.event_id === "string" ? event.event_id : "",
      });
      appendTimelineSample(current);
      return current.audience_context;
    },
    read({ now: readNow } = {}) {
      return read(readNow);
    },
    snapshot({ now: readNow } = {}) {
      return snapshot(readNow);
    },
    timeline({ now: readNow } = {}) {
      return timelineSnapshot(readNow);
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
      person_count: normalizePersonCount(current.person_count),
      count_bucket: normalizeCountBucket(current.count_bucket),
      additional_person_present: current.audience_context.additional_person_present,
      confidence_bucket: normalizeConfidenceBucket(current.confidence_bucket),
      source_host: stringValue(current.source_host),
      ...(normalizeFramesetSequence(current.frameset_sequence) !== null
        ? { frameset_sequence: normalizeFramesetSequence(current.frameset_sequence) }
        : {}),
      observed_at: current.observed_at,
      expires_at: current.expires_at,
    });
  }

  function clear() {
    current = null;
    timeline.length = 0;
  }

  function appendTimelineSample(sample) {
    const observedAt = parseDate(sample.observed_at);
    const expiresAt = parseDate(sample.expires_at);
    if (!observedAt || !expiresAt) {
      return;
    }
    timeline.push(Object.freeze({
      source_host: stringValue(sample.source_host),
      frameset_sequence: normalizeFramesetSequence(sample.frameset_sequence),
      person_count: normalizePersonCount(sample.person_count),
      count_bucket: normalizeCountBucket(sample.count_bucket),
      additional_person_present: sample.audience_context.additional_person_present,
      confidence_bucket: normalizeConfidenceBucket(sample.confidence_bucket),
      observed_at: observedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    }));
    while (timeline.length > maxTimelineSamples) {
      timeline.shift();
    }
  }

  function timelineSnapshot(readNow = now) {
    const observedNow = asDate(readNow);
    for (let index = timeline.length - 1; index >= 0; index -= 1) {
      const expiresAt = parseDate(timeline[index].expires_at);
      if (!expiresAt || expiresAt.getTime() <= observedNow.getTime()) {
        timeline.splice(index, 1);
      }
    }
    return Object.freeze(timeline.map((sample) => ({ ...sample })));
  }
}

function unavailableSnapshot(reason) {
  return Object.freeze({
    status: "unavailable",
    unavailable_reason: reason,
    person_count: null,
    count_bucket: "unknown",
    additional_person_present: "unknown",
    confidence_bucket: "unknown",
    source_host: "",
    observed_at: "",
    expires_at: "",
  });
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCountBucket(value) {
  return ["0", "1", "2_plus", "unknown"].includes(value) ? value : "unknown";
}

function normalizePersonCount(value) {
  return Number.isInteger(value) && value >= 0 && value <= 64 ? value : null;
}

function normalizeFramesetSequence(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
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

export const BURST_PRESENCE_REASONS = Object.freeze({
  ALLOWED: "allowed",
  FRAMES_MISSING: "burst_frames_missing",
  PRESENCE_COVERAGE_MISSING: "burst_presence_coverage_missing",
  PRESENCE_STALE: "burst_presence_stale",
  PRESENCE_NOT_SOLO: "burst_presence_not_solo",
});

const DEFAULT_GUARD_BAND_MS = 250;

export function evaluateBurstPresenceCoverage({
  frames = [],
  presenceSamples = [],
  guardBandMs = DEFAULT_GUARD_BAND_MS,
} = {}) {
  const normalizedFrames = normalizeFrames(frames);
  if (normalizedFrames.length === 0) {
    return refusal(BURST_PRESENCE_REASONS.FRAMES_MISSING, {
      coverage_method: "none",
      frame_count: 0,
    });
  }
  const normalizedPresence = normalizePresenceSamples(presenceSamples);
  if (normalizedPresence.length === 0) {
    return refusal(BURST_PRESENCE_REASONS.PRESENCE_COVERAGE_MISSING, {
      coverage_method: "none",
      frame_count: normalizedFrames.length,
      presence_sample_count: 0,
    });
  }

  if (hasCompleteSequenceCoverage(normalizedFrames, normalizedPresence)) {
    return evaluateSequenceJoin({ frames: normalizedFrames, presenceSamples: normalizedPresence });
  }
  return evaluateTimestampCoverage({
    frames: normalizedFrames,
    presenceSamples: normalizedPresence,
    guardBandMs,
  });
}

function hasCompleteSequenceCoverage(frames, presenceSamples) {
  if (!frames.every((frame) => Number.isInteger(frame.frameset_sequence))) {
    return false;
  }
  const presenceSequences = new Set(
    presenceSamples
      .map((sample) => sample.frameset_sequence)
      .filter(Number.isInteger),
  );
  if (presenceSequences.size === 0) {
    return false;
  }
  return frames.every((frame) => presenceSequences.has(frame.frameset_sequence));
}

function evaluateSequenceJoin({ frames, presenceSamples }) {
  const bySequence = new Map();
  for (const sample of presenceSamples) {
    if (Number.isInteger(sample.frameset_sequence)) {
      bySequence.set(sample.frameset_sequence, sample);
    }
  }
  const joined = [];
  for (const frame of frames) {
    const sample = bySequence.get(frame.frameset_sequence);
    if (!sample) {
      return refusal(BURST_PRESENCE_REASONS.PRESENCE_COVERAGE_MISSING, {
        coverage_method: "sequence_join",
        missing_frameset_sequence: frame.frameset_sequence,
        frame_count: frames.length,
        presence_sample_count: presenceSamples.length,
      });
    }
    joined.push({ frame, sample });
  }
  for (const { frame, sample } of joined) {
    if (frame.capture_ms !== null && sample.expires_ms <= frame.capture_ms) {
      return refusal(BURST_PRESENCE_REASONS.PRESENCE_STALE, {
        coverage_method: "sequence_join",
        stale_frameset_sequence: frame.frameset_sequence,
      });
    }
  }
  const nonSolo = joined.find(({ sample }) => !presenceSampleIsSolo(sample));
  if (nonSolo) {
    return refusal(BURST_PRESENCE_REASONS.PRESENCE_NOT_SOLO, {
      coverage_method: "sequence_join",
      non_solo_frameset_sequence: nonSolo.frame.frameset_sequence,
    });
  }
  return allowed({
    coverage_method: "sequence_join",
    frame_count: frames.length,
    presence_sample_count: joined.length,
    solo_span_verified: true,
  });
}

function evaluateTimestampCoverage({ frames, presenceSamples, guardBandMs }) {
  if (frames.some((frame) => frame.capture_ms === null)) {
    return refusal(BURST_PRESENCE_REASONS.PRESENCE_COVERAGE_MISSING, {
      coverage_method: "timestamp_interval",
      frame_count: frames.length,
      missing_capture_timestamp: true,
    });
  }
  const oldestMs = Math.min(...frames.map((frame) => frame.capture_ms));
  const newestMs = Math.max(...frames.map((frame) => frame.capture_ms));
  const guard = Number.isInteger(guardBandMs) && guardBandMs >= 0 ? guardBandMs : DEFAULT_GUARD_BAND_MS;
  const windowStart = oldestMs - guard;
  const windowEnd = newestMs + guard;
  const candidates = presenceSamples
    .filter((sample) => sample.observed_ms <= windowEnd && sample.expires_ms >= windowStart)
    .sort((left, right) => left.observed_ms - right.observed_ms);
  if (candidates.length === 0) {
    return refusal(BURST_PRESENCE_REASONS.PRESENCE_COVERAGE_MISSING, {
      coverage_method: "timestamp_interval",
      frame_count: frames.length,
      presence_sample_count: 0,
    });
  }
  if (candidates.every((sample) => sample.expires_ms <= newestMs)) {
    return refusal(BURST_PRESENCE_REASONS.PRESENCE_STALE, {
      coverage_method: "timestamp_interval",
      frame_count: frames.length,
      presence_sample_count: candidates.length,
    });
  }
  const gap = findCoverageGap({ samples: candidates, windowStart, windowEnd, maxGapMs: guard });
  if (gap) {
    return refusal(BURST_PRESENCE_REASONS.PRESENCE_COVERAGE_MISSING, {
      coverage_method: "timestamp_interval",
      frame_count: frames.length,
      presence_sample_count: candidates.length,
      coverage_gap_start: new Date(gap.start_ms).toISOString(),
      coverage_gap_end: new Date(gap.end_ms).toISOString(),
    });
  }
  const nonSolo = candidates.find((sample) => !presenceSampleIsSolo(sample));
  if (nonSolo) {
    return refusal(BURST_PRESENCE_REASONS.PRESENCE_NOT_SOLO, {
      coverage_method: "timestamp_interval",
      non_solo_observed_at: nonSolo.observed_at,
    });
  }
  return allowed({
    coverage_method: "timestamp_interval",
    frame_count: frames.length,
    presence_sample_count: candidates.length,
    oldest_capture_timestamp: new Date(oldestMs).toISOString(),
    newest_capture_timestamp: new Date(newestMs).toISOString(),
    solo_span_verified: true,
  });
}

function findCoverageGap({ samples, windowStart, windowEnd, maxGapMs }) {
  let coveredUntil = windowStart;
  for (const sample of samples) {
    if (sample.expires_ms < windowStart || sample.observed_ms > windowEnd) {
      continue;
    }
    if (sample.observed_ms > coveredUntil + maxGapMs) {
      return {
        start_ms: coveredUntil,
        end_ms: sample.observed_ms,
      };
    }
    if (sample.expires_ms > coveredUntil) {
      coveredUntil = sample.expires_ms;
    }
    if (coveredUntil >= windowEnd) {
      return null;
    }
  }
  if (coveredUntil < windowEnd) {
    return {
      start_ms: coveredUntil,
      end_ms: windowEnd,
    };
  }
  return null;
}

function normalizeFrames(frames) {
  return (Array.isArray(frames) ? frames : [])
    .map((frame) => ({
      frame_id: stringValue(frame?.frame_id),
      frameset_sequence: integerOrNull(frame?.frameset_sequence),
      capture_timestamp: isoStringOrEmpty(frame?.capture_timestamp),
      capture_ms: dateMsOrNull(frame?.capture_timestamp),
    }))
    .filter((frame) => frame.frame_id || frame.frameset_sequence !== null || frame.capture_ms !== null);
}

function normalizePresenceSamples(samples) {
  return (Array.isArray(samples) ? samples : [])
    .map((sample) => {
      const observedMs = dateMsOrNull(sample?.observed_at ?? sample?.capture_timestamp);
      const expiresMs = dateMsOrNull(sample?.expires_at);
      if (observedMs === null || expiresMs === null) {
        return null;
      }
      return {
        frameset_sequence: integerOrNull(sample?.frameset_sequence),
        observed_at: new Date(observedMs).toISOString(),
        observed_ms: observedMs,
        expires_at: new Date(expiresMs).toISOString(),
        expires_ms: expiresMs,
        person_count: Number.isInteger(sample?.person_count) ? sample.person_count : null,
        count_bucket: stringValue(sample?.count_bucket),
        additional_person_present: stringValue(sample?.additional_person_present),
        confidence_bucket: stringValue(sample?.confidence_bucket),
      };
    })
    .filter(Boolean);
}

function presenceSampleIsSolo(sample) {
  return sample.person_count === 1 &&
    sample.count_bucket === "1" &&
    sample.additional_person_present === "not_detected" &&
    ["medium", "high"].includes(sample.confidence_bucket);
}

function allowed(checks) {
  return {
    allowed: true,
    reason: BURST_PRESENCE_REASONS.ALLOWED,
    ...checks,
  };
}

function refusal(reason, checks) {
  return {
    allowed: false,
    reason,
    ...checks,
  };
}

function integerOrNull(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function isoStringOrEmpty(value) {
  const ms = dateMsOrNull(value);
  return ms === null ? "" : new Date(ms).toISOString();
}

function dateMsOrNull(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getTime();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : Math.round(value * 1000);
  }
  if (typeof value === "string" && value.trim()) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

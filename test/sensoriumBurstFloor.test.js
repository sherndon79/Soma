import assert from "node:assert/strict";
import test from "node:test";

import {
  BURST_PRESENCE_REASONS,
  evaluateBurstPresenceCoverage,
} from "../src/sensoriumBurstFloor.js";

const SOLO_SAMPLE = Object.freeze({
  person_count: 1,
  count_bucket: "1",
  additional_person_present: "not_detected",
  confidence_bucket: "high",
});

test("burst presence coverage allows exact frameset sequence joins", () => {
  const result = evaluateBurstPresenceCoverage({
    frames: [
      { frame_id: "10", frameset_sequence: 10, capture_timestamp: "2026-07-10T16:00:00.000Z" },
      { frame_id: "11", frameset_sequence: 11, capture_timestamp: "2026-07-10T16:00:01.000Z" },
    ],
    presenceSamples: [
      {
        ...SOLO_SAMPLE,
        frameset_sequence: 10,
        observed_at: "2026-07-10T15:59:59.900Z",
        expires_at: "2026-07-10T16:00:00.500Z",
      },
      {
        ...SOLO_SAMPLE,
        frameset_sequence: 11,
        observed_at: "2026-07-10T16:00:00.900Z",
        expires_at: "2026-07-10T16:00:01.500Z",
      },
    ],
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, BURST_PRESENCE_REASONS.ALLOWED);
  assert.equal(result.coverage_method, "sequence_join");
  assert.equal(result.solo_span_verified, true);
});

test("burst presence coverage falls back when sequence coverage is incomplete", () => {
  const result = evaluateBurstPresenceCoverage({
    frames: [
      { frame_id: "10", frameset_sequence: 10, capture_timestamp: "2026-07-10T16:00:00.000Z" },
      { frame_id: "11", frameset_sequence: 11 },
    ],
    presenceSamples: [
      {
        ...SOLO_SAMPLE,
        frameset_sequence: 10,
        observed_at: "2026-07-10T15:59:59.900Z",
        expires_at: "2026-07-10T16:00:00.500Z",
      },
    ],
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, BURST_PRESENCE_REASONS.PRESENCE_COVERAGE_MISSING);
  assert.equal(result.coverage_method, "timestamp_interval");
  assert.equal(result.missing_capture_timestamp, true);
});

test("burst presence coverage refuses non-solo sequence samples", () => {
  const result = evaluateBurstPresenceCoverage({
    frames: [
      { frame_id: "12", frameset_sequence: 12, capture_timestamp: "2026-07-10T16:00:02.000Z" },
    ],
    presenceSamples: [
      {
        ...SOLO_SAMPLE,
        frameset_sequence: 12,
        person_count: 2,
        count_bucket: "2_plus",
        additional_person_present: "present",
        observed_at: "2026-07-10T16:00:01.900Z",
        expires_at: "2026-07-10T16:00:02.500Z",
      },
    ],
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, BURST_PRESENCE_REASONS.PRESENCE_NOT_SOLO);
  assert.equal(result.coverage_method, "sequence_join");
});

test("burst presence coverage falls back to timestamp interval", () => {
  const result = evaluateBurstPresenceCoverage({
    guardBandMs: 100,
    frames: [
      { frame_id: "20", capture_timestamp: "2026-07-10T16:00:10.000Z" },
      { frame_id: "21", capture_timestamp: "2026-07-10T16:00:10.500Z" },
    ],
    presenceSamples: [
      {
        ...SOLO_SAMPLE,
        observed_at: "2026-07-10T16:00:09.800Z",
        expires_at: "2026-07-10T16:00:10.800Z",
      },
    ],
  });

  assert.equal(result.allowed, true);
  assert.equal(result.coverage_method, "timestamp_interval");
  assert.equal(result.solo_span_verified, true);
});

test("burst presence coverage allows live-shaped unsequenced presence by timestamp interval", () => {
  const result = evaluateBurstPresenceCoverage({
    guardBandMs: 100,
    frames: [
      { frame_id: "20", frameset_sequence: 20, capture_timestamp: "2026-07-10T16:00:10.000Z" },
      { frame_id: "21", frameset_sequence: 21, capture_timestamp: "2026-07-10T16:00:10.500Z" },
    ],
    presenceSamples: [
      {
        ...SOLO_SAMPLE,
        observed_at: "2026-07-10T16:00:09.800Z",
        expires_at: "2026-07-10T16:00:10.800Z",
      },
    ],
  });

  assert.equal(result.allowed, true);
  assert.equal(result.coverage_method, "timestamp_interval");
  assert.equal(result.solo_span_verified, true);
});

test("burst presence coverage refuses stale timestamp interval coverage", () => {
  const result = evaluateBurstPresenceCoverage({
    guardBandMs: 100,
    frames: [
      { frame_id: "30", capture_timestamp: "2026-07-10T16:00:20.000Z" },
      { frame_id: "31", capture_timestamp: "2026-07-10T16:00:20.500Z" },
    ],
    presenceSamples: [
      {
        ...SOLO_SAMPLE,
        observed_at: "2026-07-10T16:00:19.800Z",
        expires_at: "2026-07-10T16:00:20.400Z",
      },
    ],
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, BURST_PRESENCE_REASONS.PRESENCE_STALE);
  assert.equal(result.coverage_method, "timestamp_interval");
});

test("burst presence coverage refuses interior timestamp interval gaps", () => {
  const result = evaluateBurstPresenceCoverage({
    guardBandMs: 100,
    frames: [
      { frame_id: "40", capture_timestamp: "2026-07-10T16:00:30.000Z" },
      { frame_id: "41", capture_timestamp: "2026-07-10T16:00:33.200Z" },
    ],
    presenceSamples: [
      {
        ...SOLO_SAMPLE,
        observed_at: "2026-07-10T16:00:29.800Z",
        expires_at: "2026-07-10T16:00:30.500Z",
      },
      {
        ...SOLO_SAMPLE,
        observed_at: "2026-07-10T16:00:32.600Z",
        expires_at: "2026-07-10T16:00:33.500Z",
      },
    ],
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, BURST_PRESENCE_REASONS.PRESENCE_COVERAGE_MISSING);
  assert.equal(result.coverage_method, "timestamp_interval");
  assert.equal(result.coverage_gap_start, "2026-07-10T16:00:30.500Z");
  assert.equal(result.coverage_gap_end, "2026-07-10T16:00:32.600Z");
});

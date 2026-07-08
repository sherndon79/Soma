import assert from "node:assert/strict";
import test from "node:test";

import { createSensoriumPresenceState } from "../src/sensoriumPresenceState.js";

test("presence state defaults to unknown audience", () => {
  const state = createSensoriumPresenceState();

  assert.equal(state.read().additional_person_present, "unknown");
  assert.equal(state.read().seth_present, "unknown");
});

test("presence state returns fresh audience context until expiry", () => {
  const state = createSensoriumPresenceState({
    now: () => new Date("2026-06-26T01:00:00.000Z"),
  });

  state.updateFromSemanticEvent({
    event_id: "presence-1",
    observed_at: "2026-06-26T01:00:01.000Z",
    expires_at: "2026-06-26T01:00:10.000Z",
    confidence_bucket: "medium",
    audience_context: {
      seth_present: "session_assumed_present",
      additional_person_present: "not_detected",
      copresence_source: "depth",
    },
    payload: {
      person_count: 1,
      count_bucket: "1",
    },
  });

  assert.equal(
    state.read({ now: () => new Date("2026-06-26T01:00:09.999Z") })
      .additional_person_present,
    "not_detected",
  );
  assert.deepEqual(
    state.snapshot({ now: () => new Date("2026-06-26T01:00:09.999Z") }),
    {
      status: "available",
      unavailable_reason: "",
      person_count: 1,
      count_bucket: "1",
      additional_person_present: "not_detected",
      confidence_bucket: "medium",
      observed_at: "2026-06-26T01:00:01.000Z",
      expires_at: "2026-06-26T01:00:10.000Z",
    },
  );
});

test("presence state expires to unknown audience on read", () => {
  const state = createSensoriumPresenceState();

  state.updateFromSemanticEvent({
    event_id: "presence-2",
    observed_at: "2026-06-26T01:00:01.000Z",
    expires_at: "2026-06-26T01:00:10.000Z",
    confidence_bucket: "medium",
    audience_context: {
      seth_present: "session_assumed_present",
      additional_person_present: "not_detected",
      copresence_source: "depth",
    },
    payload: {
      person_count: 1,
      count_bucket: "1",
    },
  });

  const stale = state.snapshot({ now: () => new Date("2026-06-26T01:00:10.000Z") });
  assert.equal(stale.status, "unavailable");
  assert.equal(stale.unavailable_reason, "stale");
  assert.equal(stale.person_count, null);
  assert.equal(stale.count_bucket, "unknown");
  assert.equal(stale.additional_person_present, "unknown");

  const expired = state.read({ now: () => new Date("2026-06-26T01:00:10.000Z") });
  assert.equal(expired.additional_person_present, "unknown");
  assert.equal(expired.copresence_source, "not_enabled");

  const later = state.read({ now: () => new Date("2026-06-26T01:00:11.000Z") });
  assert.equal(later.additional_person_present, "unknown");
  assert.deepEqual(
    state.snapshot({ now: () => new Date("2026-06-26T01:00:11.000Z") }),
    {
      status: "unavailable",
      unavailable_reason: "not_armed_or_cleared",
      person_count: null,
      count_bucket: "unknown",
      additional_person_present: "unknown",
      confidence_bucket: "unknown",
      observed_at: "",
      expires_at: "",
    },
  );
});

test("presence state clear returns to unknown audience", () => {
  const state = createSensoriumPresenceState();

  state.updateFromSemanticEvent({
    event_id: "presence-3",
    expires_at: "2026-06-26T01:00:10.000Z",
    audience_context: {
      seth_present: "session_assumed_present",
      additional_person_present: "not_detected",
      copresence_source: "depth",
    },
  });
  state.clear();

  assert.equal(state.read().additional_person_present, "unknown");
  assert.equal(state.snapshot().status, "unavailable");
  assert.equal(state.snapshot().unavailable_reason, "not_armed_or_cleared");
});

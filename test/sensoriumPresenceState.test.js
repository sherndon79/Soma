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
    expires_at: "2026-06-26T01:00:10.000Z",
    audience_context: {
      seth_present: "session_assumed_present",
      additional_person_present: "not_detected",
      copresence_source: "depth",
    },
  });

  assert.equal(
    state.read({ now: () => new Date("2026-06-26T01:00:09.999Z") })
      .additional_person_present,
    "not_detected",
  );
});

test("presence state expires to unknown audience on read", () => {
  const state = createSensoriumPresenceState();

  state.updateFromSemanticEvent({
    event_id: "presence-2",
    expires_at: "2026-06-26T01:00:10.000Z",
    audience_context: {
      seth_present: "session_assumed_present",
      additional_person_present: "not_detected",
      copresence_source: "depth",
    },
  });

  const expired = state.read({ now: () => new Date("2026-06-26T01:00:10.000Z") });
  assert.equal(expired.additional_person_present, "unknown");
  assert.equal(expired.copresence_source, "not_enabled");

  const later = state.read({ now: () => new Date("2026-06-26T01:00:11.000Z") });
  assert.equal(later.additional_person_present, "unknown");
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
});

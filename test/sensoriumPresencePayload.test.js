import assert from "node:assert/strict";
import test from "node:test";

import {
  SENSORIUM_PRESENCE_SCHEMA,
  summarizeSensoriumPresencePayload,
} from "../src/sensoriumPresencePayload.js";
import { encodePresencePayload } from "./support/msgpackStatus.js";

test("Sensorium presence payload parser accepts the live derived presence shape", () => {
  const summary = summarizeSensoriumPresencePayload(
    encodePresencePayload({
      schema: "perception.presence.v0.1",
      time: 1_783_447_951.14,
      frameset_sequence: 85_203,
      present: true,
      count_bucket: "1",
      additional_person_present: "not_detected",
      confidence_bucket: "medium",
      source: "live",
    }),
  );

  assert.deepEqual(summary, {
    schema: SENSORIUM_PRESENCE_SCHEMA,
    schema_matches_expected: true,
    expected_schema: SENSORIUM_PRESENCE_SCHEMA,
    time: 1_783_447_951.14,
    frameset_sequence: 85_203,
    present: true,
    count_bucket: "1",
    additional_person_present: "not_detected",
    confidence_bucket: "medium",
    source: "live",
  });
});

test("Sensorium presence payload parser records unexpected schema without crashing", () => {
  const summary = summarizeSensoriumPresencePayload(
    encodePresencePayload({ schema: "perception.presence.v9" }),
  );

  assert.equal(summary.schema, "perception.presence.v9");
  assert.equal(summary.schema_matches_expected, false);
  assert.equal(summary.expected_schema, SENSORIUM_PRESENCE_SCHEMA);
});

test("Sensorium presence payload parser rejects unsupported enum values", () => {
  assert.throws(
    () => summarizeSensoriumPresencePayload(encodePresencePayload({ count_bucket: "many" })),
    { code: "sensorium_presence_count_bucket_invalid" },
  );
  assert.throws(
    () =>
      summarizeSensoriumPresencePayload(
        encodePresencePayload({ additional_person_present: "maybe" }),
      ),
    { code: "sensorium_presence_additional_person_present_invalid" },
  );
  assert.throws(
    () => summarizeSensoriumPresencePayload(encodePresencePayload({ confidence_bucket: "certain" })),
    { code: "sensorium_presence_confidence_bucket_invalid" },
  );
});

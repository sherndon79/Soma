import assert from "node:assert/strict";
import test from "node:test";

import {
  SENSORIUM_POSE_SCHEMA,
  summarizeSensoriumPosePayload,
} from "../src/sensoriumPosePayload.js";
import { encodePosePayload } from "./support/msgpackStatus.js";

test("pose payload parser preserves the full derived pose contract", () => {
  const summary = summarizeSensoriumPosePayload(
    encodePosePayload({
      frameset_sequence: 99,
      persons: [
        {
          track_id: 42,
          keypoint_count: 127,
          body_keypoints: Array.from({ length: 17 }, (_, i) => [i, i + 0.1]),
          body_scores: Array.from({ length: 17 }, () => 0.9),
          face_keypoints: Array.from({ length: 68 }, (_, i) => [100 + i, 100 + i + 0.1]),
          face_scores: Array.from({ length: 68 }, () => 0.8),
          left_hand_keypoints: Array.from({ length: 21 }, (_, i) => [200 + i, 200 + i + 0.1]),
          left_hand_scores: Array.from({ length: 21 }, () => 0.7),
          right_hand_keypoints: Array.from({ length: 21 }, (_, i) => [300 + i, 300 + i + 0.1]),
          right_hand_scores: Array.from({ length: 21 }, () => 0.6),
          derived: {
            posture: "standing",
            gaze: "toward_display",
            gestures: ["open_hand"],
            position_3d: { x: 0.1, y: 0.2, z: 1.4 },
          },
        },
      ],
    }),
  );

  assert.equal(summary.schema, SENSORIUM_POSE_SCHEMA);
  assert.equal(summary.schema_matches_expected, true);
  assert.equal(summary.frameset_sequence, 99);
  assert.equal(summary.persons.length, 1);
  assert.equal(summary.persons[0].track_id, 42);
  assert.equal(summary.persons[0].body_keypoints.length, 17);
  assert.equal(summary.persons[0].face_keypoints.length, 68);
  assert.equal(summary.persons[0].left_hand_keypoints.length, 21);
  assert.equal(summary.persons[0].right_hand_keypoints.length, 21);
  assert.deepEqual(summary.persons[0].derived.gestures, ["open_hand"]);
  assert.equal(summary.detections[0].xyxy.length, 4);
  assert.equal(JSON.stringify(summary).includes("raw color"), false);
});

test("pose payload parser rejects oversized person arrays before disclosure", () => {
  assert.throws(
    () =>
      summarizeSensoriumPosePayload(
        encodePosePayload({
          persons: Array.from({ length: 9 }, () => ({
            keypoint_count: 127,
            body_keypoints: Array.from({ length: 17 }, () => [1, 2]),
            body_scores: Array.from({ length: 17 }, () => 0.9),
            face_keypoints: Array.from({ length: 68 }, () => [1, 2]),
            face_scores: Array.from({ length: 68 }, () => 0.9),
            left_hand_keypoints: Array.from({ length: 21 }, () => [1, 2]),
            left_hand_scores: Array.from({ length: 21 }, () => 0.9),
            right_hand_keypoints: Array.from({ length: 21 }, () => [1, 2]),
            right_hand_scores: Array.from({ length: 21 }, () => 0.9),
          })),
        }),
      ),
    { code: "sensorium_pose_persons_too_many" },
  );
});

test("pose payload parser rejects malformed landmark tiers", () => {
  assert.throws(
    () =>
      summarizeSensoriumPosePayload(
        encodePosePayload({
          persons: [
            {
              keypoint_count: 126,
              body_keypoints: Array.from({ length: 16 }, () => [1, 2]),
              body_scores: Array.from({ length: 17 }, () => 0.9),
              face_keypoints: Array.from({ length: 68 }, () => [1, 2]),
              face_scores: Array.from({ length: 68 }, () => 0.9),
              left_hand_keypoints: Array.from({ length: 21 }, () => [1, 2]),
              left_hand_scores: Array.from({ length: 21 }, () => 0.9),
              right_hand_keypoints: Array.from({ length: 21 }, () => [1, 2]),
              right_hand_scores: Array.from({ length: 21 }, () => 0.9),
            },
          ],
        }),
      ),
    { code: "sensorium_pose_body_keypoints_invalid" },
  );
});

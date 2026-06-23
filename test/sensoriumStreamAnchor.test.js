import assert from "node:assert/strict";
import test from "node:test";

import {
  classifySensoriumTopic,
  createSensoriumStreamAnchor,
} from "../src/sensoriumStreamAnchor.js";

test("stream anchor derives depth active and color inactive from helper status", () => {
  const anchor = createSensoriumStreamAnchor({
    helperStatus: {
      count: 1,
      subscriptions: [
        {
          subscription_id: "sub-depth",
          topic: "sensor/jetsorano/realsense/depth",
          started_at: 1_700_000_000,
          active: true,
        },
      ],
    },
    nodeSubscriptions: [
      {
        subscription_id: "sub-color-node-only",
        topic: "sensor/jetsorano/realsense/color",
        started_at: 1_700_000_001,
        active: true,
      },
    ],
  });

  assert.equal(anchor.source, "helper_status");
  assert.equal(anchor.authority_anchor, "sensorium.subscribe.status");
  assert.equal(anchor.depth_active, true);
  assert.equal(anchor.color_active, false);
  assert.equal(anchor.color_inactive_confirmed, true);
  assert.equal(anchor.raw_payload_included, false);
  assert.deepEqual(
    anchor.active_streams.map((stream) => stream.stream_type),
    ["depth"],
  );
  assert.equal(anchor.node_reconciliation.matched, false);
  assert.deepEqual(anchor.node_reconciliation.missing_in_helper, ["sub-color-node-only"]);
});

test("stream anchor classifies realsense and status topics without payloads", () => {
  assert.deepEqual(classifySensoriumTopic("sensor/jetsorano/realsense/color"), {
    capability: "perception.sensorium.color.subscribe",
    stream_type: "color",
    host: "jetsorano",
  });
  assert.deepEqual(classifySensoriumTopic("sensor/jetsorano/realsense/depth"), {
    capability: "perception.sensorium.depth.subscribe",
    stream_type: "depth",
    host: "jetsorano",
  });
  assert.deepEqual(classifySensoriumTopic("sensor/jetsorano/status"), {
    capability: "perception.sensorium.status.subscribe",
    stream_type: "status",
    host: "jetsorano",
  });
});

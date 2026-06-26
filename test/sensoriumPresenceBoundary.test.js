import assert from "node:assert/strict";
import test from "node:test";

import {
  COLOR_SUBSCRIPTION_CAPABILITY,
  DEPTH_SUBSCRIPTION_CAPABILITY,
  buildDepthPresenceBoundaryPlan,
} from "../src/sensoriumPresenceBoundary.js";

test("depth presence boundary has helper semantics but no live subscription", () => {
  const plan = buildDepthPresenceBoundaryPlan({
    sethPresent: "session_assumed_present",
    additionalPersonPresent: "not_detected",
    countBucket: "1",
    confidenceBucket: "medium",
  });

  assert.equal(plan.helper_side_presence_derivation_available, true);
  assert.equal(plan.semantic_event_handler_available, true);
  assert.equal(plan.subscriber_dispatch_available, true);
  assert.equal(plan.live_depth_presence_available, false);
  assert.equal(plan.activation_allowed, false);
  assert.equal(plan.blocker, "live_presence_subscription_not_wired");
  assert.equal(plan.semantic_event_contract.raw_payload_allowed_to_node, false);
  assert.equal(plan.semantic_event_contract.color_required, false);
  assert.equal(plan.semantic_event_contract.identity, "not_performed");
  assert.equal(plan.semantic_event_contract.seth_present, "session_assumed_present");
  assert.equal(plan.semantic_event_contract.additional_person_present, "not_detected");
  assert.equal(plan.semantic_event_contract.count_bucket, "1");
  assert.equal(plan.semantic_event_contract.confidence_bucket, "medium");
  assert.equal(plan.semantic_event_contract.copresence_source, "depth");
});

test("depth presence boundary refuses color as a source capability", () => {
  const plan = buildDepthPresenceBoundaryPlan({
    sourceCapabilities: [
      DEPTH_SUBSCRIPTION_CAPABILITY,
      COLOR_SUBSCRIPTION_CAPABILITY,
    ],
  });

  assert.equal(plan.refused, true);
  assert.ok(
    plan.findings.includes("color subscription capability is forbidden for depth presence"),
  );
});

test("depth presence boundary requires depth source and preserves non-identity Seth posture", () => {
  const plan = buildDepthPresenceBoundaryPlan({
    sourceCapabilities: [],
    sethPresent: "identified",
  });

  assert.equal(plan.refused, true);
  assert.ok(plan.findings.includes("depth subscription capability is required for depth presence"));
  assert.equal(plan.semantic_event_contract.seth_present, "unknown");
  assert.equal(plan.semantic_event_contract.identity, "not_performed");
});

test("depth presence boundary does not accept high-confidence identity-style claims", () => {
  const plan = buildDepthPresenceBoundaryPlan({
    confidenceBucket: "high",
  });

  assert.equal(plan.semantic_event_contract.confidence_bucket, "low");
});

import assert from "node:assert/strict";
import test from "node:test";

import { assessEscalationTriggers } from "../src/escalationTriggers.js";

const unsupportedRemotePlanningView = {
  capabilities: [
    {
      key: "model.remote.plan",
      status: "unsupported",
    },
  ],
};

test("assessEscalationTriggers returns no triggers for simple local tasks", () => {
  const assessment = assessEscalationTriggers({
    messages: [{ role: "user", content: "Summarize this short note." }],
    completionText: "Here is a concise summary.",
    capabilityView: unsupportedRemotePlanningView,
  });

  assert.equal(assessment.assessed, true);
  assert.equal(assessment.triggers_fired, false);
  assert.deepEqual(assessment.trigger_families, []);
  assert.equal(assessment.remote_planning_status, "unsupported");
  assert.equal(assessment.remote_planning_available, false);
  assert.equal(assessment.remote_service_used, false);
});

test("assessEscalationTriggers detects uncertainty signals from model output", () => {
  const assessment = assessEscalationTriggers({
    messages: [{ role: "user", content: "Can you solve this?" }],
    completionText: "I am not sure there is sufficient context to answer.",
    capabilityView: unsupportedRemotePlanningView,
  });

  assert.equal(assessment.triggers_fired, true);
  assert.deepEqual(assessment.trigger_families, ["uncertainty"]);
});

test("assessEscalationTriggers detects complexity signals from user task", () => {
  const assessment = assessEscalationTriggers({
    messages: [{ role: "user", content: "Please review this complex architecture migration." }],
    completionText: "I can start locally.",
    capabilityView: unsupportedRemotePlanningView,
  });

  assert.equal(assessment.triggers_fired, true);
  assert.deepEqual(assessment.trigger_families, ["complexity"]);
});

test("assessEscalationTriggers detects capability gap signals", () => {
  const assessment = assessEscalationTriggers({
    messages: [{ role: "user", content: "Should we escalate to a remote planner?" }],
    completionText: "Remote planning is unavailable in this harness.",
    capabilityView: unsupportedRemotePlanningView,
  });

  assert.equal(assessment.triggers_fired, true);
  assert.deepEqual(assessment.trigger_families, ["capability_gap"]);
});

test("assessEscalationTriggers detects capability validation failures", () => {
  const assessment = assessEscalationTriggers({
    messages: [{ role: "user", content: "Use the available capabilities." }],
    completionText: "I can continue locally.",
    capabilityView: unsupportedRemotePlanningView,
    validationFailures: [
      {
        capability: "desktop.inspect.text",
        reason: "unsupported",
      },
    ],
  });

  assert.equal(assessment.triggers_fired, true);
  assert.deepEqual(assessment.trigger_families, ["capability_validation_failure"]);
  assert.equal(assessment.remote_service_used, false);
});

test("assessEscalationTriggers marks remote planning available only for active or requestable status", () => {
  for (const status of ["active", "requestable"]) {
    const assessment = assessEscalationTriggers({
      messages: [{ role: "user", content: "hello" }],
      capabilityView: { capabilities: [{ key: "model.remote.plan", status }] },
    });
    assert.equal(assessment.remote_planning_status, status);
    assert.equal(assessment.remote_planning_available, true);
    assert.equal(assessment.remote_service_used, false);
  }

  for (const status of ["unsupported", "disabled", "forbidden", "excluded"]) {
    const assessment = assessEscalationTriggers({
      messages: [{ role: "user", content: "hello" }],
      capabilityView: { capabilities: [{ key: "model.remote.plan", status }] },
    });
    assert.equal(assessment.remote_planning_status, status);
    assert.equal(assessment.remote_planning_available, false);
    assert.equal(assessment.remote_service_used, false);
  }
});

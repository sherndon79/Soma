export function assessEscalationTriggers({
  messages = [],
  completionText = "",
  capabilityView = { capabilities: [] },
} = {}) {
  const submittedText = messages
    .filter((message) => message.role === "user")
    .map((message) => String(message.content ?? ""))
    .join("\n");
  const combinedText = `${submittedText}\n${completionText}`.toLowerCase();
  const triggerFamilies = [];

  if (hasUncertaintySignal(combinedText)) {
    triggerFamilies.push("uncertainty");
  }
  if (hasComplexitySignal(submittedText)) {
    triggerFamilies.push("complexity");
  }
  if (hasCapabilityGapSignal(combinedText)) {
    triggerFamilies.push("capability_gap");
  }

  const remotePlan = capabilityView.capabilities?.find((capability) => capability.key === "model.remote.plan");
  const remotePlanStatus = remotePlan?.status ?? "unknown";
  const remotePlanningAvailable = remotePlanStatus === "active" || remotePlanStatus === "requestable";

  return {
    assessed: true,
    triggers_fired: triggerFamilies.length > 0,
    trigger_families: triggerFamilies,
    remote_planning_capability: "model.remote.plan",
    remote_planning_status: remotePlanStatus,
    remote_planning_available: remotePlanningAvailable,
    remote_service_used: false,
    recommendation: triggerFamilies.length > 0
      ? "Continue locally or review escalation options; no remote routing was performed."
      : "Continue locally; no escalation triggers fired.",
  };
}

function hasUncertaintySignal(text) {
  return /\b(not sure|uncertain|out of depth|can't determine|cannot determine|insufficient context|low confidence)\b/i
    .test(text);
}

function hasComplexitySignal(text) {
  const normalized = String(text ?? "").toLowerCase();
  return (
    normalized.length > 900 ||
    /\b(complex|multi-step|architecture|architectural|design review|migration|refactor|roadmap)\b/
      .test(normalized)
  );
}

function hasCapabilityGapSignal(text) {
  return /\b(remote planner|remote planning|escalat(e|ion)|stronger model|more capable model|model\.remote\.plan)\b/i
    .test(text);
}


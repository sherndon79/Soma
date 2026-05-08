import { randomUUID } from "node:crypto";

export function createProvenance({
  capability,
  modelProfile,
  route = "local",
  caller = "",
  memoryRead = false,
  memoryWritten = false,
  cognitiveLoadAssessed = false,
  escalationAssessed = false,
  allowed = null,
  denialReason = "",
}) {
  const provenance = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    event_type: "model.chat.requested",
    capability,
    route,
    model_profile: modelProfile,
    caller_identity: caller,
    memory_read: memoryRead,
    memory_written: memoryWritten,
    cognitive_load_assessed: cognitiveLoadAssessed,
    escalation_assessed: escalationAssessed,
    tools_available: false,
    remote_service_used: route !== "local",
  };

  if (allowed !== null) {
    provenance.allowed = allowed;
  }
  if (denialReason) {
    provenance.denial_reason = denialReason;
  }

  return provenance;
}

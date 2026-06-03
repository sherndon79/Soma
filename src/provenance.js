import { randomUUID } from "node:crypto";

export function createProvenance({
  capability,
  modelProfile,
  requestedProfile = "",
  effectiveProfile = "",
  forceProfileApplied = false,
  episodeId = "",
  episodePosture = null,
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
    requested_profile: requestedProfile || modelProfile,
    effective_profile: effectiveProfile || modelProfile,
    force_profile_applied: Boolean(forceProfileApplied),
    episode_id: episodeId,
    caller_identity: caller,
    memory_read: memoryRead,
    memory_written: memoryWritten,
    cognitive_load_assessed: cognitiveLoadAssessed,
    escalation_assessed: escalationAssessed,
    tools_available: false,
    remote_service_used: route !== "local",
  };

  if (episodePosture) {
    provenance.episode_posture = episodePosture;
  }

  if (allowed !== null) {
    provenance.allowed = allowed;
  }
  if (denialReason) {
    provenance.denial_reason = denialReason;
  }

  return provenance;
}

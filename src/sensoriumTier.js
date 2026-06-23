import { randomUUID } from "node:crypto";

export const SENSORIUM_TIER_PROVIDER_ID = "soma.provider.sensorium-tier";
export const SENSORIUM_SEMANTIC_EVENT_CAPABILITY = "sensorium.semantic_events.read";
export const DESKTOP_VISUAL_CUE_CAPABILITY = "desktop.visual_cue.present";

const ALLOWED_SCREEN_EVENT_TYPES = new Set(["screen.structure"]);
const ALLOWED_VISUAL_ACT_KINDS = new Set(["visual_cue.show", "surface.present"]);
const ALLOWED_VISUAL_SUBSTRATES = new Set(["occupant_panel"]);
const COMMUNICATIVE_INTENTS = new Set(["none", "low", "high"]);
const AUDIENCE_SCOPES = new Set(["seth_only", "copresent_room", "third_party", "unknown"]);
const OUTPUT_MODES = new Set(["visual.occupant_owned", "audio.private_content", "audio.neutral_earcon"]);

export function localAudienceContext({
  sethPresent = "unknown",
  seth_present,
  additionalPersonPresent = "unknown",
  additional_person_present,
  copresenceSource = "not_enabled",
  copresence_source,
} = {}) {
  return Object.freeze({
    seth_present: enumValue(seth_present ?? sethPresent, ["present", "absent", "unknown"], "unknown"),
    additional_person_present: enumValue(
      additional_person_present ?? additionalPersonPresent,
      ["present", "not_detected", "unknown"],
      "unknown",
    ),
    copresence_source: enumValue(
      copresence_source ?? copresenceSource,
      ["camera", "mic", "camera_mic", "not_enabled", "muted", "unknown"],
      "not_enabled",
    ),
  });
}

export function createScreenStructureSemanticEvent({
  inspection = {},
  grant = {},
  sourceGrant = {},
  sourceCapability = "desktop.inspect.focus",
  audienceContext = localAudienceContext(),
  now = () => new Date(),
  idFactory = randomUUID,
} = {}) {
  const observedAt = asDate(now());
  const normalizedAudienceContext = localAudienceContext(audienceContext);
  const event = {
    schema_version: 1,
    event_id: idFactory(),
    observed_at: observedAt.toISOString(),
    expires_at: new Date(observedAt.getTime() + 10_000).toISOString(),
    source: {
      tier: "sensorium.local",
      provider: sourceGrant.provider ?? "",
      capability: sourceCapability,
      grant_id: sourceGrant.id ?? "",
      domain: sourceGrant.constraints?.domain ?? "testing",
    },
    channel: "desktop.screen",
    event_type: "screen.structure",
    minimization: {
      level: "semantic",
      raw_retained: false,
      raw_egressed: false,
      content_included: false,
    },
    confidence_bucket: inspection.focus_available === true ? "medium" : "low",
    audience_context: normalizedAudienceContext,
    payload: screenStructurePayload(inspection),
    policy_effects: {
      allowed_output_modes: ["visual.occupant_owned"],
      blocked_output_modes: ["audio.private_content"],
      reason_codes: normalizedAudienceContext.additional_person_present === "not_detected"
        ? []
        : ["copresence_not_exclusive"],
    },
  };
  assertSemanticEvent(event);
  return Object.freeze(event);
}

export function scoreSensoriumOutputAct({
  proposal = {},
  grant = {},
  liveAudienceContext = localAudienceContext(),
  now = () => new Date(),
  idFactory = randomUUID,
} = {}) {
  const proposedAt = asDate(now()).toISOString();
  const actKind = stringValue(proposal.act_kind || proposal.actKind || "visual_cue.show");
  const substrate = stringValue(proposal.substrate || "occupant_panel");
  const principal = stringValue(proposal.principal || "occupant");
  const requestedAudienceScope = enumValue(
    proposal.audience_scope,
    [...AUDIENCE_SCOPES],
    "unknown",
  );
  const outputMode = enumValue(proposal.output_mode, [...OUTPUT_MODES], "visual.occupant_owned");
  const communicativeIntent = enumValue(
    proposal.communicative_intent,
    [...COMMUNICATIVE_INTENTS],
    "high",
  );
  const reversibility = proposal.reversibility === false ? "not_reversible" : "reversible";
  const externalReach = proposal.external_reach === true;
  const foregroundIntrusion = enumValue(
    proposal.foreground_intrusion,
    ["none", "low", "high"],
    "none",
  );
  const audienceContext = localAudienceContext(liveAudienceContext);
  const consequenceClass = deriveConsequenceClass({
    actKind,
    substrate,
    principal,
    // Future egress-capable slices must derive this from reconciled audience,
    // never letting caller-declared audience lower the local consequence floor.
    audienceScope: requestedAudienceScope,
    externalReach,
    reversibility,
    foregroundIntrusion,
  });
  const reconciliation = reconcileAudience({
    requestedAudienceScope,
    outputMode,
    audienceContext,
  });
  const structuralRefusal = validateFirstSliceAct({ actKind, substrate, principal });
  const allowed = !structuralRefusal && reconciliation.allowed;

  return Object.freeze({
    schema_version: 1,
    act_id: idFactory(),
    proposed_at: proposedAt,
    act_kind: actKind,
    substrate,
    principal,
    requested_audience_scope: requestedAudienceScope,
    audience_scope: reconciliation.audience_scope,
    output_mode: outputMode,
    consequence_class: consequenceClass,
    consequence_class_source: "local_gate_derived",
    caller_supplied_consequence_class_ignored: proposal.consequence_class !== undefined,
    communicative_intent: communicativeIntent,
    authority: {
      capability: DESKTOP_VISUAL_CUE_CAPABILITY,
      provider: grant.provider ?? SENSORIUM_TIER_PROVIDER_ID,
      grant_id: grant.id ?? "",
      requires_lca: consequenceClass === "C3" || consequenceClass === "C4",
    },
    provenance: {
      must_be_occupant_marked: true,
      may_mimic_os_chrome: false,
      content_recorded: false,
    },
    discretion: {
      steal_focus: false,
      private_content_allowed: outputMode !== "audio.private_content" && reconciliation.private_content_allowed,
      foreground_intrusion: foregroundIntrusion,
    },
    audience_context: audienceContext,
    allowed,
    refusal_reason: structuralRefusal || reconciliation.refusal_reason,
    reconciled_output_mode: reconciliation.output_mode,
    reconciliation_reason: reconciliation.reason,
  });
}

export function createSensoriumSemanticEventProvenance({
  semanticEvent = {},
  grant = {},
  caller = "",
} = {}) {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    event_type: "sensorium.semantic_event.observed",
    capability: SENSORIUM_SEMANTIC_EVENT_CAPABILITY,
    caller_identity: stringValue(caller),
    allowed: true,
    grant_id: grant.id ?? "",
    provider: grant.provider ?? "",
    scope: grant.scope ?? "",
    semantic_event_id: semanticEvent.event_id ?? "",
    semantic_event_type: semanticEvent.event_type ?? "",
    channel: semanticEvent.channel ?? "",
    source_capability: semanticEvent.source?.capability ?? "",
    source_grant_id: semanticEvent.source?.grant_id ?? "",
    minimization_level: semanticEvent.minimization?.level ?? "",
    raw_retained: semanticEvent.minimization?.raw_retained === true,
    raw_egressed: semanticEvent.minimization?.raw_egressed === true,
    content_included: semanticEvent.minimization?.content_included === true,
    audience_additional_person: semanticEvent.audience_context?.additional_person_present ?? "unknown",
    expires_at: semanticEvent.expires_at ?? "",
    memory_written: false,
    remote_service_used: false,
  };
}

export function createSensoriumOutputActProvenance({
  eventType,
  scoredAct = {},
  grant = {},
  caller = "",
} = {}) {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    event_type: eventType,
    capability: DESKTOP_VISUAL_CUE_CAPABILITY,
    caller_identity: stringValue(caller),
    allowed: scoredAct.allowed === true,
    grant_id: grant.id ?? scoredAct.authority?.grant_id ?? "",
    provider: grant.provider ?? scoredAct.authority?.provider ?? "",
    scope: grant.scope ?? "",
    act_id: scoredAct.act_id ?? "",
    act_kind: scoredAct.act_kind ?? "",
    substrate: scoredAct.substrate ?? "",
    principal: scoredAct.principal ?? "",
    requested_audience_scope: scoredAct.requested_audience_scope ?? "",
    audience_scope: scoredAct.audience_scope ?? "",
    output_mode: scoredAct.output_mode ?? "",
    reconciled_output_mode: scoredAct.reconciled_output_mode ?? "",
    consequence_class: scoredAct.consequence_class ?? "",
    consequence_class_source: scoredAct.consequence_class_source ?? "",
    caller_supplied_consequence_class_ignored:
      scoredAct.caller_supplied_consequence_class_ignored === true,
    communicative_intent: scoredAct.communicative_intent ?? "",
    refusal_reason: scoredAct.refusal_reason ?? "",
    reconciliation_reason: scoredAct.reconciliation_reason ?? "",
    occupant_marked: scoredAct.provenance?.must_be_occupant_marked === true,
    os_chrome_mimicry_allowed: scoredAct.provenance?.may_mimic_os_chrome === true,
    content_recorded: false,
    memory_written: false,
    remote_service_used: false,
  };
}

export function visualCueRenderResult({ scoredAct = {}, cue = {} } = {}) {
  return Object.freeze({
    rendered: true,
    renderer: "sensorium.local.visual_cue.fixture",
    act_id: scoredAct.act_id ?? "",
    surface_owner: "occupant",
    occupant_marked: true,
    may_mimic_os_chrome: false,
    substrate: scoredAct.substrate ?? "occupant_panel",
    output_mode: "visual.occupant_owned",
    cue: {
      variant: enumValue(cue.variant, ["note", "attention", "uncertainty"], "note"),
      priority: enumValue(cue.priority, ["low", "normal"], "normal"),
      text: boundedText(cue.text ?? "Soma occupant cue", 280),
    },
  });
}

function screenStructurePayload(inspection = {}) {
  const focused = inspection.focused_object ?? null;
  return {
    focus: focused && inspection.focus_available === true
      ? {
          surface_ref: "opaque-current-focus",
          role: stringValue(focused.role || "unknown"),
          child_count_bucket: bucketCount(focused.child_count),
          occupant_owned: false,
          content_class: "none",
        }
      : {
          surface_ref: "",
          role: "unknown",
          child_count_bucket: "unknown",
          occupant_owned: false,
          content_class: "none",
        },
    windows_count_bucket: "unknown",
    available_refs: inspection.focus_available === true ? ["opaque-current-focus"] : [],
  };
}

function deriveConsequenceClass({
  substrate,
  audienceScope,
  externalReach,
  reversibility,
  foregroundIntrusion,
} = {}) {
  if (externalReach || audienceScope === "third_party" || substrate === "external_network") {
    return "C3";
  }
  if (substrate === "seth_app") {
    return reversibility === "reversible" ? "C1" : "C2";
  }
  if (substrate === "system_surface") {
    return "C2";
  }
  if (foregroundIntrusion === "high") {
    return "C1";
  }
  return "C0";
}

function reconcileAudience({ requestedAudienceScope, outputMode, audienceContext }) {
  const exclusive = audienceContext.additional_person_present === "not_detected";
  if (outputMode === "audio.private_content" && !exclusive) {
    return {
      allowed: false,
      audience_scope: audienceContext.additional_person_present === "present"
        ? "copresent_room"
        : "unknown",
      output_mode: "visual.occupant_owned",
      private_content_allowed: false,
      reason: "copresence_not_exclusive",
      refusal_reason: "audio_private_content_requires_exclusive_audience",
    };
  }
  return {
    allowed: true,
    audience_scope: requestedAudienceScope,
    output_mode: outputMode,
    private_content_allowed: outputMode === "visual.occupant_owned",
    reason: exclusive ? "exclusive_audience_observed" : "visual_mode_allowed_under_unknown_copresence",
    refusal_reason: "",
  };
}

function validateFirstSliceAct({ actKind, substrate, principal }) {
  if (!ALLOWED_VISUAL_ACT_KINDS.has(actKind)) {
    return "visual_cue_act_kind_not_supported";
  }
  if (!ALLOWED_VISUAL_SUBSTRATES.has(substrate)) {
    return "visual_cue_substrate_not_supported";
  }
  if (principal !== "occupant") {
    return "visual_cue_principal_must_be_occupant";
  }
  return "";
}

function assertSemanticEvent(event) {
  if (!ALLOWED_SCREEN_EVENT_TYPES.has(event.event_type)) {
    throw new TypeError("semantic event type is not supported");
  }
  if (event.minimization.raw_retained || event.minimization.raw_egressed) {
    throw new TypeError("semantic event must not retain or egress raw sensory payloads");
  }
  if (event.minimization.content_included) {
    throw new TypeError("screen structure semantic event must not include content");
  }
}

function bucketCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) {
    return "unknown";
  }
  if (count === 0) {
    return "0";
  }
  if (count <= 5) {
    return "1_5";
  }
  return "6_plus";
}

function boundedText(value, maxLength) {
  const text = stringValue(value);
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function enumValue(value, allowed, fallback) {
  const candidate = stringValue(value);
  return allowed.includes(candidate) ? candidate : fallback;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asDate(value) {
  const date = value instanceof Date ? value : value();
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError("now must return a valid Date");
  }
  return date;
}

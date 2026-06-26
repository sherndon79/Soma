export const SENSORIUM_DEPTH_PRESENCE_CAPABILITY = "sensorium.presence.depth.read";
export const DEPTH_SUBSCRIPTION_CAPABILITY = "perception.sensorium.depth.subscribe";
export const COLOR_SUBSCRIPTION_CAPABILITY = "perception.sensorium.color.subscribe";

const SETH_PRESENT_VALUES = new Set(["session_assumed_present", "zone_present", "unknown"]);
const ADDITIONAL_PERSON_VALUES = new Set(["present", "not_detected", "unknown"]);
const COUNT_BUCKETS = new Set(["0", "1", "2_plus", "unknown"]);
const CONFIDENCE_BUCKETS = new Set(["low", "medium"]);

export function buildDepthPresenceBoundaryPlan({
  sourceCapabilities = [DEPTH_SUBSCRIPTION_CAPABILITY],
  sethPresent = "unknown",
  additionalPersonPresent = "unknown",
  countBucket = "unknown",
  confidenceBucket = "low",
} = {}) {
  const capabilities = normalizeCapabilities(sourceCapabilities);
  const findings = [];
  if (!capabilities.includes(DEPTH_SUBSCRIPTION_CAPABILITY)) {
    findings.push("depth subscription capability is required for depth presence");
  }
  if (capabilities.includes(COLOR_SUBSCRIPTION_CAPABILITY)) {
    findings.push("color subscription capability is forbidden for depth presence");
  }

  return Object.freeze({
    schema_version: 1,
    capability: SENSORIUM_DEPTH_PRESENCE_CAPABILITY,
    source_capabilities: capabilities,
    helper_side_presence_derivation_available: true,
    semantic_event_handler_available: true,
    subscriber_dispatch_available: true,
    live_depth_presence_available: false,
    activation_allowed: false,
    blocker: "live_presence_subscription_not_wired",
    refused: findings.length > 0,
    findings,
    semantic_event_contract: {
      event_type: "presence.depth",
      channel: "camera.depth",
      raw_payload_allowed_to_node: false,
      color_required: false,
      identity: "not_performed",
      seth_present: enumValue(sethPresent, SETH_PRESENT_VALUES, "unknown"),
      additional_person_present: enumValue(
        additionalPersonPresent,
        ADDITIONAL_PERSON_VALUES,
        "unknown",
      ),
      count_bucket: enumValue(countBucket, COUNT_BUCKETS, "unknown"),
      confidence_bucket: enumValue(confidenceBucket, CONFIDENCE_BUCKETS, "low"),
      copresence_source: "depth",
    },
  });
}

function normalizeCapabilities(capabilities) {
  if (!Array.isArray(capabilities)) {
    return [];
  }
  return [...new Set(capabilities.map(stringValue).filter(Boolean))];
}

function enumValue(value, allowed, fallback) {
  const text = stringValue(value);
  return allowed.has(text) ? text : fallback;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

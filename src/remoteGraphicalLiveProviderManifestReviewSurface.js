import { validateRemoteGraphicalLiveProviderManifest } from "./remoteGraphicalLiveProviderManifest.js";

export function remoteGraphicalLiveProviderManifestReviewText(manifest = {}) {
  const validated = validateRemoteGraphicalLiveProviderManifest(manifest);
  const implementation = validated.implementation ?? {};
  const targets = validated.target_constraints ?? {};

  return [
    "Remote graphical live provider manifest",
    `  provider: ${validated.id}`,
    `  manifest version: ${validated.manifest_version}`,
    `  provider contract: ${validated.provider_contract}`,
    `  runtime: ${validated.runtime}`,
    `  implementation: broker=${implementation.broker_kind} transport=${implementation.transport} construction=${implementation.construction}`,
    `  default enabled: ${booleanText(validated.default_enabled)}`,
    `  runtime opt-ins: ${joinList(validated.required_runtime_opt_ins)}`,
    `  target hosts: ${joinList(targets.allowed_hosts)}`,
    `  locality: ${joinList(targets.locality)}`,
    `  attended required: ${booleanText(targets.attended_required)}`,
    `  rollback: ${targets.operator_rollback ?? "unknown"}`,
    `  supported actions: ${supportedActionsText(validated.supported_actions)}`,
    `  disabled authorities: ${joinList(validated.disabled_authorities)}`,
    `  review only: ${booleanText(validated.review_only)}`,
    `  runtime loaded: ${booleanText(validated.runtime_loaded)}`,
    `  provider registry entry: ${booleanText(validated.provider_registry_entry)}`,
    `  broker construction: ${booleanText(validated.broker_construction)}`,
    "  activation blockers: not in provider registry; not loaded by server startup; no broker construction",
    "  activation boundary: manifest review is not live transport, pairing, observation, input, recording, grant write, or model delivery",
  ].join("\n");
}

function supportedActionsText(actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return "unknown";
  }
  return actions.map((action) => {
    const flags = [
      `grant=${booleanText(action.requires_grant)}`,
      `user=${booleanText(action.requires_user_actor)}`,
      `review=${booleanText(action.requires_review)}`,
      `live_transport=${booleanText(action.live_transport_allowed)}`,
    ];
    if (Array.isArray(action.must_not_enable) && action.must_not_enable.length > 0) {
      flags.push(`must_not_enable=${action.must_not_enable.join("/")}`);
    }
    return `${action.action}(${flags.join(",")})`;
  }).join("; ");
}

function joinList(value) {
  return Array.isArray(value) && value.length > 0 ? value.join(", ") : "unknown";
}

function booleanText(value) {
  if (value === true) {
    return "yes";
  }
  if (value === false) {
    return "no";
  }
  return "unknown";
}

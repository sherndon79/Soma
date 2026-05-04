import { readFile } from "node:fs/promises";

const DEFAULT_RUNTIME_PROFILES_PATH = new URL("../config/runtime-profiles.json", import.meta.url);

export async function loadRuntimeProfiles(path = DEFAULT_RUNTIME_PROFILES_PATH) {
  const raw = await readFile(path, "utf8");
  return normalizeRuntimeProfiles(JSON.parse(raw));
}

export function normalizeRuntimeProfiles(config) {
  const profiles = Array.isArray(config.profiles) ? config.profiles : [];
  return {
    schema_version: config.schema_version ?? 1,
    default_profile: config.default_profile ?? profiles[0]?.id ?? "",
    profiles,
  };
}

export function resolveRuntimeProfile(config, requestedProfileId = "") {
  const profileId = String(requestedProfileId || config.default_profile || "").trim();
  const profile = config.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) {
    const error = new Error(`Runtime profile ${profileId || "(default)"} is not available.`);
    error.statusCode = 400;
    error.code = "runtime_profile_not_available";
    throw error;
  }
  return profile;
}

export function capabilityForRuntimeProfile(profile) {
  return profile.route === "remote" ? "model.remote.chat" : "model.local.chat";
}

export function publicRuntimeProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    route: profile.route,
    model: profile.model,
    max_context_tokens: profile.max_context_tokens,
    tool_calls_supported: Boolean(profile.tool_calls_supported),
    tool_calls_enabled: Boolean(profile.tool_calls_enabled),
    remote_service: Boolean(profile.remote_service),
    allowed_data_classes: profile.allowed_data_classes ?? [],
    description: profile.description ?? "",
  };
}

export function publicRuntimeProfiles(config) {
  return {
    schema_version: config.schema_version,
    default_profile: config.default_profile,
    profiles: config.profiles.map(publicRuntimeProfile),
  };
}

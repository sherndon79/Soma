import {
  QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH,
  QUEST_SURFACE_PROVIDER_ID,
} from "./questSurfaceProtocol.js";

export const QUEST_SURFACE_DEFAULT_EPISODE_TTL_MS = 60 * 60 * 1000;
export const QUEST_SURFACE_MIN_EPISODE_TTL_MS = 1000;
export const QUEST_SURFACE_MAX_EPISODE_TTL_MS = 24 * 60 * 60 * 1000;

const TEXT_LOCAL_MODE = Object.freeze({ input_class: "text", destination: "local" });
const ARM_KEYS = new Set(["actor", "episode_id", "ttl_ms", "reason", "provenance_id"]);
const DISARM_KEYS = new Set(["actor", "reason"]);

export function createQuestSurfaceControl({ provider, grantIds } = {}) {
  if (!provider) {
    throw controlError(
      "quest_surface_control_provider_required",
      "Quest surface control requires a running provider.",
      500,
    );
  }
  const pinnedGrantIds = normalizeGrantIds(grantIds);
  return Object.freeze({
    status() {
      return publicStatus(provider, pinnedGrantIds);
    },

    armTextLocal(input = {}) {
      const request = validateArmRequest(input);
      const current = provider.episodeStatus();
      provider.validateConfiguredGrantBindings();
      provider.armEpisode({
        episodeId: request.episode_id,
        ttlMs: request.ttl_ms,
        actor: request.actor,
        provenance: request.provenance_id,
        reason: request.reason,
        mode: TEXT_LOCAL_MODE,
        capability: QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH,
        provider: QUEST_SURFACE_PROVIDER_ID,
        grant_id: pinnedGrantIds.local_attach,
      });
      return {
        changed: true,
        replaced: current.armed === true,
        status: publicStatus(provider, pinnedGrantIds),
      };
    },

    disarm(input = {}) {
      const request = validateDisarmRequest(input);
      const changed = provider.revokeEpisode(request.reason, {
        actor: request.actor,
        eventType: "quest.surface.episode_disarmed",
      });
      return {
        changed,
        status: publicStatus(provider, pinnedGrantIds),
      };
    },
  });
}

export function createDisabledQuestSurfaceControl() {
  return Object.freeze({
    status() {
      return disabledStatus();
    },
    armTextLocal() {
      throw controlError(
        "quest_surface_runtime_disabled",
        "Quest surface runtime is disabled; no episode was armed.",
        503,
      );
    },
    disarm() {
      return { changed: false, status: disabledStatus() };
    },
  });
}

function publicStatus(provider, grantIds) {
  const episode = provider.episodeStatus();
  return {
    enabled: true,
    armed: episode.armed === true,
    episode_id: episode.armed ? episode.episode_id : "",
    armed_at_ms: episode.armed ? episode.armed_at_ms : null,
    expires_at_ms: episode.armed ? episode.expires_at_ms : null,
    ttl_ms: episode.armed ? episode.ttl_ms : 0,
    session_active: provider.hasActiveSessions(),
    mode: episode.armed ? { ...TEXT_LOCAL_MODE } : null,
    capability: episode.armed ? QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH : "",
    answer_provider_id: episode.armed ? QUEST_SURFACE_PROVIDER_ID : "",
    grant_ids: { ...grantIds },
    content_included: false,
    payload_bytes_included: false,
    durable: false,
  };
}

function disabledStatus() {
  return {
    enabled: false,
    armed: false,
    episode_id: "",
    armed_at_ms: null,
    expires_at_ms: null,
    ttl_ms: 0,
    session_active: false,
    mode: null,
    capability: "",
    answer_provider_id: "",
    grant_ids: null,
    content_included: false,
    payload_bytes_included: false,
    durable: false,
  };
}

function validateArmRequest(input) {
  requireObjectWithAllowedKeys(input, ARM_KEYS, "quest_surface_arm_request_invalid");
  const actor = String(input.actor ?? "").trim();
  if (actor !== "user") {
    throw controlError(
      "quest_surface_arm_requires_user_actor",
      "Quest surface arming requires actor=user.",
      403,
    );
  }
  const episodeId = boundedToken(
    input.episode_id,
    "quest_surface_episode_id_required",
    "Quest surface arming requires an explicit episode_id.",
  );
  const reason = boundedText(
    input.reason,
    512,
    "quest_surface_arm_reason_required",
    "Quest surface arming requires an explicit participant-facing reason.",
  );
  const provenanceId = boundedToken(
    input.provenance_id,
    "quest_surface_arm_provenance_required",
    "Quest surface arming requires an explicit provenance_id.",
  );
  const ttlMs = input.ttl_ms;
  if (!Number.isSafeInteger(ttlMs)
      || ttlMs < QUEST_SURFACE_MIN_EPISODE_TTL_MS
      || ttlMs > QUEST_SURFACE_MAX_EPISODE_TTL_MS) {
    throw controlError(
      "quest_surface_episode_ttl_invalid",
      "Quest surface episode ttl_ms must be an integer between 1000 and 86400000.",
      400,
    );
  }
  return {
    actor,
    episode_id: episodeId,
    ttl_ms: ttlMs,
    reason,
    provenance_id: provenanceId,
  };
}

function validateDisarmRequest(input) {
  requireObjectWithAllowedKeys(input, DISARM_KEYS, "quest_surface_disarm_request_invalid");
  const actor = String(input.actor ?? "operator").trim() || "operator";
  if (actor.length > 128) {
    throw controlError(
      "quest_surface_disarm_request_invalid",
      "Quest surface disarm actor is too long.",
      400,
    );
  }
  const reason = input.reason === undefined
    ? "operator_disarmed"
    : boundedToken(
        input.reason,
        "quest_surface_disarm_request_invalid",
        "Quest surface disarm reason must be a bounded reason code.",
      );
  return { actor, reason };
}

function normalizeGrantIds(grantIds) {
  const expected = ["panel", "mic_capture", "audio_present", "local_attach"];
  if (!grantIds || typeof grantIds !== "object" || Array.isArray(grantIds)) {
    throw controlError(
      "quest_surface_grant_tuple_required",
      "Quest surface control requires four exact grant ids.",
      500,
    );
  }
  const normalized = Object.fromEntries(expected.map((key) => [
    key,
    boundedToken(
      grantIds[key],
      "quest_surface_grant_tuple_required",
      `Quest surface control requires grantIds.${key}.`,
    ),
  ]));
  if (new Set(Object.values(normalized)).size !== expected.length) {
    throw controlError(
      "quest_surface_grant_tuple_duplicate",
      "Quest surface control requires four distinct grant ids.",
      500,
    );
  }
  return Object.freeze(normalized);
}

function requireObjectWithAllowedKeys(input, allowedKeys, code) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw controlError(code, "Quest surface control request must be an object.", 400);
  }
  const unknown = Object.keys(input).filter((key) => !allowedKeys.has(key));
  if (unknown.length > 0) {
    throw controlError(
      code,
      `Quest surface control request includes unsupported fields: ${unknown.join(", ")}.`,
      400,
    );
  }
}

function boundedToken(value, code, message) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 128 || !/^[A-Za-z0-9._:/-]+$/.test(text)) {
    throw controlError(code, message, 400);
  }
  return text;
}

function boundedText(value, maxLength, code, message) {
  const text = String(value ?? "").trim();
  if (!text || text.length > maxLength) {
    throw controlError(code, message, 400);
  }
  return text;
}

function controlError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

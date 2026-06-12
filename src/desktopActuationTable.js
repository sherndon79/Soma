import { randomBytes } from "node:crypto";

const DEFAULT_TTL_MS = 120_000;
const DEFAULT_MAX_HANDLES_PER_GENERATION = 64;
const DEFAULT_MAX_GENERATIONS_PER_EPISODE = 32;
const DEFAULT_MAX_TEXT_CHARS_PER_INVOCATION = 500;
const DEFAULT_MAX_TEXT_CHARS_PER_EPISODE = 5000;
const DEFAULT_MAX_OPS_PER_MINUTE = 12;
const EXTERNAL_INVALID_CODE = "desktop_act_ref_invalid";

export function createDesktopActuationTable({
  now = () => Date.now(),
  random = () => randomBytes(16).toString("hex"),
  ttlMs = DEFAULT_TTL_MS,
  maxHandlesPerGeneration = DEFAULT_MAX_HANDLES_PER_GENERATION,
  maxGenerationsPerEpisode = DEFAULT_MAX_GENERATIONS_PER_EPISODE,
  maxTextCharsPerInvocation = DEFAULT_MAX_TEXT_CHARS_PER_INVOCATION,
  maxTextCharsPerEpisode = DEFAULT_MAX_TEXT_CHARS_PER_EPISODE,
  maxOpsPerMinute = DEFAULT_MAX_OPS_PER_MINUTE,
} = {}) {
  const entries = new Map();
  const generationCounters = new Map();
  const generationsByKey = new Map();
  const generationsByEpisode = new Map();
  const currentGenerationByBinding = new Map();
  const generationHandleCounts = new Map();
  const usageByEpisode = new Map();

  function startGeneration(binding = {}) {
    const episodeId = requiredString(binding.episode_id ?? binding.episodeId, "episode_id");
    const current = generationCounters.get(episodeId) ?? 0;
    const generationId = current + 1;
    generationCounters.set(episodeId, generationId);
    const key = generationKey(episodeId, generationId);
    const generation = {
      episode_id: episodeId,
      generation_id: generationId,
      grant_id: requiredString(binding.grant_id ?? binding.grantId, "grant_id"),
      provider_id: requiredString(binding.provider_id ?? binding.providerId, "provider_id"),
      domain: requiredString(binding.domain, "domain"),
      family: requiredString(binding.family, "family"),
      created_at_ms: now(),
    };
    generationsByKey.set(key, generation);
    currentGenerationByBinding.set(bindingKey(generation), generationId);
    const list = generationsByEpisode.get(episodeId) ?? [];
    list.push(key);
    generationsByEpisode.set(episodeId, list);
    while (list.length > maxGenerationsPerEpisode) {
      clearGenerationKey(list.shift());
    }
    return generation;
  }

  function mint({ generation, role = "", window_index = null, op_class = "", act_kind = "", locator = {} } = {}) {
    if (!generation || !Number.isInteger(generation.generation_id)) {
      throw new TypeError("generation is required");
    }
    const key = generationKey(generation.episode_id, generation.generation_id);
    const count = generationHandleCounts.get(key) ?? 0;
    if (count >= maxHandlesPerGeneration) {
      return null;
    }
    const actRef = random();
    entries.set(actRef, {
      act_ref: actRef,
      episode_id: generation.episode_id,
      grant_id: generation.grant_id,
      provider_id: generation.provider_id,
      domain: generation.domain,
      generation_id: generation.generation_id,
      family: generation.family,
      role: String(role ?? ""),
      window_index: Number.isInteger(window_index) ? window_index : null,
      op_class: requiredString(op_class, "op_class"),
      act_kind: requiredString(act_kind, "act_kind"),
      locator,
      created_at_ms: now(),
    });
    generationHandleCounts.set(key, count + 1);
    return actRef;
  }

  function resolve({ act_ref = "", episode_id = "", grant_id = "", provider_id = "", domain = "", family = "", op_class = "" } = {}) {
    const actRef = String(act_ref ?? "").trim();
    const entry = entries.get(actRef);
    if (!entry) {
      return invalid("unknown_ref");
    }
    if (now() - entry.created_at_ms > ttlMs) {
      entries.delete(actRef);
      return invalid("expired_ref");
    }
    const mismatch = [
      ["episode_mismatch", entry.episode_id, episode_id],
      ["grant_mismatch", entry.grant_id, grant_id],
      ["provider_mismatch", entry.provider_id, provider_id],
      ["domain_mismatch", entry.domain, domain],
      ["family_mismatch", entry.family, family],
      ["op_class_mismatch", entry.op_class, op_class],
    ].find(([, actual, expected]) => String(actual ?? "") !== String(expected ?? ""));
    if (mismatch) {
      return invalid(mismatch[0]);
    }
    if (currentGenerationByBinding.get(bindingKey(entry)) !== entry.generation_id) {
      return invalid("stale_generation");
    }
    return { allowed: true, entry, code: "desktop_act_ref_valid", external_code: "" };
  }

  function resolveOpaque({ act_ref = "", episode_id = "", provider_id = "", domain = "", family = "", op_class = "" } = {}) {
    const actRef = String(act_ref ?? "").trim();
    const entry = entries.get(actRef);
    if (!entry) {
      return invalid("unknown_ref");
    }
    if (now() - entry.created_at_ms > ttlMs) {
      entries.delete(actRef);
      return invalid("expired_ref");
    }
    const mismatch = [
      ["episode_mismatch", entry.episode_id, episode_id],
      ["provider_mismatch", entry.provider_id, provider_id],
      ["domain_mismatch", entry.domain, domain],
      ["family_mismatch", entry.family, family],
      ["op_class_mismatch", entry.op_class, op_class],
    ].find(([, actual, expected]) => String(actual ?? "") !== String(expected ?? ""));
    if (mismatch) {
      return invalid(mismatch[0]);
    }
    if (currentGenerationByBinding.get(bindingKey(entry)) !== entry.generation_id) {
      return invalid("stale_generation");
    }
    return { allowed: true, entry, code: "desktop_act_ref_valid", external_code: "" };
  }

  function recordOperation({ episode_id = "", op_class = "", text = "" } = {}) {
    const episodeId = requiredString(episode_id, "episode_id");
    const timestamp = now();
    const usage = usageByEpisode.get(episodeId) ?? { ops: [], text_chars: 0 };
    usage.ops = usage.ops.filter((entry) => timestamp - entry < 60_000);
    if (usage.ops.length >= maxOpsPerMinute) {
      usageByEpisode.set(episodeId, usage);
      return { allowed: false, code: "rate_limited" };
    }
    const textLength = String(text ?? "").length;
    if (String(op_class ?? "") === "text_input") {
      if (textLength > maxTextCharsPerInvocation) {
        return { allowed: false, code: "bounds_exceeded" };
      }
      if (usage.text_chars + textLength > maxTextCharsPerEpisode) {
        return { allowed: false, code: "bounds_exceeded" };
      }
      usage.text_chars += textLength;
    }
    usage.ops.push(timestamp);
    usageByEpisode.set(episodeId, usage);
    return { allowed: true, code: "bounds_ok" };
  }

  function clearEpisode(episodeId) {
    const id = String(episodeId ?? "").trim();
    for (const [actRef, entry] of entries) {
      if (entry.episode_id === id) {
        entries.delete(actRef);
      }
    }
    for (const key of generationsByEpisode.get(id) ?? []) {
      generationHandleCounts.delete(key);
      generationsByKey.delete(key);
    }
    generationsByEpisode.delete(id);
    usageByEpisode.delete(id);
    for (const key of currentGenerationByBinding.keys()) {
      if (key.startsWith(`${id}\u0000`)) {
        currentGenerationByBinding.delete(key);
      }
    }
  }

  function clearGrant(grantId) {
    const id = String(grantId ?? "").trim();
    const bindingKeysToDelete = new Set();
    for (const [actRef, entry] of entries) {
      if (entry.grant_id === id) {
        entries.delete(actRef);
      }
    }
    for (const [key, generation] of generationsByKey) {
      if (generation.grant_id === id) {
        bindingKeysToDelete.add(bindingKey(generation));
        generationHandleCounts.delete(key);
        generationsByKey.delete(key);
      }
    }
    for (const key of bindingKeysToDelete) {
      currentGenerationByBinding.delete(key);
    }
  }

  function clearGeneration(generation) {
    clearGenerationKey(generationKey(generation.episode_id, generation.generation_id));
  }

  function clearGenerationKey(key) {
    const generation = generationsByKey.get(key);
    for (const [actRef, entry] of entries) {
      if (generationKey(entry.episode_id, entry.generation_id) === key) {
        entries.delete(actRef);
      }
    }
    generationHandleCounts.delete(key);
    generationsByKey.delete(key);
    if (generation && currentGenerationByBinding.get(bindingKey(generation)) === generation.generation_id) {
      currentGenerationByBinding.delete(bindingKey(generation));
    }
  }

  return {
    startGeneration,
    mint,
    resolve,
    resolveOpaque,
    recordOperation,
    clearEpisode,
    clearGrant,
    clearGeneration,
  };
}

export function desktopActRefInvalidCode() {
  return EXTERNAL_INVALID_CODE;
}

function invalid(category) {
  return {
    allowed: false,
    code: category,
    external_code: EXTERNAL_INVALID_CODE,
    entry: null,
  };
}

function generationKey(episodeId, generationId) {
  return `${episodeId}:${generationId}`;
}

function bindingKey(entry) {
  return [
    entry.episode_id,
    entry.grant_id,
    entry.provider_id,
    entry.domain,
    entry.family,
  ].map((part) => String(part ?? "")).join("\u0000");
}

function requiredString(value, field) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new TypeError(`${field} is required`);
  }
  return text;
}

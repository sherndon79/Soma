import { readFile } from "node:fs/promises";

const DEFAULT_MODULES_PATH = new URL("../config/harness-modules.json", import.meta.url);

export async function loadHarnessModules(path = DEFAULT_MODULES_PATH) {
  const raw = await readFile(path, "utf8");
  return normalizeModuleRegistry(JSON.parse(raw));
}

export function normalizeModuleRegistry(config) {
  return {
    schema_version: config.schema_version ?? 1,
    modules: Array.isArray(config.modules) ? config.modules : [],
  };
}

export function listVisibleModules(registry) {
  return registry.modules.filter((module) => module.approval_state === "approved").map(publicModule);
}

export function findModule(registry, moduleId) {
  return registry.modules.find((module) => module.id === moduleId) ?? null;
}

export function adoptSelfApplyModule(registry, activeModules, moduleId) {
  const module = findModule(registry, moduleId);
  if (!module || module.approval_state !== "approved") {
    const error = new Error(`Harness module ${moduleId} is not available.`);
    error.statusCode = 404;
    error.code = "harness_module_not_available";
    throw error;
  }

  const adoption = module.adoption ?? {};
  if (
    adoption.impact_scope !== "self" ||
    adoption.capability_effect !== "narrowing" ||
    adoption.adoption_policy !== "self_apply"
  ) {
    const error = new Error(`Harness module ${moduleId} cannot be self-applied.`);
    error.statusCode = 403;
    error.code = "harness_module_not_self_apply";
    throw error;
  }

  if (activeModules.some((active) => active.id === module.id)) {
    return activeModules;
  }

  return [
    ...activeModules,
    {
      ...publicModule(module),
      adopted_at: new Date().toISOString(),
    },
  ];
}

export function dropModule(activeModules, moduleId) {
  return activeModules.filter((module) => module.id !== moduleId);
}

export function applyActiveModules(harness, activeModules) {
  const disabled = new Set(
    activeModules.flatMap((module) => module.overlay?.disabled_capabilities ?? []),
  );

  return {
    ...harness,
    capabilities: (harness.capabilities ?? []).map((capability) => {
      if (!disabled.has(capability.key)) {
        return capability;
      }
      return {
        ...capability,
        status: "module_disabled",
        disabled_by_module: true,
      };
    }),
    active_modules: activeModules,
  };
}

export function publicModule(module) {
  return {
    id: module.id,
    name: module.name,
    version: module.version ?? "",
    summary: module.summary ?? "",
    approval_state: module.approval_state,
    promotion_state: module.promotion_state ?? "",
    adoption: module.adoption ?? {},
    overlay: module.overlay ?? {},
  };
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export function runtimeWritePostureFromEnv(env = process.env) {
  return resolveRuntimeWritePosture({
    requested: TRUE_VALUES.has(String(env.SOMA_RUNTIME_WRITES_ENABLED ?? "").trim().toLowerCase()),
    source: env.SOMA_RUNTIME_WRITES_ENABLED === undefined
      ? "default"
      : "SOMA_RUNTIME_WRITES_ENABLED",
  });
}

export function resolveRuntimeWritePosture({ requested = false, source = "default" } = {}) {
  const requestedBoolean = Boolean(requested);
  if (requestedBoolean) {
    return {
      runtime_writes_enabled: true,
      durable_grant_mutation_enabled: true,
      durable_memory_write_enabled: true,
      durable_testimony_write_enabled: true,
      activation_supported: true,
      requested: true,
      source: String(source || "default"),
      status: "enabled",
      reason: "Runtime writes are explicitly enabled for durable authority and memory mutation.",
    };
  }
  return {
    runtime_writes_enabled: false,
    durable_grant_mutation_enabled: false,
    durable_memory_write_enabled: false,
    durable_testimony_write_enabled: false,
    activation_supported: false,
    requested: false,
    source: String(source || "default"),
    status: "disabled",
    reason: "Runtime writes are disabled by default.",
  };
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export function runtimeWritePostureFromEnv(env = process.env) {
  return resolveRuntimeWritePosture({
    requested: TRUE_VALUES.has(String(env.SOMA_RUNTIME_WRITES_ENABLED ?? "").trim().toLowerCase()),
    source: env.SOMA_RUNTIME_WRITES_ENABLED === undefined
      ? "default"
      : "SOMA_RUNTIME_WRITES_ENABLED",
  });
}

export function resolveRuntimeWritePosture({
  requested = false,
  source = "default",
  durable_grant_mutation_enabled,
  durable_memory_write_enabled,
  occupant_memory_write_enabled,
  durable_testimony_write_enabled,
  history_projection_write_enabled,
} = {}) {
  const requestedBoolean = Boolean(requested);
  const explicitFlags = [
    durable_grant_mutation_enabled,
    durable_memory_write_enabled,
    occupant_memory_write_enabled,
    durable_testimony_write_enabled,
    history_projection_write_enabled,
  ].some((value) => value !== undefined);
  const durableGrantMutation = explicitFlags ? durable_grant_mutation_enabled === true : requestedBoolean;
  const durableMemoryWrite = explicitFlags ? durable_memory_write_enabled === true : requestedBoolean;
  const occupantMemoryWrite = explicitFlags ? occupant_memory_write_enabled === true : requestedBoolean;
  const durableTestimonyWrite = explicitFlags ? durable_testimony_write_enabled === true : requestedBoolean;
  const historyProjectionWrite = explicitFlags ? history_projection_write_enabled === true : requestedBoolean;
  const runtimeWritesEnabled = durableGrantMutation ||
    durableMemoryWrite ||
    occupantMemoryWrite ||
    durableTestimonyWrite ||
    historyProjectionWrite;
  if (runtimeWritesEnabled) {
    const broadEnable = durableGrantMutation &&
      durableMemoryWrite &&
      occupantMemoryWrite &&
      durableTestimonyWrite &&
      historyProjectionWrite;
    return {
      runtime_writes_enabled: true,
      durable_grant_mutation_enabled: durableGrantMutation,
      durable_memory_write_enabled: durableMemoryWrite,
      occupant_memory_write_enabled: occupantMemoryWrite,
      durable_testimony_write_enabled: durableTestimonyWrite,
      history_projection_write_enabled: historyProjectionWrite,
      activation_supported: true,
      requested: true,
      source: String(source || "default"),
      status: broadEnable ? "enabled" : "partial",
      reason: broadEnable
        ? "Runtime writes are explicitly enabled for durable authority and memory mutation."
        : "Runtime writes are partially enabled for selected write surfaces.",
    };
  }
  return {
    runtime_writes_enabled: false,
    durable_grant_mutation_enabled: false,
    durable_memory_write_enabled: false,
    occupant_memory_write_enabled: false,
    durable_testimony_write_enabled: false,
    history_projection_write_enabled: false,
    activation_supported: false,
    requested: false,
    source: String(source || "default"),
    status: "disabled",
    reason: "Runtime writes are disabled by default.",
  };
}

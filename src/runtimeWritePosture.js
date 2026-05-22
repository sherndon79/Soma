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
  return {
    runtime_writes_enabled: false,
    durable_grant_mutation_enabled: false,
    activation_supported: false,
    requested: requestedBoolean,
    source: String(source || "default"),
    status: requestedBoolean ? "requested_but_disabled" : "disabled",
    reason: requestedBoolean
      ? "Runtime writes were requested, but durable grant mutation activation is not implemented."
      : "Runtime writes are disabled by default.",
  };
}

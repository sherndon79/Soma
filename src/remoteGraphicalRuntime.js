import { RemoteGraphicalBroker } from "./remoteGraphicalBroker.js";

const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

export function isRemoteGraphicalRuntimeRequested(env = process.env) {
  return ENABLED_VALUES.has(String(env.SOMA_REMOTE_GRAPHICAL_ENABLED ?? "").trim().toLowerCase());
}

export function resolveRemoteGraphicalRuntimePosture(env = process.env) {
  const requested = isRemoteGraphicalRuntimeRequested(env);
  return {
    requested,
    enabled: false,
    configured: false,
  };
}

export async function createRemoteGraphicalRuntime({
  env = process.env,
  brokerFactory = defaultBrokerFactory,
} = {}) {
  const posture = resolveRemoteGraphicalRuntimePosture(env);
  return {
    ...posture,
    broker: brokerFactory({ posture }),
    async stop() {},
  };
}

function defaultBrokerFactory({ posture }) {
  return new RemoteGraphicalBroker({ runtimePosture: posture });
}

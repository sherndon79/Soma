import { RemoteGraphicalBroker } from "./remoteGraphicalBroker.js";
import { loadRemoteGraphicalRuntimeManifest } from "./remoteGraphicalRuntimeManifestLoader.js";

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
  manifestLoader = loadRemoteGraphicalRuntimeManifest,
  brokerFactory = defaultBrokerFactory,
} = {}) {
  const posture = postureFromManifestResult({
    base: resolveRemoteGraphicalRuntimePosture(env),
    manifestResult: await manifestLoader({ env }),
  });
  return {
    ...posture,
    broker: brokerFactory({ posture }),
    async stop() {},
  };
}

function defaultBrokerFactory({ posture }) {
  return new RemoteGraphicalBroker({ runtimePosture: posture });
}

function postureFromManifestResult({ base, manifestResult }) {
  if (!manifestResult?.configured) {
    return {
      ...base,
      provider: manifestResult?.provider ?? "",
      target_host: manifestResult?.target_host ?? "",
      locality: manifestResult?.locality ?? "",
      attended: manifestResult?.attended ?? null,
      manifest_loaded: false,
      manifest_status: manifestResult?.status ?? "",
      manifest_source_kind: manifestResult?.manifest_source_kind ?? "",
      manifest_source: manifestResult?.manifest_source ?? "",
      summary: manifestResult?.summary ?? "",
    };
  }

  return {
    requested: true,
    enabled: false,
    configured: true,
    provider: manifestResult.provider,
    target_host: manifestResult.target_host,
    locality: manifestResult.locality,
    attended: manifestResult.attended,
    manifest_loaded: true,
    manifest_status: manifestResult.status,
    manifest_source_kind: manifestResult.manifest_source_kind,
    manifest_source: manifestResult.manifest_source,
    summary: manifestResult.summary,
  };
}

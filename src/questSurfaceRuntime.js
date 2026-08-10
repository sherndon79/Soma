import { readFile } from "node:fs/promises";

import { createQuestSurfaceFixtureProvider } from "./questSurfaceFixtureProvider.js";
import { createRealAnswerStages } from "./questSurfaceRealAnswerProvider.js";

const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

export function isQuestSurfaceRuntimeEnabled(env = process.env) {
  return ENABLED_VALUES.has(String(env.SOMA_QUEST_SURFACE_ENABLED ?? "").trim().toLowerCase());
}

export function isQuestSurfaceRealAnswerEnabled(env = process.env) {
  return ENABLED_VALUES.has(String(env.SOMA_QUEST_SURFACE_REAL_ANSWER ?? "").trim().toLowerCase());
}

export async function createQuestSurfaceRuntime({
  env = process.env,
  grantStore = { schema_version: 1, grants: [] },
  grantRecoveryReport = null,
  capabilityCatalog = null,
  providerRegistry = null,
  providerFactory = createQuestSurfaceFixtureProvider,
  readFileImpl = readFile,
  logger = console,
  eventSink = () => {},
} = {}) {
  if (!isQuestSurfaceRuntimeEnabled(env)) {
    return disabledRuntime();
  }

  const config = resolveRuntimeConfig(env);
  let tlsOptions;
  try {
    const [key, cert, ca] = await Promise.all([
      readFileImpl(config.key_path),
      readFileImpl(config.cert_path),
      readFileImpl(config.client_ca_path),
    ]);
    tlsOptions = { key, cert, ca };
  } catch (cause) {
    throw runtimeError(
      "quest_surface_tls_read_failed",
      "Quest surface runtime could not read its external TLS identity files.",
      cause,
    );
  }

  const providerOptions = {
    tlsOptions,
    grantStore,
    grantRecoveryReport,
    capabilityCatalog,
    providerRegistry,
    grantId: config.grant_id,
    leaseTtlMs: config.lease_ttl_ms,
    panel: {
      surface_id: "panel.main",
      revision: "1",
      ttl_ms: Math.min(30_000, config.lease_ttl_ms),
      text: config.panel_text,
      pose: {
        position: { x: 0, y: 0, z: -1.5 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
      bounds: { width_m: 0.9, height_m: 0.5 },
    },
    logger,
    eventSink,
  };
  if (isQuestSurfaceRealAnswerEnabled(env)) {
    providerOptions.answerStages = createRealAnswerStages({ env });
  }
  const provider = providerFactory(providerOptions);

  let address;
  try {
    address = await provider.start({ host: config.host, port: config.port });
  } catch (cause) {
    await provider.stop().catch(() => {});
    throw runtimeError(
      "quest_surface_runtime_start_failed",
      "Quest surface runtime opt-in failed before accepting a device session.",
      cause,
    );
  }

  logger.info?.(
    `Quest surface fixture enabled on ${formatAddress(address)}; provider registration grants no authority.`,
  );
  return {
    enabled: true,
    provider,
    address,
    host: config.host,
    port: typeof address === "object" && address ? address.port : config.port,
    grant_id: config.grant_id,
    tls_paths: {
      key: config.key_path,
      cert: config.cert_path,
      client_ca: config.client_ca_path,
    },
    async stop() {
      await provider.stop();
    },
  };
}

function resolveRuntimeConfig(env) {
  const keyPath = requiredEnv(env, "SOMA_QUEST_SURFACE_TLS_KEY");
  const certPath = requiredEnv(env, "SOMA_QUEST_SURFACE_TLS_CERT");
  const clientCaPath = requiredEnv(env, "SOMA_QUEST_SURFACE_CLIENT_CA");
  const grantId = requiredEnv(env, "SOMA_QUEST_SURFACE_GRANT_ID");
  const host = String(env.SOMA_QUEST_SURFACE_HOST ?? "127.0.0.1").trim() || "127.0.0.1";
  const port = parseInteger(env.SOMA_QUEST_SURFACE_PORT ?? "8793", 0, 65_535, "port");
  const leaseTtlMs = parseInteger(
    env.SOMA_QUEST_SURFACE_LEASE_TTL_MS ?? "60000",
    1,
    300_000,
    "lease TTL",
  );
  const panelText = String(env.SOMA_QUEST_SURFACE_PANEL_TEXT ?? "SOMA QUEST PANEL SESSION");
  if (Buffer.byteLength(panelText, "utf8") < 1 || Buffer.byteLength(panelText, "utf8") > 2_048) {
    throw runtimeError(
      "quest_surface_panel_text_invalid",
      "Quest surface fixture panel text must be between 1 and 2048 UTF-8 bytes.",
    );
  }
  return {
    key_path: keyPath,
    cert_path: certPath,
    client_ca_path: clientCaPath,
    grant_id: grantId,
    host,
    port,
    lease_ttl_ms: leaseTtlMs,
    panel_text: panelText,
  };
}

function disabledRuntime() {
  return {
    enabled: false,
    provider: null,
    address: null,
    host: "",
    port: 0,
    grant_id: "",
    tls_paths: { key: "", cert: "", client_ca: "" },
    async stop() {},
  };
}

function requiredEnv(env, name) {
  const value = String(env[name] ?? "").trim();
  if (!value) {
    throw runtimeError(
      "quest_surface_configuration_incomplete",
      `Quest surface runtime requires ${name}.`,
    );
  }
  return value;
}

function parseInteger(value, min, max, label) {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value))) {
    throw runtimeError("quest_surface_configuration_invalid", `Quest surface ${label} is invalid.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw runtimeError("quest_surface_configuration_invalid", `Quest surface ${label} is invalid.`);
  }
  return parsed;
}

function formatAddress(address) {
  if (!address || typeof address !== "object") {
    return "configured address";
  }
  return `${address.address}:${address.port}`;
}

function runtimeError(code, message, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

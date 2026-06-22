import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import { createInterface } from "node:readline";

import {
  HOST_SERVICE_OPERATIONAL_PROVIDER_ID,
  HOST_SERVICE_REFUSAL_CODES,
  hostServiceError,
} from "./hostServiceContracts.js";

const METHODS = new Set(["status_read", "restart_inspect", "restart_apply"]);
const RESULT_KEYS = new Set([
  "load_state",
  "active_state",
  "sub_state",
  "unit_file_state_class",
  "can_restart",
  "restart_policy_class",
  "state_changed_at_bucket",
  "healthy",
  "unit_definition_digest",
  "definition_digest_schema",
  "affected_closure",
  "closure_schema",
  "invocation_id",
  "activation_timestamp_monotonic",
  "dispatch_status",
]);

export function createSystemdProviderSocketClient({
  socketPath = "/run/soma/systemd-provider.sock",
  enabled = false,
  connectFn = createConnection,
} = {}) {
  let socket = null;
  let lines = null;
  let counter = 0;

  return Object.freeze({
    provider_id: HOST_SERVICE_OPERATIONAL_PROVIDER_ID,
    activation_status: enabled ? "exact_host" : "disabled",
    async request({ method, inventory_id } = {}) {
      if (!enabled) {
        throw hostServiceError(
          "service_status_unavailable",
          "Operational systemd provider socket is disabled.",
          403,
        );
      }
      if (!METHODS.has(method) || !validInventoryId(inventory_id)) {
        throw hostServiceError("service_status_output_invalid", "Systemd provider request is invalid.", 400);
      }
      if (!socket) {
        socket = connectFn({ path: socketPath });
        await waitForConnect(socket);
        lines = createInterface({ input: socket, crlfDelay: Infinity })[Symbol.asyncIterator]();
      }
      const requestId = `systemd-socket-${++counter}`;
      socket.write(`${JSON.stringify({ request_id: requestId, method, inventory_id })}\n`);
      const next = await lines.next();
      if (next.done) {
        throw hostServiceError("service_status_unavailable", "Systemd provider socket closed.", 503);
      }
      let response;
      try {
        response = JSON.parse(next.value);
      } catch {
        throw hostServiceError("service_status_output_invalid", "Systemd provider response is not JSON.", 502);
      }
      return validateProviderResponse(response, requestId);
    },
    stop() {
      socket?.destroy();
      socket = null;
      lines = null;
    },
  });
}

export function createSystemdProviderSocketAdapter({
  socketPath = "/run/soma/systemd-provider.sock",
  enabled = false,
  connectFn = createConnection,
} = {}) {
  const client = createSystemdProviderSocketClient({ socketPath, enabled, connectFn });
  let restartCalls = 0;

  return Object.freeze({
    provider_id: HOST_SERVICE_OPERATIONAL_PROVIDER_ID,
    provider_mode: "real_systemd_attended_host",
    async readStatusRaw(descriptor = {}) {
      return client.request({
        method: "status_read",
        inventory_id: descriptor.unit_inventory_id,
      });
    },
    async inspectForPlan(descriptor = {}) {
      const result = await client.request({
        method: "restart_inspect",
        inventory_id: descriptor.unit_inventory_id,
      });
      return observationFromResult(result, descriptor);
    },
    async restart(descriptor = {}) {
      restartCalls += 1;
      return client.request({
        method: "restart_apply",
        inventory_id: descriptor.unit_inventory_id,
      });
    },
    restartCallCount() {
      return restartCalls;
    },
    stop() {
      client.stop();
    },
  });
}

export function createSystemdProviderProcess({
  binary = "./target/debug/soma-systemd-provider",
  inventoryPath = "./config/systemd-provider-inventory.json",
  enabled = false,
  spawnFn = spawn,
} = {}) {
  let child = null;
  let lines = null;
  let counter = 0;

  return Object.freeze({
    provider_id: HOST_SERVICE_OPERATIONAL_PROVIDER_ID,
    activation_status: enabled ? "controlled_testing" : "disabled",
    async request({ method, inventory_id } = {}) {
      if (!enabled) {
        throw hostServiceError(
          "service_status_unavailable",
          "Operational systemd provider process is disabled.",
          403,
        );
      }
      if (!METHODS.has(method) || !validInventoryId(inventory_id)) {
        throw hostServiceError("service_status_output_invalid", "Systemd provider request is invalid.", 400);
      }
      if (!child) {
        child = spawnFn(binary, [], {
          stdio: ["pipe", "pipe", "ignore"],
          env: {
            PATH: process.env.PATH ?? "",
            SOMA_SYSTEMD_PROVIDER_INVENTORY: inventoryPath,
          },
        });
        lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]();
      }
      const requestId = `systemd-${++counter}`;
      child.stdin.write(`${JSON.stringify({
        request_id: requestId,
        method,
        inventory_id,
      })}\n`);
      const next = await lines.next();
      if (next.done) {
        throw hostServiceError("service_status_unavailable", "Systemd provider process exited.", 503);
      }
      return validateProviderResponse(JSON.parse(next.value), requestId);
    },
    stop() {
      if (child) {
        child.kill("SIGTERM");
        child = null;
        lines = null;
      }
    },
  });
}

export function createSystemdProviderAdapter({
  command = "./target/debug/soma-systemd-provider",
  args = [],
  inventoryPath = "./config/systemd-provider-inventory.json",
  enabled = false,
  spawnSyncFn = spawnSync,
} = {}) {
  let requestCounter = 0;
  let restartCalls = 0;

  function request(method, inventoryId) {
    if (!enabled) {
      throw hostServiceError(
        "service_status_unavailable",
        "Operational systemd provider adapter is disabled.",
        403,
      );
    }
    const requestId = `systemd-sync-${++requestCounter}`;
    const child = spawnSyncFn(command, args, {
      input: `${JSON.stringify({
        request_id: requestId,
        method,
        inventory_id: inventoryId,
      })}\n`,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        SOMA_SYSTEMD_PROVIDER_INVENTORY: inventoryPath,
      },
      maxBuffer: 256 * 1024,
    });
    if (child.error || child.status !== 0) {
      throw hostServiceError("service_status_unavailable", "Systemd provider adapter failed.", 503);
    }
    const line = String(child.stdout ?? "").trim().split("\n").at(-1) ?? "";
    let response;
    try {
      response = JSON.parse(line);
    } catch {
      throw hostServiceError("service_status_output_invalid", "Systemd provider response is not JSON.", 502);
    }
    return validateProviderResponse(response, requestId);
  }

  return Object.freeze({
    provider_id: HOST_SERVICE_OPERATIONAL_PROVIDER_ID,
    provider_mode: "real_systemd_controlled_test",
    readStatusRaw(descriptor = {}) {
      return request("status_read", descriptor.unit_inventory_id);
    },
    inspectForPlan(descriptor = {}) {
      const result = request("restart_inspect", descriptor.unit_inventory_id);
      return observationFromResult(result, descriptor);
    },
    restart(descriptor = {}) {
      restartCalls += 1;
      return request("restart_apply", descriptor.unit_inventory_id);
    },
    restartCallCount() {
      return restartCalls;
    },
  });
}

export function validateProviderResponse(response, requestId) {
  if (!isPlainObject(response) || response.request_id !== requestId || typeof response.ok !== "boolean") {
    throw hostServiceError("service_status_output_invalid", "Systemd provider response envelope is invalid.", 502);
  }
  if (!response.ok) {
    const code = HOST_SERVICE_REFUSAL_CODES.includes(response.error?.code)
      ? response.error.code
      : "service_status_unavailable";
    const error = hostServiceError(code, "Systemd provider refused the request.", 409);
    error.ambiguous = response.error?.ambiguous === true;
    throw error;
  }
  if (!isPlainObject(response.result) || Object.keys(response.result).some((key) => !RESULT_KEYS.has(key))) {
    throw hostServiceError("service_status_output_invalid", "Systemd provider result contains unsupported fields.", 502);
  }
  for (const key of RESULT_KEYS) {
    if (!Object.hasOwn(response.result, key)) {
      throw hostServiceError("service_status_output_invalid", "Systemd provider result is incomplete.", 502);
    }
  }
  return Object.freeze({ ...response.result });
}

function validInventoryId(value) {
  return typeof value === "string"
    && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function waitForConnect(socket) {
  if (socket.readyState === "open") {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function observationFromResult(result, descriptor) {
  return Object.freeze({
    ...result,
    observation_generation: digest({
      descriptor_digest: descriptor.descriptor_digest,
      invocation_id: result.invocation_id,
      activation_timestamp_monotonic: result.activation_timestamp_monotonic,
    }),
    runtime_state_digest: digest({
      load_state: result.load_state,
      active_state: result.active_state,
      sub_state: result.sub_state,
      invocation_id: result.invocation_id,
      activation_timestamp_monotonic: result.activation_timestamp_monotonic,
    }),
    target_binding_digest: digest({
      descriptor_digest: descriptor.descriptor_digest,
      inventory_id: descriptor.unit_inventory_id,
    }),
  });
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  createRemoteGraphicalLiveBrokerActiveSessions,
} from "./remoteGraphicalLiveBrokerActiveSessions.js";
import {
  createRemoteGraphicalLiveBrokerCleanupResult,
} from "./remoteGraphicalLiveBrokerCleanupResult.js";
import {
  createRemoteGraphicalLiveBrokerStatus,
} from "./remoteGraphicalLiveBrokerStatus.js";

const DEFAULT_HELPER_PATH = fileURLToPath(
  new URL("../target/debug/soma-moonlight-broker", import.meta.url),
);

const JSONRPC = "2.0";

export class RemoteGraphicalLiveBrokerManager extends EventEmitter {
  #binaryPath;
  #resultValidators;
  #child = null;
  #stdoutBuffer = "";
  #stderrBuffer = "";
  #pending = new Map();
  #nextRequestId = 1;
  #stopped = false;

  constructor({
    binaryPath = DEFAULT_HELPER_PATH,
    resultValidators = defaultResultValidators(),
  } = {}) {
    super();
    this.#binaryPath = binaryPath;
    this.#resultValidators = {
      ...defaultResultValidators(),
      ...(resultValidators ?? {}),
    };
  }

  async start() {
    if (this.#child) {
      throw new Error("RemoteGraphicalLiveBrokerManager already started");
    }
    await access(this.#binaryPath, constants.X_OK);

    this.#stopped = false;
    this.#child = spawn(this.#binaryPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.#child.stdout.setEncoding("utf8");
    this.#child.stdout.on("data", (chunk) => this.#onStdoutData(chunk));

    this.#child.stderr.setEncoding("utf8");
    this.#child.stderr.on("data", (chunk) => {
      this.#stderrBuffer += chunk;
      this.emit("stderr", chunk);
    });

    this.#child.on("error", (error) => {
      this.#rejectAllPending(new Error(`helper process error: ${error.message}`));
      this.emit("error", error);
    });

    this.#child.on("exit", (code, signal) => {
      const reason = signal
        ? `helper exited with signal ${signal}`
        : `helper exited with code ${code}`;
      this.#rejectAllPending(new Error(reason));
      this.#child = null;
      this.emit("exit", { code, signal });
    });

    return { pid: this.#child.pid };
  }

  status(params = {}) {
    return this.send("remote_graphical.status", params)
      .then((result) => this.#resultValidators.status(result));
  }

  openSession(params = {}) {
    return this.send("remote_graphical.open_session", params);
  }

  describeActive(params = {}) {
    return this.send("remote_graphical.describe_active", params)
      .then((result) => this.#resultValidators.describeActive(result));
  }

  cleanupForGrant(params = {}) {
    return this.send("remote_graphical.cleanup_for_grant", params)
      .then((result) => this.#resultValidators.cleanupForGrant(result));
  }

  send(method, params = {}) {
    if (!this.#child) {
      return Promise.reject(new Error("RemoteGraphicalLiveBrokerManager not started"));
    }
    if (this.#stopped) {
      return Promise.reject(new Error("RemoteGraphicalLiveBrokerManager is stopping"));
    }

    const id = `req-${this.#nextRequestId++}`;
    const request = JSON.stringify({ jsonrpc: JSONRPC, method, params, id });

    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, method });
      const ok = this.#child.stdin.write(`${request}\n`, "utf8", (error) => {
        if (error) {
          this.#pending.delete(id);
          reject(error);
        }
      });
      if (!ok) {
        // Requests are tiny; the callback above handles drain/error.
      }
    });
  }

  async stop() {
    if (!this.#child || this.#stopped) {
      return;
    }
    this.#stopped = true;
    this.#child.stdin.end();

    return new Promise((resolve) => {
      if (!this.#child) {
        resolve();
        return;
      }
      this.#child.once("exit", () => resolve());
    });
  }

  capturedStderr() {
    return this.#stderrBuffer;
  }

  #onStdoutData(chunk) {
    this.#stdoutBuffer += chunk;
    const lines = this.#stdoutBuffer.split("\n");
    this.#stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length === 0) {
        continue;
      }
      this.#dispatchLine(line);
    }
  }

  #dispatchLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.emit("parse_error", { line, error });
      return;
    }

    if (message.jsonrpc !== JSONRPC) {
      this.emit("protocol_error", {
        reason: "missing or wrong jsonrpc field",
        line: message,
      });
      return;
    }

    if (message.id !== undefined && message.id !== null) {
      const pending = this.#pending.get(message.id);
      if (!pending) {
        this.emit("orphan_response", message);
        return;
      }
      this.#pending.delete(message.id);
      if (message.error) {
        const error = new Error(message.error.message ?? "unspecified helper error");
        error.code = message.error.code ?? null;
        error.code_name = message.error.code_name ?? "";
        error.helper_response = message;
        pending.reject(error);
      } else {
        pending.resolve(message.result ?? null);
      }
      return;
    }

    this.emit("protocol_error", {
      reason: "response without id",
      line: message,
    });
  }

  #rejectAllPending(error) {
    for (const [, { reject }] of this.#pending) {
      reject(error);
    }
    this.#pending.clear();
  }
}

export const REMOTE_GRAPHICAL_LIVE_BROKER_DEFAULT_BINARY = DEFAULT_HELPER_PATH;

function defaultResultValidators() {
  return {
    status: createRemoteGraphicalLiveBrokerStatus,
    describeActive: createRemoteGraphicalLiveBrokerActiveSessions,
    cleanupForGrant: createRemoteGraphicalLiveBrokerCleanupResult,
  };
}

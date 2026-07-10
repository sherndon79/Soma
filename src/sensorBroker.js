// Node-side manager for the soma-sensor-broker helper.
//
// Step 9c of the disabled-first sequence. Spawns the long-lived
// helper binary (crates/soma-sensor-broker), serializes JSON-RPC
// requests and responses over its stdin/stdout pipe, surfaces
// subscription sample notifications via EventEmitter.
//
// This module is the plumbing layer between the Node service plane
// and the helper. It does NOT route any HTTP request, does NOT touch
// the grant store, does NOT record provenance. Those concerns live
// in later slices that compose this manager. The PUBLIC capability
// path stays fail-closed because no Node-side code currently
// instantiates this manager — it exists as a building block, tested
// in isolation.

import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_HELPER_PATH = fileURLToPath(
  new URL("../target/debug/soma-sensor-broker", import.meta.url),
);

const JSONRPC = "2.0";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export class SensorBrokerManager extends EventEmitter {
  #binaryPath;
  #requestTimeoutMs;
  #child = null;
  #stdoutBuffer = "";
  #stderrBuffer = "";
  #pending = new Map();
  #nextRequestId = 1;
  #stopped = false;

  constructor({ binaryPath = DEFAULT_HELPER_PATH, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {}) {
    super();
    this.#binaryPath = binaryPath;
    this.#requestTimeoutMs = Number.isInteger(requestTimeoutMs) && requestTimeoutMs > 0
      ? requestTimeoutMs
      : DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /**
   * Spawn the helper process. Throws if the binary cannot be found
   * or the child process fails to start.
   */
  async start() {
    if (this.#child) {
      throw new Error("SensorBrokerManager already started");
    }
    await access(this.#binaryPath, constants.X_OK);

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

    this.#child.on("error", (err) => {
      this.#rejectAllPending(new Error(`helper process error: ${err.message}`));
      this.emit("error", err);
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

  /**
   * Send a JSON-RPC request. Resolves with the response's `result`
   * field, or rejects with an Error carrying `code` and `code_name`
   * extracted from the response's `error` field.
   */
  send(method, params = {}) {
    if (!this.#child) {
      return Promise.reject(new Error("SensorBrokerManager not started"));
    }
    if (this.#stopped) {
      return Promise.reject(new Error("SensorBrokerManager is stopping"));
    }

    const id = `req-${this.#nextRequestId++}`;
    const request = JSON.stringify({ jsonrpc: JSONRPC, method, params, id });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.#pending.has(id)) {
          return;
        }
        this.#pending.delete(id);
        const err = new Error(`helper request timed out: ${method}`);
        err.code = "helper_request_timeout";
        err.code_name = "helper_request_timeout";
        err.method = method;
        reject(err);
      }, this.#requestTimeoutMs);
      if (typeof timeout.unref === "function") {
        timeout.unref();
      }
      this.#pending.set(id, { resolve, reject, method, timeout });
      const ok = this.#child.stdin.write(`${request}\n`, "utf8", (err) => {
        if (err) {
          const pending = this.#pending.get(id);
          if (pending?.timeout) {
            clearTimeout(pending.timeout);
          }
          this.#pending.delete(id);
          reject(err);
        }
      });
      // If write returned false the kernel buffer is full; the callback
      // above will run when drain fires or on error. We don't need to
      // pause anything because requests are tiny.
      if (!ok) {
        // No-op; deliberate. Documented for readers.
      }
    });
  }

  /**
   * Stop the helper. Closes stdin so the helper's input loop sees
   * EOF and exits cleanly, then awaits the process exit. Pending
   * requests are rejected with a meaningful error.
   */
  async stop() {
    if (!this.#child || this.#stopped) {
      return;
    }
    this.#stopped = true;
    this.#child.stdin.end();

    return new Promise((resolve) => {
      // The 'exit' handler set in start() already fires; we just
      // need to wait for it to run.
      if (!this.#child) {
        resolve();
        return;
      }
      this.#child.once("exit", () => resolve());
    });
  }

  /**
   * Returns the captured stderr buffer so far. Useful for diagnostics
   * after a helper crash.
   */
  capturedStderr() {
    return this.#stderrBuffer;
  }

  // ── internals ────────────────────────────────────────────────────────────

  #onStdoutData(chunk) {
    this.#stdoutBuffer += chunk;
    const lines = this.#stdoutBuffer.split("\n");
    // The last element is either an empty string (clean line break)
    // or a partial line; keep it for the next chunk.
    this.#stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length === 0) {
        continue;
      }
      this.#dispatchLine(line);
    }
  }

  #dispatchLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      this.emit("parse_error", { line, error: err });
      return;
    }

    if (msg.jsonrpc !== JSONRPC) {
      this.emit("protocol_error", {
        reason: "missing or wrong jsonrpc field",
        line: msg,
      });
      return;
    }

    if (typeof msg.method === "string" && msg.id === undefined) {
      // Notification (no id). Subscription samples land here.
      this.emit("notification", msg);
      return;
    }

    if (msg.id !== undefined && msg.id !== null) {
      const pending = this.#pending.get(msg.id);
      if (!pending) {
        this.emit("orphan_response", msg);
        return;
      }
      this.#pending.delete(msg.id);
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      if (msg.error) {
        const err = new Error(msg.error.message ?? "unspecified helper error");
        err.code = msg.error.code ?? null;
        err.code_name = msg.error.code_name ?? "";
        err.helper_response = msg;
        pending.reject(err);
      } else {
        pending.resolve(msg.result ?? null);
      }
      return;
    }

    this.emit("protocol_error", {
      reason: "response without id and without method",
      line: msg,
    });
  }

  #rejectAllPending(err) {
    for (const [, { reject, timeout }] of this.#pending) {
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(err);
    }
    this.#pending.clear();
  }
}

export const SENSOR_BROKER_DEFAULT_BINARY = DEFAULT_HELPER_PATH;

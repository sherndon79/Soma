import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";

import { hostServiceError } from "./hostServiceContracts.js";

export function createLocalConfirmationSocketClient({
  command = "/usr/libexec/soma/soma-local-confirmation-client",
  socketPath = "/run/soma-lca/issuer.sock",
  expectedServerUid,
  lstatFn = lstatSync,
  spawnSyncFn = spawnSync,
} = {}) {
  if (!Number.isInteger(Number(expectedServerUid)) || Number(expectedServerUid) <= 0) {
    throw new TypeError("expectedServerUid must be a positive numeric uid");
  }
  let counter = 0;

  return Object.freeze({
    confirm({ request, expected } = {}) {
      assertTrustedHelperPath(command, { lstatFn });
      const requestId = `lca-${++counter}`;
      const child = spawnSyncFn(command, [], {
        input: `${JSON.stringify({
          request_id: requestId,
          confirmation_request: request,
        })}\n`,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          SOMA_LCA_SOCKET_PATH: socketPath,
          SOMA_LCA_EXPECTED_SERVER_UID: String(expectedServerUid),
        },
        maxBuffer: 128 * 1024,
      });
      if (child.error || child.status !== 0) {
        throw hostServiceError(
          "service_restart_confirmation_required",
          "Trusted local confirmation issuer is unavailable.",
          503,
        );
      }
      let response;
      try {
        response = JSON.parse(String(child.stdout ?? "").trim());
      } catch {
        throw hostServiceError(
          "service_restart_confirmation_required",
          "Trusted local confirmation response is invalid.",
          502,
        );
      }
      if (response?.request_id !== requestId || response?.ok !== true) {
        throw hostServiceError(
          "service_restart_confirmation_required",
          "Trusted local confirmation was not granted.",
          403,
        );
      }
      validateConfirmation(response.confirmation, expected);
      return Object.freeze({ ...response.confirmation });
    },
  });
}

export function assertTrustedHelperPath(command, { lstatFn = lstatSync } = {}) {
  if (typeof command !== "string" || !isAbsolute(command)) {
    throw helperIntegrityError();
  }
  try {
    const helper = lstatFn(command);
    const parent = lstatFn(dirname(command));
    if (
      helper.isSymbolicLink()
      || !helper.isFile()
      || helper.uid !== 0
      || (helper.mode & 0o022) !== 0
      || parent.isSymbolicLink()
      || !parent.isDirectory()
      || parent.uid !== 0
      || (parent.mode & 0o022) !== 0
    ) {
      throw helperIntegrityError();
    }
  } catch (error) {
    if (error?.code === "service_restart_confirmation_required") {
      throw error;
    }
    throw helperIntegrityError();
  }
  return true;
}

export function validateConfirmation(confirmation = {}, expected = {}) {
  const allowed = new Set([
    "schema_version",
    "plan_digest",
    "target_binding_digest",
    "task_id",
    "provider_id",
    "exact_target",
    "consequence_class",
    "rollback_posture",
    "input_origin",
    "preview_acknowledged",
    "issued_at",
    "expires_at",
    "nonce",
  ]);
  if (
    !confirmation
    || typeof confirmation !== "object"
    || Array.isArray(confirmation)
    || Object.keys(confirmation).some((key) => !allowed.has(key))
  ) {
    throw confirmationError();
  }
  for (const field of [
    "plan_digest",
    "target_binding_digest",
    "task_id",
    "provider_id",
    "exact_target",
  ]) {
    if (confirmation[field] !== expected[field]) {
      throw confirmationError();
    }
  }
  if (
    confirmation.schema_version !== 1
    || confirmation.consequence_class !== "C3"
    || confirmation.rollback_posture !== "not_reversible"
    || confirmation.input_origin !== "trusted_local_hardware"
    || confirmation.preview_acknowledged !== true
    || !Number.isFinite(confirmation.issued_at)
    || !Number.isFinite(confirmation.expires_at)
    || confirmation.expires_at <= Date.now()
    || confirmation.issued_at > Date.now()
    || typeof confirmation.nonce !== "string"
    || confirmation.nonce.length < 16
  ) {
    throw confirmationError();
  }
  return true;
}

function confirmationError() {
  return hostServiceError(
    "service_restart_confirmation_mismatch",
    "Trusted local confirmation does not match the exact plan.",
    403,
  );
}

function helperIntegrityError() {
  return hostServiceError(
    "service_restart_confirmation_required",
    "Trusted local confirmation client failed its integrity check.",
    503,
  );
}

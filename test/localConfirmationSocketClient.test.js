import assert from "node:assert/strict";
import test from "node:test";

import {
  assertTrustedHelperPath,
  createLocalConfirmationSocketClient,
  validateConfirmation,
} from "../src/localConfirmationSocketClient.js";

function trustedPathStats(path) {
  return path.endsWith("soma-local-confirmation-client")
    ? {
        isDirectory: () => false,
        isFile: () => true,
        isSymbolicLink: () => false,
        mode: 0o100755,
        uid: 0,
      }
    : {
        isDirectory: () => true,
        isFile: () => false,
        isSymbolicLink: () => false,
        mode: 0o040755,
        uid: 0,
      };
}

test("native LCA client accepts only exact plan-bound confirmation", () => {
  const now = Date.now();
  const expected = {
    plan_digest: "a".repeat(64),
    target_binding_digest: "b".repeat(64),
    task_id: "task-1",
    provider_id: "soma.provider.systemd-local",
    exact_target: "soma-lab-proof.service",
  };
  const client = createLocalConfirmationSocketClient({
    expectedServerUid: 123,
    lstatFn: trustedPathStats,
    spawnSyncFn(_command, _args, options) {
      const request = JSON.parse(options.input);
      return {
        status: 0,
        stdout: JSON.stringify({
          request_id: request.request_id,
          ok: true,
          confirmation: {
            schema_version: 1,
            ...expected,
            consequence_class: "C3",
            rollback_posture: "not_reversible",
            input_origin: "trusted_local_hardware",
            preview_acknowledged: true,
            issued_at: now - 10,
            expires_at: now + 10_000,
            nonce: "nonce-1234567890",
          },
        }),
      };
    },
  });
  assert.equal(client.confirm({ request: {}, expected }).exact_target, expected.exact_target);
  assert.throws(
    () => validateConfirmation({
      schema_version: 1,
      ...expected,
      exact_target: "other.service",
      consequence_class: "C3",
      rollback_posture: "not_reversible",
      input_origin: "trusted_local_hardware",
      preview_acknowledged: true,
      issued_at: now,
      expires_at: now + 10_000,
      nonce: "nonce-1234567890",
    }, expected),
    { code: "service_restart_confirmation_mismatch" },
  );
});

test("native LCA client verifies the helper and parent before spawning", () => {
  assert.equal(
    assertTrustedHelperPath("/usr/libexec/soma/soma-local-confirmation-client", {
      lstatFn: trustedPathStats,
    }),
    true,
  );

  for (const mutate of [
    (stats) => ({ ...stats, isSymbolicLink: () => true }),
    (stats) => ({ ...stats, uid: 1000 }),
    (stats) => ({ ...stats, mode: stats.mode | 0o020 }),
  ]) {
    let calls = 0;
    assert.throws(
      () => assertTrustedHelperPath("/usr/libexec/soma/soma-local-confirmation-client", {
        lstatFn(path) {
          calls += 1;
          const stats = trustedPathStats(path);
          return calls === 1 ? mutate(stats) : stats;
        },
      }),
      { code: "service_restart_confirmation_required" },
    );
    calls = 0;
    assert.throws(
      () => assertTrustedHelperPath("/usr/libexec/soma/soma-local-confirmation-client", {
        lstatFn(path) {
          calls += 1;
          const stats = trustedPathStats(path);
          return calls === 2 ? mutate(stats) : stats;
        },
      }),
      { code: "service_restart_confirmation_required" },
    );
  }

  assert.throws(
    () => assertTrustedHelperPath("soma-local-confirmation-client", {
      lstatFn: trustedPathStats,
    }),
    { code: "service_restart_confirmation_required" },
  );
});

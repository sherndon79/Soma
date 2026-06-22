import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import {
  createEd25519LocalConfirmationVerifier,
  localConfirmationSigningPayload,
} from "../src/localConfirmationEd25519.js";

test("external Ed25519 confirmation binds exact plan fields and is single-use", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const now = Date.now();
  const plan = {
    plan_digest: "plan-digest",
    target_binding_digest: "target-digest",
    task_id: "task-1",
    provider_id: "soma.provider.systemd-local",
    exact_target: "soma-lab-proof.service",
  };
  const unsigned = {
    schema_version: 1,
    ...plan,
    input_origin: "trusted_local_hardware",
    preview_acknowledged: true,
    consequence_class: "C3",
    rollback_posture: "not_reversible",
    issued_at: now - 100,
    expires_at: now + 10_000,
    nonce: "nonce-1",
  };
  const attestation = {
    ...unsigned,
    signature: sign(null, Buffer.from(localConfirmationSigningPayload(unsigned)), privateKey)
      .toString("base64"),
  };
  const verifier = createEd25519LocalConfirmationVerifier({
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
  });
  assert.equal(verifier(attestation, plan), true);
  assert.equal(verifier(attestation, plan), false);
  assert.equal(createEd25519LocalConfirmationVerifier({
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
  })({ ...attestation, task_id: "other" }, plan), false);
});

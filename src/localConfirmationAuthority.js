import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { hostServiceError } from "./hostServiceContracts.js";

const FORBIDDEN_INPUT_ORIGINS = new Set([
  "occupant",
  "computer_use",
  "synthetic_input",
  "remote_input",
  "api",
  "stdin",
  "background",
]);

export function createLocalConfirmationAuthority({
  now = () => Date.now(),
  random = () => randomBytes(24).toString("hex"),
  ttlMs = 30_000,
  verifyTrustedAttestation = () => false,
} = {}) {
  const receipts = new Map();
  let recoveryHealthy = true;

  return Object.freeze({
    confirm({ plan, attestation } = {}) {
      if (!recoveryHealthy) {
        throw hostServiceError("service_recovery_degraded", "Confirmation recovery is degraded.", 503);
      }
      validatePlan(plan);
      validateTrustedLocalAttestation(attestation, { verifyTrustedAttestation, plan });
      const createdAt = now();
      const receipt = Object.freeze({
        receipt_id: `confirm_${random()}`,
        nonce: `nonce_${random()}`,
        plan_id: plan.plan_id,
        plan_digest: plan.plan_digest,
        target_binding_digest: plan.target_binding_digest,
        task_id: plan.task_id,
        provider_id: plan.provider_id,
        consequence_class: "C3",
        rollback_posture: "not_reversible",
        preview_acknowledged: true,
        authority_channel: "trusted_local_human_presence",
        created_at: createdAt,
        expires_at: Math.min(plan.expires_at, createdAt + ttlMs),
        consumed: false,
      });
      receipts.set(receipt.receipt_id, receipt);
      return receipt;
    },
    requireMatching({ receipt_id, plan } = {}) {
      if (!recoveryHealthy) {
        throw hostServiceError("service_recovery_degraded", "Confirmation recovery is degraded.", 503);
      }
      const receipt = receipts.get(String(receipt_id ?? ""));
      if (!receipt) {
        throw hostServiceError("service_restart_confirmation_required", "A trusted local confirmation is required.", 403);
      }
      if (receipt.consumed || receipt.expires_at <= now()) {
        throw hostServiceError("service_restart_confirmation_mismatch", "Confirmation receipt is expired or consumed.", 403);
      }
      for (const field of ["plan_id", "plan_digest", "target_binding_digest", "task_id", "provider_id"]) {
        if (receipt[field] !== plan?.[field]) {
          throw hostServiceError("service_restart_confirmation_mismatch", "Confirmation does not match the exact plan.", 403);
        }
      }
      if (receipt.consequence_class !== "C3" || receipt.rollback_posture !== "not_reversible") {
        throw hostServiceError("service_restart_confirmation_mismatch", "Confirmation disclosure binding is invalid.", 403);
      }
      return receipt;
    },
    consume(receiptId) {
      const receipt = receipts.get(String(receiptId ?? ""));
      if (!receipt || receipt.consumed) {
        throw hostServiceError("service_restart_confirmation_mismatch", "Confirmation cannot be consumed.", 403);
      }
      receipts.set(receipt.receipt_id, Object.freeze({ ...receipt, consumed: true }));
    },
    expireTask(taskId) {
      for (const [receiptId, receipt] of receipts) {
        if (receipt.task_id === taskId) {
          receipts.delete(receiptId);
        }
      }
    },
    setRecoveryHealthy(healthy) {
      recoveryHealthy = healthy === true;
      if (!recoveryHealthy) {
        receipts.clear();
      }
    },
    snapshot(receiptId) {
      return receipts.get(String(receiptId ?? "")) ?? null;
    },
  });
}

export function createTrustedLocalConfirmationAdapter({
  now = () => Date.now(),
  secret = randomBytes(32),
  ttlMs = 5_000,
} = {}) {
  const key = Buffer.from(secret);
  const usedNonces = new Set();
  return Object.freeze({
    attest({ plan, local_signal } = {}) {
      if (
        local_signal?.channel !== "trusted_local_ui"
        || local_signal?.os_peer_authenticated !== true
        || local_signal?.independent_user_presence !== true
        || local_signal?.preview_acknowledged !== true
        || local_signal?.same_user_endpoint !== true
        || local_signal?.input_origin !== "trusted_local_hardware"
      ) {
        throw hostServiceError(
          "service_restart_confirmation_required",
          "Trusted adapter requires independent local hardware presence.",
          403,
        );
      }
      const issuedAt = now();
      const payload = {
        plan_digest: String(plan?.plan_digest ?? ""),
        target_binding_digest: String(plan?.target_binding_digest ?? ""),
        input_origin: "trusted_local_hardware",
        issued_at: issuedAt,
        expires_at: issuedAt + ttlMs,
        nonce: randomBytes(16).toString("hex"),
      };
      return Object.freeze({
        ...payload,
        signature: signAttestation(payload, key),
      });
    },
    verifier(attestation = {}, plan = {}) {
      if (
        attestation.input_origin !== "trusted_local_hardware"
        || attestation.plan_digest !== plan.plan_digest
        || attestation.target_binding_digest !== plan.target_binding_digest
        || Number(attestation.expires_at) <= now()
        || Number(attestation.issued_at) > now()
        || usedNonces.has(attestation.nonce)
      ) {
        return false;
      }
      const expected = signAttestation(unsignedAttestation(attestation), key);
      const actualBuffer = Buffer.from(String(attestation.signature ?? ""), "hex");
      const expectedBuffer = Buffer.from(expected, "hex");
      if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
        return false;
      }
      usedNonces.add(attestation.nonce);
      return true;
    },
  });
}

export function validateTrustedLocalAttestation(attestation = {}, { verifyTrustedAttestation = () => false, plan = {} } = {}) {
  const origin = String(attestation.input_origin ?? "").trim();
  if (
    FORBIDDEN_INPUT_ORIGINS.has(origin)
    || origin !== "trusted_local_hardware"
    || verifyTrustedAttestation(attestation, plan) !== true
  ) {
    throw hostServiceError(
      "service_restart_confirmation_required",
      "Confirmation requires independent trusted-local human presence.",
      403,
    );
  }
  return true;
}

function unsignedAttestation(attestation) {
  return {
    plan_digest: String(attestation.plan_digest ?? ""),
    target_binding_digest: String(attestation.target_binding_digest ?? ""),
    input_origin: String(attestation.input_origin ?? ""),
    issued_at: Number(attestation.issued_at),
    expires_at: Number(attestation.expires_at),
    nonce: String(attestation.nonce ?? ""),
  };
}

function signAttestation(payload, key) {
  return createHmac("sha256", key).update(JSON.stringify(unsignedAttestation(payload))).digest("hex");
}

function validatePlan(plan) {
  if (
    !plan
    || plan.consequence_class !== "C3"
    || plan.rollback_posture !== "not_reversible"
    || plan.confirmation_required !== true
  ) {
    throw hostServiceError("service_restart_confirmation_mismatch", "Confirmation requires an exact C3 no-rollback plan.", 403);
  }
}

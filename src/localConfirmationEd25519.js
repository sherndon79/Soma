import { createPublicKey, verify } from "node:crypto";

export function createEd25519LocalConfirmationVerifier({ publicKeyPem } = {}) {
  const publicKey = createPublicKey(String(publicKeyPem ?? ""));
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new TypeError("Local confirmation public key must be Ed25519.");
  }
  const usedNonces = new Set();

  return (attestation = {}, plan = {}) => {
    const payload = canonicalAttestation(attestation);
    if (
      payload.schema_version !== 1
      || payload.input_origin !== "trusted_local_hardware"
      || payload.preview_acknowledged !== true
      || payload.plan_digest !== plan.plan_digest
      || payload.target_binding_digest !== plan.target_binding_digest
      || payload.task_id !== plan.task_id
      || payload.provider_id !== plan.provider_id
      || payload.exact_target !== plan.exact_target
      || payload.consequence_class !== "C3"
      || payload.rollback_posture !== "not_reversible"
      || !Number.isFinite(payload.issued_at)
      || !Number.isFinite(payload.expires_at)
      || payload.expires_at <= Date.now()
      || payload.issued_at > Date.now()
      || !payload.nonce
      || usedNonces.has(payload.nonce)
    ) {
      return false;
    }
    let signature;
    try {
      signature = Buffer.from(String(attestation.signature ?? ""), "base64");
    } catch {
      return false;
    }
    if (!signature.length || !verify(null, Buffer.from(stableJson(payload)), publicKey, signature)) {
      return false;
    }
    usedNonces.add(payload.nonce);
    return true;
  };
}

export function localConfirmationSigningPayload(attestation = {}) {
  return stableJson(canonicalAttestation(attestation));
}

function canonicalAttestation(attestation) {
  return {
    schema_version: Number(attestation.schema_version),
    plan_digest: String(attestation.plan_digest ?? ""),
    target_binding_digest: String(attestation.target_binding_digest ?? ""),
    task_id: String(attestation.task_id ?? ""),
    provider_id: String(attestation.provider_id ?? ""),
    exact_target: String(attestation.exact_target ?? ""),
    consequence_class: String(attestation.consequence_class ?? ""),
    rollback_posture: String(attestation.rollback_posture ?? ""),
    input_origin: String(attestation.input_origin ?? ""),
    preview_acknowledged: attestation.preview_acknowledged === true,
    issued_at: Number(attestation.issued_at),
    expires_at: Number(attestation.expires_at),
    nonce: String(attestation.nonce ?? ""),
  };
}

function stableJson(value) {
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${JSON.stringify(value[key])}`).join(",")}}`;
}

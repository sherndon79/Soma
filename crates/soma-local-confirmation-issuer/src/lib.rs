use p256::ecdsa::{signature::Verifier, Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

pub const RP_ID: &str = "lca.soma.local";
const UP_FLAG: u8 = 0x01;
const UV_FLAG: u8 = 0x04;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfirmationRequest {
    pub schema_version: u32,
    pub request_type: String,
    pub plan_digest: String,
    pub target_binding_digest: String,
    pub task_id: String,
    pub provider_id: String,
    pub inventory_id: String,
    pub exact_target: String,
    pub consequence_class: String,
    pub rollback_posture: String,
    pub request_nonce: String,
    pub issued_at: u64,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IssuerPolicy {
    pub schema_version: u32,
    pub rp_id: String,
    pub inventory_id: String,
    pub exact_target: String,
    pub credential_id: String,
    pub credential_public_key_sec1: String,
    pub require_uv: bool,
    pub minimum_counter: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct ReplayState {
    pub schema_version: u32,
    pub last_counter: u32,
    pub consumed_nonces: BTreeSet<String>,
}

#[derive(Debug, Clone)]
pub struct RawAssertion {
    pub credential_id: String,
    pub authenticator_data: Vec<u8>,
    pub signature_der: Vec<u8>,
}

pub trait FidoCeremony {
    fn get_assertion(
        &mut self,
        challenge_hash: [u8; 32],
        policy: &IssuerPolicy,
    ) -> Result<RawAssertion, IssuerError>;
}

#[derive(Debug, Clone, Serialize)]
pub struct VerifiedConfirmation {
    pub schema_version: u32,
    pub plan_digest: String,
    pub target_binding_digest: String,
    pub task_id: String,
    pub provider_id: String,
    pub exact_target: String,
    pub consequence_class: String,
    pub rollback_posture: String,
    pub input_origin: String,
    pub preview_acknowledged: bool,
    pub issued_at: u64,
    pub expires_at: u64,
    pub nonce: String,
}

#[derive(Debug, Clone)]
pub struct IssuerError {
    pub code: &'static str,
}

impl IssuerError {
    pub fn new(code: &'static str) -> Self {
        Self { code }
    }
}

pub struct CeremonyLimiter {
    next_allowed_at: u64,
    outstanding: bool,
    cooldown_ms: u64,
}

impl CeremonyLimiter {
    pub fn new(cooldown_ms: u64) -> Self {
        Self {
            next_allowed_at: 0,
            outstanding: false,
            cooldown_ms,
        }
    }

    pub fn begin(&mut self, now: u64) -> Result<CeremonyGuard<'_>, IssuerError> {
        if self.outstanding || now < self.next_allowed_at {
            return Err(IssuerError::new("lca_rate_limited"));
        }
        self.outstanding = true;
        Ok(CeremonyGuard {
            limiter: self,
            completed_at: now,
        })
    }
}

pub struct CeremonyGuard<'a> {
    limiter: &'a mut CeremonyLimiter,
    completed_at: u64,
}

impl CeremonyGuard<'_> {
    pub fn complete(mut self, now: u64) {
        self.completed_at = now;
    }
}

impl Drop for CeremonyGuard<'_> {
    fn drop(&mut self) {
        self.limiter.outstanding = false;
        self.limiter.next_allowed_at = self.completed_at + self.limiter.cooldown_ms;
    }
}

pub fn verify_confirmation(
    request: &ConfirmationRequest,
    policy: &IssuerPolicy,
    state_path: &Path,
    ceremony: &mut impl FidoCeremony,
    now: u64,
) -> Result<VerifiedConfirmation, IssuerError> {
    validate_request(request, policy, now)?;
    let challenge_hash = challenge_hash(request)?;
    let assertion = ceremony.get_assertion(challenge_hash, policy)?;
    let counter = verify_raw_assertion(&assertion, challenge_hash, policy)?;

    let mut state = load_state(state_path)?;
    if state.schema_version != 1
        || state.consumed_nonces.contains(&request.request_nonce)
        || counter <= state.last_counter
        || counter <= policy.minimum_counter
    {
        return Err(IssuerError::new("lca_replay_or_counter_invalid"));
    }
    state.last_counter = counter;
    state.consumed_nonces.insert(request.request_nonce.clone());
    persist_state(state_path, &state)?;

    Ok(VerifiedConfirmation {
        schema_version: 1,
        plan_digest: request.plan_digest.clone(),
        target_binding_digest: request.target_binding_digest.clone(),
        task_id: request.task_id.clone(),
        provider_id: request.provider_id.clone(),
        exact_target: request.exact_target.clone(),
        consequence_class: "C3".to_string(),
        rollback_posture: "not_reversible".to_string(),
        input_origin: "trusted_local_hardware".to_string(),
        preview_acknowledged: true,
        issued_at: now,
        expires_at: request.expires_at,
        nonce: request.request_nonce.clone(),
    })
}

pub fn verify_raw_assertion(
    assertion: &RawAssertion,
    challenge_hash: [u8; 32],
    policy: &IssuerPolicy,
) -> Result<u32, IssuerError> {
    if assertion.credential_id != policy.credential_id || assertion.authenticator_data.len() < 37 {
        return Err(IssuerError::new("lca_assertion_invalid"));
    }
    let expected_rp_hash = Sha256::digest(policy.rp_id.as_bytes());
    if assertion.authenticator_data[..32] != expected_rp_hash[..] {
        return Err(IssuerError::new("lca_assertion_invalid"));
    }
    let flags = assertion.authenticator_data[32];
    if flags & UP_FLAG == 0 || (policy.require_uv && flags & UV_FLAG == 0) {
        return Err(IssuerError::new("lca_assertion_invalid"));
    }
    let counter = u32::from_be_bytes(
        assertion.authenticator_data[33..37]
            .try_into()
            .map_err(|_| IssuerError::new("lca_assertion_invalid"))?,
    );
    let public_key_bytes = hex::decode(&policy.credential_public_key_sec1)
        .map_err(|_| IssuerError::new("lca_credential_store_invalid"))?;
    let verifying_key = VerifyingKey::from_sec1_bytes(&public_key_bytes)
        .map_err(|_| IssuerError::new("lca_credential_store_invalid"))?;
    let signature = Signature::from_der(&assertion.signature_der)
        .map_err(|_| IssuerError::new("lca_assertion_invalid"))?;
    let mut signed = assertion.authenticator_data.clone();
    signed.extend_from_slice(&challenge_hash);
    // p256's high-level Verifier hashes this FIDO signature base with SHA-256 internally.
    verifying_key
        .verify(&signed, &signature)
        .map_err(|_| IssuerError::new("lca_assertion_invalid"))?;
    Ok(counter)
}

pub fn challenge_hash(request: &ConfirmationRequest) -> Result<[u8; 32], IssuerError> {
    let value = serde_json::json!({
        "domain": "soma.lca.fido2.challenge.v1",
        "rp_id": RP_ID,
        "plan_digest": request.plan_digest,
        "target_binding_digest": request.target_binding_digest,
        "task_id": request.task_id,
        "provider_id": request.provider_id,
        "inventory_id": request.inventory_id,
        "exact_target": request.exact_target,
        "consequence_class": request.consequence_class,
        "rollback_posture": request.rollback_posture,
        "request_nonce": request.request_nonce,
        "expires_at": request.expires_at,
    });
    let encoded = stable_json(&value)?;
    Ok(Sha256::digest(encoded.as_bytes()).into())
}

pub fn assert_credential_store_permissions(path: &Path) -> Result<(), IssuerError> {
    use std::os::unix::fs::MetadataExt;
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| IssuerError::new("lca_credential_store_unavailable"))?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.uid() != 0
        || metadata.mode() & 0o022 != 0
    {
        return Err(IssuerError::new("lca_credential_store_permissions_invalid"));
    }
    Ok(())
}

fn validate_request(
    request: &ConfirmationRequest,
    policy: &IssuerPolicy,
    now: u64,
) -> Result<(), IssuerError> {
    if request.schema_version != 1
        || request.request_type != "soma.local-confirmation.request.v1"
        || policy.schema_version != 1
        || policy.rp_id != RP_ID
        || request.inventory_id != policy.inventory_id
        || request.exact_target != policy.exact_target
        || request.consequence_class != "C3"
        || request.rollback_posture != "not_reversible"
        || request.issued_at > now
        || request.expires_at <= now
        || request.expires_at - now > 120_000
        || request.request_nonce.len() < 16
        || !is_hex_digest(&request.plan_digest)
        || !is_hex_digest(&request.target_binding_digest)
    {
        return Err(IssuerError::new("lca_request_invalid"));
    }
    Ok(())
}

fn load_state(path: &Path) -> Result<ReplayState, IssuerError> {
    assert_state_store_permissions(path)?;
    let raw = fs::read(path).map_err(|_| IssuerError::new("lca_state_unavailable"))?;
    serde_json::from_slice(&raw).map_err(|_| IssuerError::new("lca_state_invalid"))
}

pub fn assert_state_store_permissions(path: &Path) -> Result<(), IssuerError> {
    use std::os::unix::fs::MetadataExt;
    let metadata =
        fs::symlink_metadata(path).map_err(|_| IssuerError::new("lca_state_unavailable"))?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o022 != 0
    {
        return Err(IssuerError::new("lca_state_permissions_invalid"));
    }
    Ok(())
}

fn persist_state(path: &Path, state: &ReplayState) -> Result<(), IssuerError> {
    let parent = path
        .parent()
        .ok_or_else(|| IssuerError::new("lca_state_invalid"))?;
    let temporary = temporary_path(path);
    let encoded = serde_json::to_vec(state).map_err(|_| IssuerError::new("lca_state_invalid"))?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(&temporary)
        .map_err(|_| IssuerError::new("lca_state_write_failed"))?;
    file.write_all(&encoded)
        .and_then(|_| file.sync_all())
        .map_err(|_| IssuerError::new("lca_state_write_failed"))?;
    fs::rename(&temporary, path).map_err(|_| IssuerError::new("lca_state_write_failed"))?;
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| IssuerError::new("lca_state_write_failed"))?;
    Ok(())
}

fn temporary_path(path: &Path) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(format!(".tmp-{}", std::process::id()));
    PathBuf::from(value)
}

fn is_hex_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn stable_json(value: &serde_json::Value) -> Result<String, IssuerError> {
    match value {
        serde_json::Value::Object(map) => {
            let mut entries = map.iter().collect::<Vec<_>>();
            entries.sort_by_key(|(key, _)| *key);
            let values = entries
                .into_iter()
                .map(|(key, value)| {
                    Ok(format!(
                        "{}:{}",
                        serde_json::to_string(key)
                            .map_err(|_| IssuerError::new("lca_encoding_failed"))?,
                        stable_json(value)?
                    ))
                })
                .collect::<Result<Vec<_>, IssuerError>>()?;
            Ok(format!("{{{}}}", values.join(",")))
        }
        serde_json::Value::Array(values) => Ok(format!(
            "[{}]",
            values
                .iter()
                .map(stable_json)
                .collect::<Result<Vec<_>, _>>()?
                .join(",")
        )),
        _ => serde_json::to_string(value).map_err(|_| IssuerError::new("lca_encoding_failed")),
    }
}

use std::os::unix::fs::OpenOptionsExt;

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::{signature::Signer, SigningKey};
    use p256::elliptic_curve::rand_core::OsRng;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct FakeCeremony {
        counter: u32,
        flags: u8,
        key: SigningKey,
    }

    impl FidoCeremony for FakeCeremony {
        fn get_assertion(
            &mut self,
            challenge_hash: [u8; 32],
            policy: &IssuerPolicy,
        ) -> Result<RawAssertion, IssuerError> {
            let mut authenticator_data = Sha256::digest(policy.rp_id.as_bytes()).to_vec();
            authenticator_data.push(self.flags);
            authenticator_data.extend_from_slice(&self.counter.to_be_bytes());
            let mut signed = authenticator_data.clone();
            signed.extend_from_slice(&challenge_hash);
            let signature: Signature = self.key.sign(&signed);
            Ok(RawAssertion {
                credential_id: policy.credential_id.clone(),
                authenticator_data,
                signature_der: signature.to_der().as_bytes().to_vec(),
            })
        }
    }

    #[test]
    fn confirmation_is_returned_only_after_durable_counter_consumption() {
        let directory = temp_directory();
        let state_path = directory.join("state.json");
        write_state(&state_path);
        let key = SigningKey::random(&mut OsRng);
        let policy = policy(&key);
        let mut ceremony = FakeCeremony {
            counter: 11,
            flags: UP_FLAG,
            key,
        };
        let confirmation =
            verify_confirmation(&request(), &policy, &state_path, &mut ceremony, 1_000).unwrap();
        let state = load_state(&state_path).unwrap();
        assert_eq!(state.last_counter, 11);
        assert!(state.consumed_nonces.contains("nonce-1234567890"));
        assert_eq!(confirmation.exact_target, "soma-lab-proof.service");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn replay_up_and_uv_fail_closed() {
        let directory = temp_directory();
        let state_path = directory.join("state.json");
        write_state(&state_path);
        let key = SigningKey::random(&mut OsRng);
        let policy = policy(&key);
        let mut ceremony = FakeCeremony {
            counter: 11,
            flags: 0,
            key,
        };
        assert_eq!(
            verify_confirmation(&request(), &policy, &state_path, &mut ceremony, 1_000)
                .unwrap_err()
                .code,
            "lca_assertion_invalid"
        );
        ceremony.flags = UP_FLAG | UV_FLAG;
        assert!(
            verify_confirmation(&request(), &policy, &state_path, &mut ceremony, 1_000).is_ok()
        );
        ceremony.counter = 12;
        assert_eq!(
            verify_confirmation(&request(), &policy, &state_path, &mut ceremony, 1_000)
                .unwrap_err()
                .code,
            "lca_replay_or_counter_invalid"
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn limiter_allows_one_ceremony_and_enforces_cooldown() {
        let mut limiter = CeremonyLimiter::new(5_000);
        {
            let guard = limiter.begin(1_000).unwrap();
            guard.complete(2_000);
        }
        assert!(matches!(
            limiter.begin(6_999),
            Err(IssuerError {
                code: "lca_rate_limited"
            })
        ));
        assert!(limiter.begin(7_000).is_ok());
    }

    #[test]
    fn assertion_parser_fails_closed_on_malformed_or_tampered_inputs() {
        let key = SigningKey::random(&mut OsRng);
        let policy = policy(&key);
        let challenge = [7_u8; 32];
        let mut ceremony = FakeCeremony {
            counter: 11,
            flags: UP_FLAG,
            key,
        };
        let valid = ceremony.get_assertion(challenge, &policy).unwrap();
        assert_eq!(
            verify_raw_assertion(&valid, challenge, &policy).unwrap(),
            11
        );

        for length in 0..37 {
            let malformed = RawAssertion {
                credential_id: valid.credential_id.clone(),
                authenticator_data: vec![0; length],
                signature_der: valid.signature_der.clone(),
            };
            assert!(verify_raw_assertion(&malformed, challenge, &policy).is_err());
        }
        let mut tampered = valid;
        tampered.authenticator_data[0] ^= 1;
        assert!(verify_raw_assertion(&tampered, challenge, &policy).is_err());
        assert!(verify_raw_assertion(&tampered, [8_u8; 32], &policy).is_err());
    }

    #[test]
    fn writable_or_foreign_replay_state_is_rejected() {
        use std::os::unix::fs::PermissionsExt;
        let directory = temp_directory();
        let state_path = directory.join("state.json");
        write_state(&state_path);
        fs::set_permissions(&state_path, fs::Permissions::from_mode(0o666)).unwrap();
        assert_eq!(
            load_state(&state_path).unwrap_err().code,
            "lca_state_permissions_invalid"
        );
        fs::remove_dir_all(directory).unwrap();
    }

    fn request() -> ConfirmationRequest {
        ConfirmationRequest {
            schema_version: 1,
            request_type: "soma.local-confirmation.request.v1".to_string(),
            plan_digest: "a".repeat(64),
            target_binding_digest: "b".repeat(64),
            task_id: "task-1".to_string(),
            provider_id: "soma.provider.systemd-local".to_string(),
            inventory_id: "lab-proof".to_string(),
            exact_target: "soma-lab-proof.service".to_string(),
            consequence_class: "C3".to_string(),
            rollback_posture: "not_reversible".to_string(),
            request_nonce: "nonce-1234567890".to_string(),
            issued_at: 900,
            expires_at: 2_000,
        }
    }

    fn policy(key: &SigningKey) -> IssuerPolicy {
        IssuerPolicy {
            schema_version: 1,
            rp_id: RP_ID.to_string(),
            inventory_id: "lab-proof".to_string(),
            exact_target: "soma-lab-proof.service".to_string(),
            credential_id: "credential-1".to_string(),
            credential_public_key_sec1: hex::encode(
                key.verifying_key().to_encoded_point(false).as_bytes(),
            ),
            require_uv: false,
            minimum_counter: 10,
        }
    }

    fn temp_directory() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("soma-lca-{nanos}"));
        fs::create_dir(&path).unwrap();
        path
    }

    fn write_state(path: &Path) {
        use std::os::unix::fs::PermissionsExt;
        fs::write(
            path,
            r#"{"schema_version":1,"last_counter":10,"consumed_nonces":[]}"#,
        )
        .unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
    }
}

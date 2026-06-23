use base64::{engine::general_purpose, Engine as _};
use openssl::hash::MessageDigest;
use openssl::sign::Verifier;
use openssl::stack::Stack;
use openssl::x509::{store::X509StoreBuilder, X509StoreContext, X509};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use soma_local_confirmation_issuer::fido::FidoApi;
use soma_local_confirmation_issuer::hardware::{
    assert_isolated_fido_device_for_gid, perform_assertion_for_gid,
};
use soma_local_confirmation_issuer::{
    verify_raw_assertion, IssuerError, IssuerPolicy, ReplayState, RP_ID,
};
use std::collections::BTreeSet;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use time::{format_description, OffsetDateTime};

const EXPECTED_AAGUID: &str = "d7781e5de35346aaafe23ca49f13332a";

fn main() {
    let options = Options::parse().unwrap_or_else(|code| fail(code));
    if unsafe { libc::geteuid() } != 0 {
        fail("lca_enrollment_root_required");
    }
    let output = enroll(&options).unwrap_or_else(|error| fail(error.code));
    println!("{}", output.display());
}

fn enroll(options: &Options) -> Result<PathBuf, IssuerError> {
    validate_target(&options.inventory_id, &options.exact_target)?;
    let soma_lca_gid = required_group_gid("soma-lca")?;
    assert_isolated_fido_device_for_gid(&options.device, soma_lca_gid)?;
    assert_root_owned_input(&options.mds_blob)?;
    assert_root_owned_input(&options.mds_root)?;
    assert_trusted_output_parent(&options.output)?;
    if options.output.exists() {
        return Err(IssuerError::new("lca_enrollment_output_exists"));
    }

    let mds_blob =
        fs::read(&options.mds_blob).map_err(|_| IssuerError::new("lca_mds_cache_unavailable"))?;
    let mds_root =
        fs::read(&options.mds_root).map_err(|_| IssuerError::new("lca_mds_root_unavailable"))?;
    let verified_mds = verify_mds_blob(&mds_blob, &mds_root, EXPECTED_AAGUID)?;

    let mut challenge = [0_u8; 32];
    let mut user_id = [0_u8; 32];
    OsRng.fill_bytes(&mut challenge);
    OsRng.fill_bytes(&mut user_id);

    eprintln!("Touch the dedicated authenticator once to create the Soma LCA credential.");
    let credential =
        FidoApi::load()?.make_es256_credential(&options.device, challenge, RP_ID, &user_id)?;
    if credential.certificate_chain.is_empty()
        || credential.credential_id.is_empty()
        || credential.credential_id.len() > 1024
        || credential.public_key.len() != 64
        || credential.aaguid.len() != 16
        || hex::encode(&credential.aaguid) != EXPECTED_AAGUID
        || credential.flags & 0x01 == 0
    {
        return Err(IssuerError::new("lca_attestation_invalid"));
    }
    verify_attestation_trust(
        &credential.certificate_chain,
        &verified_mds.attestation_roots_der,
    )?;

    let mut sec1 = Vec::with_capacity(65);
    sec1.push(0x04);
    sec1.extend_from_slice(&credential.public_key);
    let mut policy = IssuerPolicy {
        schema_version: 1,
        rp_id: RP_ID.to_string(),
        inventory_id: options.inventory_id.clone(),
        exact_target: options.exact_target.clone(),
        credential_id: hex::encode(&credential.credential_id),
        credential_public_key_sec1: hex::encode(sec1),
        require_uv: false,
        minimum_counter: 0,
    };
    let mut baseline_challenge = [0_u8; 32];
    OsRng.fill_bytes(&mut baseline_challenge);
    eprintln!("Touch the dedicated authenticator once more to establish its counter baseline.");
    let baseline_assertion =
        perform_assertion_for_gid(&options.device, baseline_challenge, &policy, soma_lca_gid)?;
    let baseline_counter = verify_raw_assertion(&baseline_assertion, baseline_challenge, &policy)?;
    if baseline_counter == 0 {
        return Err(IssuerError::new("lca_counter_unsupported"));
    }
    policy.minimum_counter = baseline_counter;

    fs::create_dir(&options.output)
        .map_err(|_| IssuerError::new("lca_enrollment_output_failed"))?;
    fs::set_permissions(&options.output, fs::Permissions::from_mode(0o700))
        .map_err(|_| IssuerError::new("lca_enrollment_output_failed"))?;
    let result = write_enrollment_artifacts(
        options,
        &policy,
        baseline_counter,
        &verified_mds,
        &mds_blob,
        &credential.certificate_chain,
    );
    if result.is_err() {
        let _ = fs::remove_dir_all(&options.output);
    }
    result?;
    Ok(options.output.clone())
}

fn write_enrollment_artifacts(
    options: &Options,
    policy: &IssuerPolicy,
    baseline_counter: u32,
    mds: &VerifiedMdsEntry,
    mds_blob: &[u8],
    attestation_certificate_chain: &[Vec<u8>],
) -> Result<(), IssuerError> {
    let replay = ReplayState {
        schema_version: 1,
        last_counter: baseline_counter,
        consumed_nonces: BTreeSet::new(),
    };
    let evidence = EnrollmentEvidence {
        schema_version: 1,
        rp_id: RP_ID.to_string(),
        require_uv: false,
        discoverable: false,
        cose_algorithm: "ES256".to_string(),
        attestation: "direct_basic".to_string(),
        aaguid: EXPECTED_AAGUID.to_string(),
        authenticator_description: mds.description.clone(),
        mds_blob_number: mds.blob_number,
        mds_next_update: mds.next_update.clone(),
        mds_blob_sha256: hex::encode(Sha256::digest(mds_blob)),
        attestation_certificate_sha256: hex::encode(Sha256::digest(
            &attestation_certificate_chain[0],
        )),
        attestation_certificate_chain_der_base64: attestation_certificate_chain
            .iter()
            .map(|certificate| general_purpose::STANDARD.encode(certificate))
            .collect(),
        credential_id_sha256: hex::encode(Sha256::digest(
            hex::decode(&policy.credential_id)
                .map_err(|_| IssuerError::new("lca_enrollment_output_failed"))?,
        )),
        baseline_counter,
        inventory_id: policy.inventory_id.clone(),
        exact_target: policy.exact_target.clone(),
        device_path: options.device.display().to_string(),
    };
    let drop_in = format!(
        "[Service]\nEnvironment=SOMA_LCA_FIDO_DEVICE={}\nDeviceAllow={} rw\n",
        options.device.display(),
        options.device.display()
    );
    write_json(&options.output.join("policy.json"), policy, 0o644)?;
    write_json(&options.output.join("replay-state.json"), &replay, 0o600)?;
    write_json(
        &options.output.join("enrollment-evidence.json"),
        &evidence,
        0o600,
    )?;
    write_file(
        &options.output.join("10-enrolled-device.conf"),
        drop_in.as_bytes(),
        0o644,
    )?;
    fs::File::open(&options.output)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| IssuerError::new("lca_enrollment_output_failed"))
}

fn verify_mds_blob(
    jwt: &[u8],
    root_pem: &[u8],
    expected_aaguid: &str,
) -> Result<VerifiedMdsEntry, IssuerError> {
    let jwt = std::str::from_utf8(jwt)
        .map_err(|_| IssuerError::new("lca_mds_cache_invalid"))?
        .trim();
    let parts = jwt.split('.').collect::<Vec<_>>();
    if parts.len() != 3 {
        return Err(IssuerError::new("lca_mds_cache_invalid"));
    }
    let header: JwsHeader = serde_json::from_slice(
        &general_purpose::URL_SAFE_NO_PAD
            .decode(parts[0])
            .map_err(|_| IssuerError::new("lca_mds_cache_invalid"))?,
    )
    .map_err(|_| IssuerError::new("lca_mds_cache_invalid"))?;
    if header.alg != "RS256" || header.x5c.is_empty() {
        return Err(IssuerError::new("lca_mds_signature_invalid"));
    }
    let certificates = header
        .x5c
        .iter()
        .map(|encoded| {
            general_purpose::STANDARD
                .decode(encoded)
                .map_err(|_| IssuerError::new("lca_mds_signature_invalid"))
                .and_then(|der| {
                    X509::from_der(&der).map_err(|_| IssuerError::new("lca_mds_signature_invalid"))
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    verify_certificate_chain(&certificates, root_pem, "lca_mds_signature_invalid")?;
    let signature = general_purpose::URL_SAFE_NO_PAD
        .decode(parts[2])
        .map_err(|_| IssuerError::new("lca_mds_signature_invalid"))?;
    let public_key = certificates[0]
        .public_key()
        .map_err(|_| IssuerError::new("lca_mds_signature_invalid"))?;
    let mut verifier = Verifier::new(MessageDigest::sha256(), &public_key)
        .map_err(|_| IssuerError::new("lca_mds_signature_invalid"))?;
    verifier
        .update(format!("{}.{}", parts[0], parts[1]).as_bytes())
        .map_err(|_| IssuerError::new("lca_mds_signature_invalid"))?;
    if !verifier
        .verify(&signature)
        .map_err(|_| IssuerError::new("lca_mds_signature_invalid"))?
    {
        return Err(IssuerError::new("lca_mds_signature_invalid"));
    }
    let payload: MdsPayload = serde_json::from_slice(
        &general_purpose::URL_SAFE_NO_PAD
            .decode(parts[1])
            .map_err(|_| IssuerError::new("lca_mds_cache_invalid"))?,
    )
    .map_err(|_| IssuerError::new("lca_mds_cache_invalid"))?;
    assert_mds_fresh(&payload.next_update)?;
    let blob_number = payload.number();
    let next_update = payload.next_update.clone();
    let entry = payload
        .entries
        .into_iter()
        .find(|entry| normalize_aaguid(entry.aaguid.as_deref()) == expected_aaguid)
        .ok_or_else(|| IssuerError::new("lca_mds_entry_missing"))?;
    if entry
        .status_reports
        .iter()
        .any(|report| disqualifying_status(&report.status))
    {
        return Err(IssuerError::new("lca_mds_authenticator_disqualified"));
    }
    let statement = entry
        .metadata_statement
        .ok_or_else(|| IssuerError::new("lca_mds_entry_invalid"))?;
    if normalize_aaguid(statement.aaguid.as_deref()) != expected_aaguid
        || !statement
            .attachment_hint
            .iter()
            .any(|value| value == "external")
        || !statement
            .attachment_hint
            .iter()
            .any(|value| value == "wired")
        || !statement
            .attestation_types
            .iter()
            .any(|value| matches!(value.as_str(), "basic_full" | "attca"))
        || statement.attestation_root_certificates.is_empty()
    {
        return Err(IssuerError::new("lca_mds_entry_invalid"));
    }
    let roots = statement
        .attestation_root_certificates
        .iter()
        .map(|encoded| {
            general_purpose::STANDARD
                .decode(encoded)
                .map_err(|_| IssuerError::new("lca_mds_entry_invalid"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(VerifiedMdsEntry {
        blob_number,
        next_update,
        description: statement.description,
        attestation_roots_der: roots,
    })
}

fn verify_attestation_trust(
    certificate_chain_der: &[Vec<u8>],
    roots_der: &[Vec<u8>],
) -> Result<(), IssuerError> {
    let (leaf_der, intermediates_der) = certificate_chain_der
        .split_first()
        .ok_or_else(|| IssuerError::new("lca_attestation_invalid"))?;
    let leaf = X509::from_der(leaf_der).map_err(|_| IssuerError::new("lca_attestation_invalid"))?;
    let mut store =
        X509StoreBuilder::new().map_err(|_| IssuerError::new("lca_attestation_invalid"))?;
    for root in roots_der {
        store
            .add_cert(
                X509::from_der(root).map_err(|_| IssuerError::new("lca_attestation_invalid"))?,
            )
            .map_err(|_| IssuerError::new("lca_attestation_invalid"))?;
    }
    let store = store.build();
    let mut chain = Stack::new().map_err(|_| IssuerError::new("lca_attestation_invalid"))?;
    for intermediate in intermediates_der {
        chain
            .push(
                X509::from_der(intermediate)
                    .map_err(|_| IssuerError::new("lca_attestation_invalid"))?,
            )
            .map_err(|_| IssuerError::new("lca_attestation_invalid"))?;
    }
    let mut context =
        X509StoreContext::new().map_err(|_| IssuerError::new("lca_attestation_invalid"))?;
    let valid = context
        .init(&store, &leaf, &chain, |context| context.verify_cert())
        .map_err(|_| IssuerError::new("lca_attestation_invalid"))?;
    if !valid {
        return Err(IssuerError::new("lca_attestation_invalid"));
    }
    Ok(())
}

fn verify_certificate_chain(
    certificates: &[X509],
    root_pem: &[u8],
    code: &'static str,
) -> Result<(), IssuerError> {
    let leaf = certificates.first().ok_or_else(|| IssuerError::new(code))?;
    let roots = X509::stack_from_pem(root_pem).map_err(|_| IssuerError::new(code))?;
    if roots.is_empty() {
        return Err(IssuerError::new(code));
    }
    let mut store = X509StoreBuilder::new().map_err(|_| IssuerError::new(code))?;
    for root in roots {
        store.add_cert(root).map_err(|_| IssuerError::new(code))?;
    }
    let store = store.build();
    let mut chain = Stack::new().map_err(|_| IssuerError::new(code))?;
    for certificate in certificates.iter().skip(1) {
        chain
            .push(certificate.clone())
            .map_err(|_| IssuerError::new(code))?;
    }
    let mut context = X509StoreContext::new().map_err(|_| IssuerError::new(code))?;
    let valid = context
        .init(&store, leaf, &chain, |context| context.verify_cert())
        .map_err(|_| IssuerError::new(code))?;
    if !valid {
        return Err(IssuerError::new(code));
    }
    Ok(())
}

fn assert_mds_fresh(next_update: &str) -> Result<(), IssuerError> {
    let format = format_description::parse("[year]-[month]-[day]")
        .map_err(|_| IssuerError::new("lca_mds_cache_invalid"))?;
    let next = time::Date::parse(next_update, &format)
        .map_err(|_| IssuerError::new("lca_mds_cache_invalid"))?;
    if next < OffsetDateTime::now_utc().date() {
        return Err(IssuerError::new("lca_mds_cache_expired"));
    }
    Ok(())
}

fn normalize_aaguid(value: Option<&str>) -> String {
    value
        .unwrap_or_default()
        .chars()
        .filter(|character| *character != '-')
        .flat_map(char::to_lowercase)
        .collect()
}

fn disqualifying_status(status: &str) -> bool {
    matches!(
        status,
        "USER_VERIFICATION_BYPASS"
            | "ATTESTATION_KEY_COMPROMISE"
            | "USER_KEY_REMOTE_COMPROMISE"
            | "USER_KEY_PHYSICAL_COMPROMISE"
            | "REVOKED"
    )
}

fn validate_target(inventory_id: &str, exact_target: &str) -> Result<(), IssuerError> {
    let inventory_valid = !inventory_id.is_empty()
        && inventory_id.len() <= 64
        && inventory_id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-');
    let target_body = exact_target
        .strip_prefix("soma-lab-")
        .and_then(|value| value.strip_suffix(".service"));
    if !inventory_valid || target_body != Some(inventory_id) || exact_target.len() > 128 {
        return Err(IssuerError::new("lca_enrollment_target_invalid"));
    }
    Ok(())
}

fn assert_root_owned_input(path: &Path) -> Result<(), IssuerError> {
    let metadata =
        fs::symlink_metadata(path).map_err(|_| IssuerError::new("lca_enrollment_input_invalid"))?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.uid() != 0
        || metadata.mode() & 0o022 != 0
    {
        return Err(IssuerError::new("lca_enrollment_input_invalid"));
    }
    Ok(())
}

fn required_group_gid(name: &str) -> Result<libc::gid_t, IssuerError> {
    let name = std::ffi::CString::new(name)
        .map_err(|_| IssuerError::new("lca_enrollment_identity_invalid"))?;
    let group = unsafe { libc::getgrnam(name.as_ptr()) };
    if group.is_null() {
        return Err(IssuerError::new("lca_enrollment_identity_invalid"));
    }
    let gid = unsafe { (*group).gr_gid };
    if gid == 0 {
        return Err(IssuerError::new("lca_enrollment_identity_invalid"));
    }
    Ok(gid)
}

fn assert_trusted_output_parent(path: &Path) -> Result<(), IssuerError> {
    let parent = path
        .parent()
        .ok_or_else(|| IssuerError::new("lca_enrollment_output_invalid"))?;
    let metadata = fs::symlink_metadata(parent)
        .map_err(|_| IssuerError::new("lca_enrollment_output_invalid"))?;
    if !path.is_absolute()
        || metadata.file_type().is_symlink()
        || !metadata.is_dir()
        || metadata.uid() != 0
        || metadata.mode() & 0o022 != 0
    {
        return Err(IssuerError::new("lca_enrollment_output_invalid"));
    }
    Ok(())
}

fn write_json(path: &Path, value: &impl Serialize, mode: u32) -> Result<(), IssuerError> {
    let mut encoded = serde_json::to_vec_pretty(value)
        .map_err(|_| IssuerError::new("lca_enrollment_output_failed"))?;
    encoded.push(b'\n');
    write_file(path, &encoded, mode)
}

fn write_file(path: &Path, contents: &[u8], mode: u32) -> Result<(), IssuerError> {
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(mode)
        .open(path)
        .map_err(|_| IssuerError::new("lca_enrollment_output_failed"))?;
    file.write_all(contents)
        .and_then(|_| file.sync_all())
        .map_err(|_| IssuerError::new("lca_enrollment_output_failed"))?;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
        .map_err(|_| IssuerError::new("lca_enrollment_output_failed"))
}

#[derive(Debug)]
struct Options {
    device: PathBuf,
    mds_blob: PathBuf,
    mds_root: PathBuf,
    inventory_id: String,
    exact_target: String,
    output: PathBuf,
}

impl Options {
    fn parse() -> Result<Self, &'static str> {
        let mut args = std::env::args().skip(1);
        let mut device = None;
        let mut mds_blob = None;
        let mut mds_root = None;
        let mut inventory_id = None;
        let mut exact_target = None;
        let mut output = None;
        while let Some(argument) = args.next() {
            let value = args.next().ok_or("lca_enrollment_arguments_invalid")?;
            match argument.as_str() {
                "--device" if device.is_none() => device = Some(PathBuf::from(value)),
                "--mds-blob" if mds_blob.is_none() => mds_blob = Some(PathBuf::from(value)),
                "--mds-root" if mds_root.is_none() => mds_root = Some(PathBuf::from(value)),
                "--inventory-id" if inventory_id.is_none() => inventory_id = Some(value),
                "--exact-target" if exact_target.is_none() => exact_target = Some(value),
                "--output" if output.is_none() => output = Some(PathBuf::from(value)),
                _ => return Err("lca_enrollment_arguments_invalid"),
            }
        }
        Ok(Self {
            device: device.ok_or("lca_enrollment_arguments_invalid")?,
            mds_blob: mds_blob.ok_or("lca_enrollment_arguments_invalid")?,
            mds_root: mds_root.ok_or("lca_enrollment_arguments_invalid")?,
            inventory_id: inventory_id.ok_or("lca_enrollment_arguments_invalid")?,
            exact_target: exact_target.ok_or("lca_enrollment_arguments_invalid")?,
            output: output.ok_or("lca_enrollment_arguments_invalid")?,
        })
    }
}

#[derive(Deserialize)]
struct JwsHeader {
    alg: String,
    x5c: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MdsPayload {
    no: u64,
    next_update: String,
    entries: Vec<MdsEntry>,
}

impl MdsPayload {
    fn number(&self) -> u64 {
        self.no
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MdsEntry {
    aaguid: Option<String>,
    metadata_statement: Option<MetadataStatement>,
    #[serde(default)]
    status_reports: Vec<StatusReport>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MetadataStatement {
    description: String,
    aaguid: Option<String>,
    attachment_hint: Vec<String>,
    #[serde(default)]
    attestation_types: Vec<String>,
    #[serde(default)]
    attestation_root_certificates: Vec<String>,
}

#[derive(Deserialize)]
struct StatusReport {
    status: String,
}

struct VerifiedMdsEntry {
    blob_number: u64,
    next_update: String,
    description: String,
    attestation_roots_der: Vec<Vec<u8>>,
}

#[derive(Serialize)]
struct EnrollmentEvidence {
    schema_version: u32,
    rp_id: String,
    require_uv: bool,
    discoverable: bool,
    cose_algorithm: String,
    attestation: String,
    aaguid: String,
    authenticator_description: String,
    mds_blob_number: u64,
    mds_next_update: String,
    mds_blob_sha256: String,
    attestation_certificate_sha256: String,
    attestation_certificate_chain_der_base64: Vec<String>,
    credential_id_sha256: String,
    baseline_counter: u32,
    inventory_id: String,
    exact_target: String,
    device_path: String,
}

fn fail(code: &str) -> ! {
    eprintln!("{code}");
    std::process::exit(78);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_is_one_exact_expendable_lab_unit() {
        assert!(validate_target("proof", "soma-lab-proof.service").is_ok());
        assert!(validate_target("proof", "other.service").is_err());
        assert!(validate_target("Proof", "soma-lab-Proof.service").is_err());
    }

    #[test]
    fn metadata_statuses_fail_closed() {
        assert!(disqualifying_status("REVOKED"));
        assert!(disqualifying_status("ATTESTATION_KEY_COMPROMISE"));
        assert!(!disqualifying_status("FIDO_CERTIFIED_L2"));
    }

    #[test]
    fn aaguid_normalization_accepts_standard_hyphenation() {
        assert_eq!(
            normalize_aaguid(Some("d7781e5d-e353-46aa-afe2-3ca49f13332a")),
            EXPECTED_AAGUID
        );
    }

    #[test]
    fn optional_current_mds_fixture_verifies() {
        let Some(blob) = std::env::var_os("SOMA_TEST_MDS_BLOB") else {
            return;
        };
        let root = std::env::var_os("SOMA_TEST_MDS_ROOT").unwrap();
        let entry = verify_mds_blob(
            &fs::read(blob).unwrap(),
            &fs::read(root).unwrap(),
            EXPECTED_AAGUID,
        )
        .unwrap();
        assert!(!entry.description.is_empty());
        assert!(!entry.attestation_roots_der.is_empty());
    }
}

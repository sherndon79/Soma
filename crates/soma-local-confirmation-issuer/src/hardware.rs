use crate::fido::FidoApi;
use crate::{FidoCeremony, IssuerError, IssuerPolicy, RawAssertion};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::os::unix::fs::{FileTypeExt, MetadataExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const WORKER_TIMEOUT: Duration = Duration::from_secs(15);
const WORKER_LIMIT: u64 = 64 * 1024;

pub struct HardwareCeremony {
    device_path: PathBuf,
}

impl HardwareCeremony {
    pub fn from_environment() -> Result<Self, IssuerError> {
        let device_path = std::env::var_os("SOMA_LCA_FIDO_DEVICE")
            .map(PathBuf::from)
            .ok_or_else(|| IssuerError::new("lca_hardware_backend_disabled"))?;
        assert_isolated_fido_device(&device_path)?;
        Ok(Self { device_path })
    }
}

impl FidoCeremony for HardwareCeremony {
    fn get_assertion(
        &mut self,
        challenge_hash: [u8; 32],
        policy: &IssuerPolicy,
    ) -> Result<RawAssertion, IssuerError> {
        assert_isolated_fido_device(&self.device_path)?;
        if std::env::var_os("SOMA_LCA_FIDO_DEVICE").as_deref() != Some(self.device_path.as_os_str())
        {
            return Err(IssuerError::new("lca_device_configuration_invalid"));
        }
        let request = WorkerRequest {
            challenge_hash,
            policy: policy.clone(),
        };
        let encoded = serde_json::to_vec(&request)
            .map_err(|_| IssuerError::new("lca_hardware_request_invalid"))?;
        let executable = std::env::current_exe()
            .map_err(|_| IssuerError::new("lca_hardware_backend_unavailable"))?;
        assert_trusted_executable(&executable)?;
        let mut child = Command::new(executable)
            .arg("--fido-assert-worker")
            .env_clear()
            .env("SOMA_LCA_FIDO_DEVICE", &self.device_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| IssuerError::new("lca_hardware_backend_unavailable"))?;
        child
            .stdin
            .take()
            .ok_or_else(|| IssuerError::new("lca_hardware_backend_unavailable"))?
            .write_all(&encoded)
            .map_err(|_| IssuerError::new("lca_hardware_backend_unavailable"))?;

        let deadline = Instant::now() + WORKER_TIMEOUT;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if Instant::now() < deadline => {
                    thread::sleep(Duration::from_millis(25));
                }
                Ok(None) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(IssuerError::new("lca_hardware_timeout"));
                }
                Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(IssuerError::new("lca_hardware_backend_unavailable"));
                }
            }
        };
        if !status.success() {
            return Err(IssuerError::new("lca_hardware_ceremony_failed"));
        }
        let mut output = Vec::new();
        child
            .stdout
            .take()
            .ok_or_else(|| IssuerError::new("lca_hardware_response_invalid"))?
            .take(WORKER_LIMIT + 1)
            .read_to_end(&mut output)
            .map_err(|_| IssuerError::new("lca_hardware_response_invalid"))?;
        if output.len() as u64 > WORKER_LIMIT {
            return Err(IssuerError::new("lca_hardware_response_invalid"));
        }
        let response: WorkerResponse = serde_json::from_slice(&output)
            .map_err(|_| IssuerError::new("lca_hardware_response_invalid"))?;
        match (response.ok, response.assertion, response.error) {
            (true, Some(assertion), None) => Ok(assertion),
            (false, None, Some(_)) => Err(IssuerError::new("lca_hardware_ceremony_failed")),
            _ => Err(IssuerError::new("lca_hardware_response_invalid")),
        }
    }
}

pub fn run_assertion_worker() -> Result<(), IssuerError> {
    let mut input = Vec::new();
    std::io::stdin()
        .take(WORKER_LIMIT + 1)
        .read_to_end(&mut input)
        .map_err(|_| IssuerError::new("lca_hardware_request_invalid"))?;
    if input.len() as u64 > WORKER_LIMIT {
        return Err(IssuerError::new("lca_hardware_request_invalid"));
    }
    let request: WorkerRequest = serde_json::from_slice(&input)
        .map_err(|_| IssuerError::new("lca_hardware_request_invalid"))?;
    let device_path = std::env::var_os("SOMA_LCA_FIDO_DEVICE")
        .map(PathBuf::from)
        .ok_or_else(|| IssuerError::new("lca_device_configuration_invalid"))?;
    let response = match perform_assertion(&device_path, request.challenge_hash, &request.policy) {
        Ok(assertion) => WorkerResponse {
            ok: true,
            assertion: Some(assertion),
            error: None,
        },
        Err(error) => WorkerResponse {
            ok: false,
            assertion: None,
            error: Some(error.code.to_string()),
        },
    };
    serde_json::to_writer(std::io::stdout(), &response)
        .map_err(|_| IssuerError::new("lca_hardware_response_invalid"))
}

pub fn perform_assertion(
    device_path: &Path,
    challenge_hash: [u8; 32],
    policy: &IssuerPolicy,
) -> Result<RawAssertion, IssuerError> {
    perform_assertion_for_gid(device_path, challenge_hash, policy, unsafe {
        libc::getegid()
    })
}

pub fn perform_assertion_for_gid(
    device_path: &Path,
    challenge_hash: [u8; 32],
    policy: &IssuerPolicy,
    expected_gid: libc::gid_t,
) -> Result<RawAssertion, IssuerError> {
    assert_isolated_fido_device_for_gid(device_path, expected_gid)?;
    let credential_id = hex::decode(&policy.credential_id)
        .map_err(|_| IssuerError::new("lca_credential_store_invalid"))?;
    if credential_id.is_empty() || credential_id.len() > 1024 {
        return Err(IssuerError::new("lca_credential_store_invalid"));
    }
    FidoApi::load()?.get_assertion(
        device_path,
        challenge_hash,
        &policy.rp_id,
        &credential_id,
        policy.require_uv,
    )
}

pub fn assert_isolated_fido_device(path: &Path) -> Result<(), IssuerError> {
    assert_isolated_fido_device_for_gid(path, unsafe { libc::getegid() })
}

pub fn assert_isolated_fido_device_for_gid(
    path: &Path,
    expected_gid: libc::gid_t,
) -> Result<(), IssuerError> {
    let name_valid = path.parent() == Some(Path::new("/dev"))
        && path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                name.strip_prefix("hidraw").is_some_and(|suffix| {
                    !suffix.is_empty() && suffix.bytes().all(|b| b.is_ascii_digit())
                })
            });
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| IssuerError::new("lca_device_configuration_invalid"))?;
    if !name_valid
        || metadata.file_type().is_symlink()
        || !metadata.file_type().is_char_device()
        || metadata.uid() != 0
        || metadata.gid() != expected_gid
        || metadata.mode() & 0o777 != 0o660
    {
        return Err(IssuerError::new("lca_device_configuration_invalid"));
    }
    Ok(())
}

fn assert_trusted_executable(path: &Path) -> Result<(), IssuerError> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| IssuerError::new("lca_hardware_backend_unavailable"))?;
    let parent = path
        .parent()
        .and_then(|parent| fs::symlink_metadata(parent).ok())
        .ok_or_else(|| IssuerError::new("lca_hardware_backend_unavailable"))?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.uid() != 0
        || metadata.mode() & 0o022 != 0
        || parent.file_type().is_symlink()
        || !parent.is_dir()
        || parent.uid() != 0
        || parent.mode() & 0o022 != 0
    {
        return Err(IssuerError::new("lca_hardware_backend_unavailable"));
    }
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkerRequest {
    challenge_hash: [u8; 32],
    policy: IssuerPolicy,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkerResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    assertion: Option<RawAssertion>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

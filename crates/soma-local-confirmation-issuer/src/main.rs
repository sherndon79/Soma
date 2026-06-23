use serde::Deserialize;
use soma_local_confirmation_issuer::{
    execute_request, CeremonyLimiter, ConfirmationRequest, FidoCeremony, IssuerError, IssuerPolicy,
    RawAssertion,
};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProtocolRequest {
    request_id: String,
    confirmation_request: ConfirmationRequest,
}

struct DisabledCeremony;

impl FidoCeremony for DisabledCeremony {
    fn get_assertion(
        &mut self,
        _challenge_hash: [u8; 32],
        _policy: &IssuerPolicy,
    ) -> Result<RawAssertion, IssuerError> {
        Err(IssuerError::new("lca_hardware_backend_disabled"))
    }
}

enum ConfiguredCeremony {
    Disabled(DisabledCeremony),
    #[cfg(feature = "hardware-fido")]
    Hardware(soma_local_confirmation_issuer::hardware::HardwareCeremony),
}

impl FidoCeremony for ConfiguredCeremony {
    fn get_assertion(
        &mut self,
        challenge_hash: [u8; 32],
        policy: &IssuerPolicy,
    ) -> Result<RawAssertion, IssuerError> {
        match self {
            Self::Disabled(ceremony) => ceremony.get_assertion(challenge_hash, policy),
            #[cfg(feature = "hardware-fido")]
            Self::Hardware(ceremony) => ceremony.get_assertion(challenge_hash, policy),
        }
    }
}

fn main() {
    #[cfg(feature = "hardware-fido")]
    if std::env::args().any(|argument| argument == "--fido-assert-worker") {
        soma_local_confirmation_issuer::hardware::run_assertion_worker()
            .unwrap_or_else(|error| fail(error.code));
        return;
    }
    if !std::env::args().any(|argument| argument == "--serve") {
        eprintln!("lca_serve_mode_required");
        std::process::exit(78);
    }
    let expected_uid = required_uid("SOMA_LCA_EXPECTED_HARNESS_UID");
    let expected_gid = required_gid("SOMA_LCA_EXPECTED_HARNESS_GID");
    let policy_path = required_path("SOMA_LCA_POLICY");
    let state_path = required_path("SOMA_LCA_REPLAY_STATE");
    let socket_path = required_path("SOMA_LCA_SOCKET_PATH");
    soma_local_confirmation_issuer::assert_credential_store_permissions(&policy_path)
        .unwrap_or_else(|error| fail(error.code));
    let policy: IssuerPolicy = fs::read(&policy_path)
        .ok()
        .and_then(|raw| serde_json::from_slice(&raw).ok())
        .unwrap_or_else(|| fail("lca_policy_invalid"));
    let mut ceremony = configured_ceremony();
    let bound = bind_listener(&socket_path, expected_gid).unwrap_or_else(|code| fail(code));
    let mut limiter = CeremonyLimiter::new(5_000);

    for connection in bound.listener.incoming() {
        let Ok(mut stream) = connection else {
            continue;
        };
        if verify_peer_uid(&stream, expected_uid).is_err() {
            write_error(&mut stream, "", "lca_peer_unauthorized");
            continue;
        }
        let _ = serve_connection(
            &mut stream,
            &policy,
            &state_path,
            &mut limiter,
            &mut ceremony,
        );
    }
}

fn configured_ceremony() -> ConfiguredCeremony {
    #[cfg(feature = "hardware-fido")]
    if std::env::var_os("SOMA_LCA_FIDO_DEVICE").is_some() {
        return ConfiguredCeremony::Hardware(
            soma_local_confirmation_issuer::hardware::HardwareCeremony::from_environment()
                .unwrap_or_else(|error| fail(error.code)),
        );
    }
    ConfiguredCeremony::Disabled(DisabledCeremony)
}

fn serve_connection(
    stream: &mut UnixStream,
    policy: &IssuerPolicy,
    state_path: &std::path::Path,
    limiter: &mut CeremonyLimiter,
    ceremony: &mut impl FidoCeremony,
) -> Result<(), ()> {
    let reader_stream = stream.try_clone().map_err(|_| ())?;
    let mut line = String::new();
    BufReader::new(reader_stream)
        .take(64 * 1024 + 1)
        .read_line(&mut line)
        .map_err(|_| ())?;
    if line.len() > 64 * 1024 {
        write_error(stream, "", "lca_request_invalid");
        return Ok(());
    }
    let request: ProtocolRequest = match serde_json::from_str(&line) {
        Ok(request) => request,
        Err(_) => {
            write_error(stream, "", "lca_request_invalid");
            return Ok(());
        }
    };
    let now = now_ms();
    let response = execute_request(
        &request.request_id,
        &request.confirmation_request,
        policy,
        state_path,
        limiter,
        ceremony,
        now,
        now_ms,
    );
    serde_json::to_writer(&mut *stream, &response).map_err(|_| ())?;
    stream.write_all(b"\n").map_err(|_| ())?;
    stream.flush().map_err(|_| ())
}

struct BoundListener {
    listener: UnixListener,
    path: PathBuf,
}

impl Drop for BoundListener {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn bind_listener(path: &Path, expected_gid: libc::gid_t) -> Result<BoundListener, &'static str> {
    let parent = path.parent().ok_or("lca_socket_path_invalid")?;
    let parent_metadata =
        fs::symlink_metadata(parent).map_err(|_| "lca_socket_directory_invalid")?;
    if !parent_metadata.is_dir()
        || parent_metadata.file_type().is_symlink()
        || parent_metadata.uid() != unsafe { libc::geteuid() }
        || parent_metadata.gid() != expected_gid
        || parent_metadata.mode() & 0o777 != 0o750
    {
        return Err("lca_socket_directory_invalid");
    }
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if !metadata.file_type().is_socket() || metadata.uid() != unsafe { libc::geteuid() } {
            return Err("lca_socket_path_invalid");
        }
        fs::remove_file(path).map_err(|_| "lca_socket_path_invalid")?;
    }
    let listener = UnixListener::bind(path).map_err(|_| "lca_socket_bind_failed")?;
    // The 0750 parent admits only soma-lca and soma-harness; world bits on the socket do not
    // bypass directory traversal and avoid sharing a broader supplementary group with the issuer.
    fs::set_permissions(path, fs::Permissions::from_mode(0o666))
        .map_err(|_| "lca_socket_permissions_failed")?;
    Ok(BoundListener {
        listener,
        path: path.to_path_buf(),
    })
}

fn verify_peer_uid(stream: &UnixStream, expected_uid: libc::uid_t) -> Result<(), ()> {
    let mut credentials = libc::ucred {
        pid: 0,
        uid: 0,
        gid: 0,
    };
    let mut length = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    let result = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&mut credentials as *mut libc::ucred).cast(),
            &mut length,
        )
    };
    if result != 0
        || length as usize != std::mem::size_of::<libc::ucred>()
        || credentials.uid != expected_uid
        || credentials.pid <= 0
    {
        return Err(());
    }
    Ok(())
}

fn write_error(stream: &mut UnixStream, request_id: &str, code: &str) {
    let value = serde_json::json!({
        "request_id": request_id,
        "ok": false,
        "error": { "code": code }
    });
    let _ = serde_json::to_writer(&mut *stream, &value);
    let _ = stream.write_all(b"\n");
    let _ = stream.flush();
}

fn required_uid(name: &str) -> libc::uid_t {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .filter(|uid| *uid != 0)
        .unwrap_or_else(|| fail("lca_expected_uid_invalid"))
}

fn required_gid(name: &str) -> libc::gid_t {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .filter(|gid| *gid != 0)
        .unwrap_or_else(|| fail("lca_expected_gid_invalid"))
}

fn required_path(name: &str) -> PathBuf {
    std::env::var_os(name)
        .map(PathBuf::from)
        .unwrap_or_else(|| fail("lca_configuration_missing"))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn fail(code: &str) -> ! {
    eprintln!("{code}");
    std::process::exit(78);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn peer_uid_is_decisive() {
        let (client, server) = UnixStream::pair().unwrap();
        let uid = unsafe { libc::geteuid() };
        assert!(verify_peer_uid(&server, uid).is_ok());
        assert!(verify_peer_uid(&client, uid.saturating_add(1)).is_err());
    }

    #[test]
    fn issuer_owned_listener_exposes_issuer_peer_credentials() {
        let path = std::env::temp_dir().join(format!(
            "soma-lca-listener-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o750)).unwrap();
        let socket_path = path.join("issuer.sock");
        let gid = unsafe { libc::getegid() };
        let bound = bind_listener(&socket_path, gid).unwrap();
        let client = UnixStream::connect(&socket_path).unwrap();
        let (server, _) = bound.listener.accept().unwrap();
        let uid = unsafe { libc::geteuid() };
        assert!(verify_peer_uid(&client, uid).is_ok());
        assert!(verify_peer_uid(&server, uid).is_ok());
        drop(server);
        drop(client);
        drop(bound);
        assert!(!socket_path.exists());
        fs::remove_dir(path).unwrap();
    }
}

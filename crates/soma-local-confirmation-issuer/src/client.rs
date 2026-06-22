use std::io::{self, Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::net::UnixStream;

fn main() {
    let socket_path = required("SOMA_LCA_SOCKET_PATH");
    let expected_uid: libc::uid_t = required("SOMA_LCA_EXPECTED_SERVER_UID")
        .parse()
        .unwrap_or_else(|_| fail("lca_server_uid_invalid"));
    if expected_uid == 0 {
        fail("lca_server_uid_invalid");
    }
    let mut input = String::new();
    io::stdin()
        .take(64 * 1024 + 1)
        .read_to_string(&mut input)
        .unwrap_or_else(|_| fail("lca_client_input_invalid"));
    if input.len() > 64 * 1024 || !input.ends_with('\n') {
        fail("lca_client_input_invalid");
    }
    let mut stream =
        UnixStream::connect(socket_path).unwrap_or_else(|_| fail("lca_socket_unavailable"));
    verify_peer_uid(&stream, expected_uid).unwrap_or_else(|_| fail("lca_server_unauthorized"));
    stream
        .write_all(input.as_bytes())
        .unwrap_or_else(|_| fail("lca_socket_unavailable"));
    let mut output = String::new();
    stream
        .take(64 * 1024 + 1)
        .read_to_string(&mut output)
        .unwrap_or_else(|_| fail("lca_socket_unavailable"));
    if output.len() > 64 * 1024 || !output.ends_with('\n') {
        fail("lca_response_invalid");
    }
    print!("{output}");
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

fn required(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| fail("lca_client_configuration_missing"))
}

fn fail(code: &str) -> ! {
    eprintln!("{code}");
    std::process::exit(78);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_rejects_unexpected_server_uid() {
        let (client, _server) = UnixStream::pair().unwrap();
        let uid = unsafe { libc::geteuid() };
        assert!(verify_peer_uid(&client, uid).is_ok());
        assert!(verify_peer_uid(&client, uid.saturating_add(1)).is_err());
    }
}

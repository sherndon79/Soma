use soma_systemd_provider::{
    execute, Inventory, ProviderError, Request, SystemdSource, UnitSnapshot, CLOSURE_PROPERTIES,
    DEFINITION_PROPERTIES,
};
use std::collections::BTreeMap;
use std::fs::{read, read_to_string};
#[cfg(target_os = "linux")]
use std::io::Read;
use std::io::{self, BufRead, Write};
#[cfg(target_os = "linux")]
use std::net::Shutdown;
#[cfg(target_os = "linux")]
use std::os::fd::{AsRawFd, FromRawFd, RawFd};
#[cfg(target_os = "linux")]
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
#[cfg(target_os = "linux")]
use std::time::Duration;
use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::{OwnedObjectPath, OwnedValue};

const SYSTEMD_DESTINATION: &str = "org.freedesktop.systemd1";
const SYSTEMD_MANAGER_PATH: &str = "/org/freedesktop/systemd1";
const SYSTEMD_MANAGER_INTERFACE: &str = "org.freedesktop.systemd1.Manager";
const DBUS_PROPERTIES_INTERFACE: &str = "org.freedesktop.DBus.Properties";

fn main() {
    let inventory_path = std::env::var_os("SOMA_SYSTEMD_PROVIDER_INVENTORY")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("config/systemd-provider-inventory.json"));
    let inventory = match load_inventory(&inventory_path) {
        Ok(inventory) => inventory,
        Err(code) => {
            eprintln!("{code}");
            std::process::exit(78);
        }
    };
    let source = match DbusSystemdSource::connect() {
        Ok(source) => source,
        Err(_) => {
            eprintln!("provider_system_bus_unavailable");
            std::process::exit(69);
        }
    };

    if std::env::args().any(|argument| argument == "--socket-activated") {
        run_socket_activated(&inventory, &source);
        return;
    }

    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    serve_lines(stdin.lock(), &mut stdout, &inventory, &source);
}

fn serve_lines(
    reader: impl BufRead,
    writer: &mut impl Write,
    inventory: &Inventory,
    source: &impl SystemdSource,
) {
    for line in reader.lines() {
        let Ok(line) = line else {
            break;
        };
        if line.len() > 16 * 1024 {
            write_protocol_error(writer, "", "provider_request_invalid");
            continue;
        }
        let request = match serde_json::from_str::<Request>(&line) {
            Ok(request) => request,
            Err(_) => {
                write_protocol_error(writer, "", "provider_request_invalid");
                continue;
            }
        };
        let response = execute(inventory, &request, source);
        if serde_json::to_writer(&mut *writer, &response).is_err()
            || writer.write_all(b"\n").is_err()
            || writer.flush().is_err()
        {
            break;
        }
    }
}

#[cfg(target_os = "linux")]
fn run_socket_activated(inventory: &Inventory, source: &impl SystemdSource) {
    let expected_uid = match expected_harness_uid() {
        Ok(uid) => uid,
        Err(code) => {
            eprintln!("{code}");
            std::process::exit(78);
        }
    };
    let listener = match activated_listener() {
        Ok(listener) => listener,
        Err(code) => {
            eprintln!("{code}");
            std::process::exit(78);
        }
    };
    for connection in listener.incoming() {
        let Ok(mut stream) = connection else {
            continue;
        };
        if verify_peer(&stream, expected_uid).is_err() {
            reject_unauthorized_peer(&mut stream);
            continue;
        }
        let Ok(reader_stream) = stream.try_clone() else {
            continue;
        };
        serve_lines(
            io::BufReader::new(reader_stream),
            &mut stream,
            inventory,
            source,
        );
    }
}

#[cfg(not(target_os = "linux"))]
fn run_socket_activated(_inventory: &Inventory, _source: &impl SystemdSource) {
    eprintln!("provider_socket_activation_unsupported");
    std::process::exit(78);
}

#[cfg(target_os = "linux")]
fn reject_unauthorized_peer(stream: &mut UnixStream) {
    // Consume one bounded request without parsing it so a normal one-shot client receives a FIN
    // rather than an RST caused by closing with unread socket data.
    let _ = stream.set_read_timeout(Some(Duration::from_millis(250)));
    let mut remaining = 16 * 1024;
    let mut buffer = [0_u8; 1024];
    while remaining > 0 {
        let length = buffer.len().min(remaining);
        match stream.read(&mut buffer[..length]) {
            Ok(0) => break,
            Ok(read) => {
                remaining -= read;
                if buffer[..read].contains(&b'\n') {
                    break;
                }
            }
            Err(error)
                if error.kind() == io::ErrorKind::WouldBlock
                    || error.kind() == io::ErrorKind::TimedOut =>
            {
                break;
            }
            Err(_) => break,
        }
    }
    write_protocol_error(stream, "", "provider_peer_unauthorized");
    let _ = stream.shutdown(Shutdown::Write);
}

#[cfg(target_os = "linux")]
fn expected_harness_uid() -> Result<libc::uid_t, &'static str> {
    let raw = std::env::var("SOMA_SYSTEMD_PROVIDER_EXPECTED_UID")
        .map_err(|_| "provider_expected_uid_missing")?;
    let uid = raw
        .parse::<libc::uid_t>()
        .map_err(|_| "provider_expected_uid_invalid")?;
    if uid == 0 {
        return Err("provider_expected_uid_invalid");
    }
    Ok(uid)
}

#[cfg(target_os = "linux")]
fn activated_listener() -> Result<UnixListener, &'static str> {
    let listen_pid = std::env::var("LISTEN_PID")
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .ok_or("provider_socket_activation_invalid")?;
    let listen_fds = std::env::var("LISTEN_FDS")
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .ok_or("provider_socket_activation_invalid")?;
    if listen_pid != std::process::id() || listen_fds != 1 {
        return Err("provider_socket_activation_invalid");
    }
    // systemd's socket activation contract assigns the first descriptor as fd 3.
    Ok(unsafe { UnixListener::from_raw_fd(3) })
}

#[cfg(target_os = "linux")]
fn verify_peer(stream: &UnixStream, expected_uid: libc::uid_t) -> Result<(), &'static str> {
    let fd = stream.as_raw_fd();
    let mut credentials = libc::ucred {
        pid: 0,
        uid: 0,
        gid: 0,
    };
    let mut credentials_len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    let result = unsafe {
        libc::getsockopt(
            fd,
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&mut credentials as *mut libc::ucred).cast(),
            &mut credentials_len,
        )
    };
    if result != 0
        || credentials_len as usize != std::mem::size_of::<libc::ucred>()
        || credentials.uid != expected_uid
        || credentials.pid <= 0
    {
        return Err("provider_peer_unauthorized");
    }

    // SO_PEERPIDFD (Linux >= 6.5) pins the peer against pid reuse. The dedicated uid remains the
    // decisive gate, so kernels that return ENOPROTOOPT still fail neither open nor broader.
    if let Some(peer_pidfd) = optional_peer_pidfd(fd)? {
        unsafe {
            libc::close(peer_pidfd);
        }
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn optional_peer_pidfd(fd: RawFd) -> Result<Option<RawFd>, &'static str> {
    const SO_PEERPIDFD: libc::c_int = 77;
    let mut peer_pidfd: libc::c_int = -1;
    let mut peer_pidfd_len = std::mem::size_of::<libc::c_int>() as libc::socklen_t;
    let result = unsafe {
        libc::getsockopt(
            fd,
            libc::SOL_SOCKET,
            SO_PEERPIDFD,
            (&mut peer_pidfd as *mut libc::c_int).cast(),
            &mut peer_pidfd_len,
        )
    };
    if result == 0 {
        if peer_pidfd < 0 || peer_pidfd_len as usize != std::mem::size_of::<libc::c_int>() {
            return Err("provider_peer_unauthorized");
        }
        return Ok(Some(peer_pidfd));
    }
    let error = io::Error::last_os_error().raw_os_error();
    if error == Some(libc::ENOPROTOOPT) || error == Some(libc::EINVAL) {
        return Ok(None);
    }
    Err("provider_peer_unauthorized")
}

#[cfg(all(test, target_os = "linux"))]
mod socket_tests {
    use super::{reject_unauthorized_peer, verify_peer};
    use std::io::{Read, Write};
    use std::net::Shutdown;
    use std::os::unix::net::UnixStream;
    use std::thread;

    #[test]
    fn peercred_accepts_only_the_decisive_expected_uid() {
        let (client, server) = UnixStream::pair().expect("unix pair");
        let current_uid = unsafe { libc::geteuid() };
        verify_peer(&server, current_uid).expect("matching dedicated uid");
        assert_eq!(
            verify_peer(&client, current_uid.saturating_add(1)),
            Err("provider_peer_unauthorized")
        );
    }

    #[test]
    fn rejected_peer_receives_protocol_error_and_clean_eof() {
        let (mut client, mut server) = UnixStream::pair().expect("unix pair");
        let worker = thread::spawn(move || reject_unauthorized_peer(&mut server));
        client
            .write_all(b"{\"request_id\":\"root-probe\"}\n")
            .expect("write request");
        client
            .shutdown(Shutdown::Write)
            .expect("half close request");
        let mut response = String::new();
        client
            .read_to_string(&mut response)
            .expect("clean response eof");
        worker.join().expect("reject worker");
        assert!(response.ends_with('\n'));
        assert!(response.contains("\"code\":\"provider_peer_unauthorized\""));
    }
}

fn load_inventory(path: &Path) -> Result<Inventory, &'static str> {
    let metadata = path
        .symlink_metadata()
        .map_err(|_| "provider_inventory_unavailable")?;
    if metadata.file_type().is_symlink() || metadata.len() > 64 * 1024 {
        return Err("provider_inventory_invalid");
    }
    let raw = read_to_string(path).map_err(|_| "provider_inventory_unavailable")?;
    serde_json::from_str(&raw).map_err(|_| "provider_inventory_invalid")
}

fn write_protocol_error(writer: &mut impl Write, request_id: &str, code: &str) {
    let value = serde_json::json!({
        "request_id": request_id,
        "ok": false,
        "error": {
            "code": code,
            "ambiguous": false
        }
    });
    let _ = serde_json::to_writer(&mut *writer, &value);
    let _ = writer.write_all(b"\n");
    let _ = writer.flush();
}

struct DbusSystemdSource {
    connection: Connection,
}

impl DbusSystemdSource {
    fn connect() -> zbus::Result<Self> {
        Ok(Self {
            connection: Connection::system()?,
        })
    }

    fn manager(&self) -> zbus::Result<Proxy<'_>> {
        Proxy::new(
            &self.connection,
            SYSTEMD_DESTINATION,
            SYSTEMD_MANAGER_PATH,
            SYSTEMD_MANAGER_INTERFACE,
        )
    }

    fn unit_path(&self, unit_name: &str) -> Result<OwnedObjectPath, ProviderError> {
        self.manager()
            .and_then(|proxy| proxy.call("GetUnit", &(unit_name)))
            .map_err(|_| ProviderError::new("service_status_unavailable", false))
    }

    fn get_property<T>(
        &self,
        path: &OwnedObjectPath,
        interface: &str,
        property: &str,
    ) -> Result<T, ProviderError>
    where
        T: TryFrom<OwnedValue>,
    {
        let proxy = Proxy::new(
            &self.connection,
            SYSTEMD_DESTINATION,
            path.as_str(),
            DBUS_PROPERTIES_INTERFACE,
        )
        .map_err(|_| ProviderError::new("service_status_unavailable", false))?;
        let value: OwnedValue = proxy
            .call("Get", &(interface, property))
            .map_err(|_| ProviderError::new("service_unit_definition_unsupported", false))?;
        T::try_from(value)
            .map_err(|_| ProviderError::new("service_unit_definition_unsupported", false))
    }

    fn property_json(
        &self,
        path: &OwnedObjectPath,
        interface: &str,
        property: &str,
    ) -> Result<String, ProviderError> {
        let proxy = Proxy::new(
            &self.connection,
            SYSTEMD_DESTINATION,
            path.as_str(),
            DBUS_PROPERTIES_INTERFACE,
        )
        .map_err(|_| ProviderError::new("service_status_unavailable", false))?;
        let value: OwnedValue = proxy
            .call("Get", &(interface, property))
            .map_err(|_| ProviderError::new("service_unit_definition_unsupported", false))?;
        Ok(format!("{value:?}"))
    }
}

impl SystemdSource for DbusSystemdSource {
    fn inspect(&self, unit_name: &str) -> Result<UnitSnapshot, ProviderError> {
        let path = self.unit_path(unit_name)?;
        let unit_interface = "org.freedesktop.systemd1.Unit";
        let service_interface = "org.freedesktop.systemd1.Service";
        let fragment_path: String = self.get_property(&path, unit_interface, "FragmentPath")?;
        let drop_in_paths: Vec<String> = self.get_property(&path, unit_interface, "DropInPaths")?;

        let mut definition_properties = BTreeMap::new();
        for property in DEFINITION_PROPERTIES {
            definition_properties.insert(
                (*property).to_string(),
                self.property_json(&path, service_interface, property)?,
            );
        }
        let mut closure_properties = BTreeMap::new();
        for property in CLOSURE_PROPERTIES {
            let values: Vec<String> = self.get_property(&path, unit_interface, property)?;
            closure_properties.insert((*property).to_string(), values);
        }

        let bus_name: String = self.get_property(&path, service_interface, "BusName")?;
        let dbus_activated = !bus_name.is_empty();
        let triggered_by = closure_properties
            .get("TriggeredBy")
            .cloned()
            .unwrap_or_default();
        let socket_activated = triggered_by.iter().any(|unit| unit.ends_with(".socket"));
        Ok(UnitSnapshot {
            load_state: self.get_property(&path, unit_interface, "LoadState")?,
            active_state: self.get_property(&path, unit_interface, "ActiveState")?,
            sub_state: self.get_property(&path, unit_interface, "SubState")?,
            unit_file_state: self.get_property(&path, unit_interface, "UnitFileState")?,
            can_start: self.get_property(&path, unit_interface, "CanStart")?,
            invocation_id: self.get_property(&path, unit_interface, "InvocationID")?,
            active_enter_timestamp_monotonic: self.get_property(
                &path,
                unit_interface,
                "ActiveEnterTimestampMonotonic",
            )?,
            definition_properties,
            fragment_contents: bounded_file_contents(&fragment_path)?,
            drop_in_contents: bounded_drop_in_contents(&drop_in_paths)?,
            closure_properties,
            socket_activated,
            dbus_activated,
        })
    }

    fn restart(&self, unit_name: &str) -> Result<(), ProviderError> {
        let manager = self
            .manager()
            .map_err(|_| ProviderError::new("service_restart_provider_refused", false))?;
        let result: zbus::Result<OwnedObjectPath> =
            manager.call("RestartUnit", &(unit_name, "replace"));
        result
            .map(|_| ())
            .map_err(|_| ProviderError::new("service_restart_outcome_unknown", true))
    }
}

fn bounded_file_contents(path: &str) -> Result<Vec<u8>, ProviderError> {
    if path.is_empty() {
        return Err(ProviderError::new(
            "service_unit_definition_unsupported",
            false,
        ));
    }
    let metadata = Path::new(path)
        .symlink_metadata()
        .map_err(|_| ProviderError::new("service_unit_definition_unsupported", false))?;
    if metadata.file_type().is_symlink() || metadata.len() > 256 * 1024 {
        return Err(ProviderError::new(
            "service_unit_definition_unsupported",
            false,
        ));
    }
    read(path).map_err(|_| ProviderError::new("service_unit_definition_unsupported", false))
}

fn bounded_drop_in_contents(paths: &[String]) -> Result<BTreeMap<String, Vec<u8>>, ProviderError> {
    if paths.len() > 32 {
        return Err(ProviderError::new(
            "service_unit_definition_unsupported",
            false,
        ));
    }
    let mut result = BTreeMap::new();
    for path in paths {
        result.insert(path.clone(), bounded_file_contents(path)?);
    }
    Ok(result)
}

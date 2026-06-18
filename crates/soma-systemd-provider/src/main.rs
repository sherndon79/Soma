use soma_systemd_provider::{
    execute, Inventory, ProviderError, Request, SystemdSource, UnitSnapshot, CLOSURE_PROPERTIES,
    DEFINITION_PROPERTIES,
};
use std::collections::BTreeMap;
use std::fs::{read, read_to_string};
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
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

    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else {
            break;
        };
        if line.len() > 16 * 1024 {
            write_protocol_error(&mut stdout, "", "provider_request_invalid");
            continue;
        }
        let request = match serde_json::from_str::<Request>(&line) {
            Ok(request) => request,
            Err(_) => {
                write_protocol_error(&mut stdout, "", "provider_request_invalid");
                continue;
            }
        };
        let response = execute(&inventory, &request, &source);
        if serde_json::to_writer(&mut stdout, &response).is_err()
            || stdout.write_all(b"\n").is_err()
            || stdout.flush().is_err()
        {
            break;
        }
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

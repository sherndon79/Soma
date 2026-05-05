use std::env;
use std::path::Path;
use std::process::{Command, ExitCode};

fn main() -> ExitCode {
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        Some("inspect-environment") => {
            println!("{}", inspect_environment_json());
            ExitCode::SUCCESS
        }
        Some("inspect-atspi") => {
            println!("{}", inspect_atspi_json());
            ExitCode::SUCCESS
        }
        Some("help") | Some("--help") | None => {
            eprintln!("usage: soma-desktop-broker inspect-environment|inspect-atspi");
            ExitCode::SUCCESS
        }
        Some(command) => {
            eprintln!("unknown command: {command}");
            ExitCode::from(2)
        }
    }
}

fn inspect_environment_json() -> String {
    let desktop_session = env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
    let session_type = env::var("XDG_SESSION_TYPE").unwrap_or_default();
    let wayland_display_present = env::var("WAYLAND_DISPLAY").is_ok();
    let x11_display_present = env::var("DISPLAY").is_ok();
    let dbus_session_bus_available = env::var("DBUS_SESSION_BUS_ADDRESS").is_ok();
    let gdbus = command_exists("gdbus");
    let busctl = command_exists("busctl");
    let qdbus = command_exists("qdbus");
    let wtype = command_exists("wtype");
    let ydotool = command_exists("ydotool");
    let atspi_likely_available =
        dbus_session_bus_available && (wayland_display_present || x11_display_present);
    let desktop_lower = desktop_session.to_lowercase();
    let kde_kwin = desktop_lower.contains("kde") && (qdbus || busctl);

    format!(
        concat!(
            "{{",
            "\"mode\":\"read_only_environment_probe\",",
            "\"broker_source\":\"rust_helper\",",
            "\"platform\":\"{}\",",
            "\"release\":\"{}\",",
            "\"desktop_session\":\"{}\",",
            "\"session_type\":\"{}\",",
            "\"wayland_display_present\":{},",
            "\"x11_display_present\":{},",
            "\"dbus_session_bus_available\":{},",
            "\"atspi_likely_available\":{},",
            "\"candidate_adapters\":{{",
            "\"atspi_dbus\":{},",
            "\"kde_kwin\":{},",
            "\"xdg_desktop_portal\":{},",
            "\"wayland_keyboard_input\":{},",
            "\"uinput_input\":{}",
            "}},",
            "\"commands\":{{",
            "\"gdbus\":{},",
            "\"busctl\":{},",
            "\"qdbus\":{},",
            "\"wtype\":{},",
            "\"ydotool\":{}",
            "}},",
            "\"tree\":null,",
            "\"tree_available\":false",
            "}}"
        ),
        json_escape(env::consts::OS),
        json_escape(&kernel_release()),
        json_escape(&desktop_session),
        json_escape(&session_type),
        wayland_display_present,
        x11_display_present,
        dbus_session_bus_available,
        atspi_likely_available,
        gdbus || busctl,
        kde_kwin,
        dbus_session_bus_available,
        wtype,
        ydotool,
        gdbus,
        busctl,
        qdbus,
        wtype,
        ydotool,
    )
}

fn inspect_atspi_json() -> String {
    let desktop_session = env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
    let session_type = env::var("XDG_SESSION_TYPE").unwrap_or_default();
    let dbus_session_bus_available = env::var("DBUS_SESSION_BUS_ADDRESS").is_ok();

    if !command_exists("busctl") {
        return atspi_unavailable_json(
            &desktop_session,
            &session_type,
            dbus_session_bus_available,
            "busctl_not_found",
            "",
        );
    }

    let address_output = Command::new("busctl")
        .args([
            "--user",
            "call",
            "org.a11y.Bus",
            "/org/a11y/bus",
            "org.a11y.Bus",
            "GetAddress",
        ])
        .output();
    let address_output = match address_output {
        Ok(output) if output.status.success() => output,
        Ok(output) => {
            return atspi_unavailable_json(
                &desktop_session,
                &session_type,
                dbus_session_bus_available,
                "atspi_bus_address_unavailable",
                &command_error(&output),
            );
        }
        Err(error) => {
            return atspi_unavailable_json(
                &desktop_session,
                &session_type,
                dbus_session_bus_available,
                "atspi_bus_address_command_failed",
                &error.to_string(),
            );
        }
    };

    let address_stdout = String::from_utf8_lossy(&address_output.stdout);
    let Some(address) = parse_busctl_string(&address_stdout) else {
        return atspi_unavailable_json(
            &desktop_session,
            &session_type,
            dbus_session_bus_available,
            "atspi_bus_address_parse_failed",
            &address_stdout,
        );
    };

    let list_output = Command::new("busctl")
        .args(["--address", &address, "list", "--no-legend", "--no-pager"])
        .output();
    let list_output = match list_output {
        Ok(output) if output.status.success() => output,
        Ok(output) => {
            return atspi_unavailable_json(
                &desktop_session,
                &session_type,
                dbus_session_bus_available,
                "atspi_bus_list_unavailable",
                &command_error(&output),
            );
        }
        Err(error) => {
            return atspi_unavailable_json(
                &desktop_session,
                &session_type,
                dbus_session_bus_available,
                "atspi_bus_list_command_failed",
                &error.to_string(),
            );
        }
    };

    let list_stdout = String::from_utf8_lossy(&list_output.stdout);
    let applications = parse_atspi_bus_list(&list_stdout, 64)
        .into_iter()
        .map(|application| application.with_root_object(&address))
        .collect::<Vec<_>>();
    let root_object_count = applications
        .iter()
        .filter(|application| application.root_object_available())
        .count();
    let applications_json = applications
        .iter()
        .map(|application| application.to_json())
        .collect::<Vec<_>>()
        .join(",");

    format!(
        concat!(
            "{{",
            "\"mode\":\"read_only_atspi_probe\",",
            "\"broker_source\":\"rust_helper\",",
            "\"platform\":\"{}\",",
            "\"release\":\"{}\",",
            "\"desktop_session\":\"{}\",",
            "\"session_type\":\"{}\",",
            "\"dbus_session_bus_available\":{},",
            "\"atspi_likely_available\":true,",
            "\"atspi_bus_address_available\":true,",
            "\"application_count\":{},",
            "\"root_object_available_count\":{},",
            "\"window_count\":0,",
            "\"tree\":{{",
            "\"applications\":[{}],",
            "\"windows\":[],",
            "\"bounded\":true,",
            "\"text_content_included\":false",
            "}},",
            "\"tree_available\":true",
            "}}"
        ),
        json_escape(env::consts::OS),
        json_escape(&kernel_release()),
        json_escape(&desktop_session),
        json_escape(&session_type),
        dbus_session_bus_available,
        applications.len(),
        root_object_count,
        applications_json,
    )
}

fn atspi_unavailable_json(
    desktop_session: &str,
    session_type: &str,
    dbus_session_bus_available: bool,
    unavailable_reason: &str,
    diagnostic: &str,
) -> String {
    format!(
        concat!(
            "{{",
            "\"mode\":\"read_only_atspi_probe\",",
            "\"broker_source\":\"rust_helper\",",
            "\"platform\":\"{}\",",
            "\"release\":\"{}\",",
            "\"desktop_session\":\"{}\",",
            "\"session_type\":\"{}\",",
            "\"dbus_session_bus_available\":{},",
            "\"atspi_likely_available\":{},",
            "\"atspi_bus_address_available\":false,",
            "\"application_count\":0,",
            "\"root_object_available_count\":0,",
            "\"window_count\":0,",
            "\"tree\":null,",
            "\"tree_available\":false,",
            "\"unavailable_reason\":\"{}\",",
            "\"diagnostic\":\"{}\"",
            "}}"
        ),
        json_escape(env::consts::OS),
        json_escape(&kernel_release()),
        json_escape(desktop_session),
        json_escape(session_type),
        dbus_session_bus_available,
        dbus_session_bus_available,
        json_escape(unavailable_reason),
        json_escape(diagnostic),
    )
}

fn kernel_release() -> String {
    Command::new("uname")
        .arg("-r")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|release| release.trim().to_string())
        .unwrap_or_default()
}

fn command_exists(name: &str) -> bool {
    env::var_os("PATH")
        .map(|paths| {
            env::split_paths(&paths).any(|directory| Path::new(&directory).join(name).is_file())
        })
        .unwrap_or(false)
}

struct AtspiApplication {
    service: String,
    pid: Option<u32>,
    process: String,
    registry: bool,
    root_object: Option<AtspiRootObject>,
    root_object_error: Option<String>,
}

impl AtspiApplication {
    fn with_root_object(mut self, address: &str) -> Self {
        if !self.service.starts_with(':') {
            return self;
        }

        match inspect_root_object(address, &self.service) {
            Ok(root_object) => {
                self.root_object = Some(root_object);
            }
            Err(error) => {
                self.root_object_error = Some(error);
            }
        }
        self
    }

    fn root_object_available(&self) -> bool {
        self.root_object.is_some()
    }

    fn to_json(&self) -> String {
        let root_object_json = self
            .root_object
            .as_ref()
            .map(|root_object| root_object.to_json())
            .unwrap_or_else(|| "null".to_string());
        let root_object_error_json = self
            .root_object_error
            .as_ref()
            .map(|error| format!("\"{}\"", json_escape(error)))
            .unwrap_or_else(|| "null".to_string());

        format!(
            concat!(
                "{{",
                "\"service\":\"{}\",",
                "\"pid\":{},",
                "\"process\":\"{}\",",
                "\"registry\":{},",
                "\"root_object\":{},",
                "\"root_object_error\":{}",
                "}}"
            ),
            json_escape(&self.service),
            self.pid
                .map(|pid| pid.to_string())
                .unwrap_or_else(|| "null".to_string()),
            json_escape(&self.process),
            self.registry,
            root_object_json,
            root_object_error_json,
        )
    }
}

struct AtspiRootObject {
    name: String,
    role: String,
    child_count: i32,
    children_sample: Vec<AtspiObjectRef>,
}

impl AtspiRootObject {
    fn to_json(&self) -> String {
        let children_json = self
            .children_sample
            .iter()
            .map(|child| child.to_json())
            .collect::<Vec<_>>()
            .join(",");
        format!(
            concat!(
                "{{",
                "\"path\":\"/org/a11y/atspi/accessible/root\",",
                "\"name\":\"{}\",",
                "\"role\":\"{}\",",
                "\"child_count\":{},",
                "\"children_sample\":[{}]",
                "}}"
            ),
            json_escape(&self.name),
            json_escape(&self.role),
            self.child_count,
            children_json,
        )
    }
}

struct AtspiObjectRef {
    service: String,
    path: String,
}

impl AtspiObjectRef {
    fn to_json(&self) -> String {
        format!(
            "{{\"service\":\"{}\",\"path\":\"{}\"}}",
            json_escape(&self.service),
            json_escape(&self.path),
        )
    }
}

fn parse_atspi_bus_list(value: &str, limit: usize) -> Vec<AtspiApplication> {
    value
        .lines()
        .filter_map(parse_atspi_bus_list_line)
        .take(limit)
        .collect()
}

fn parse_atspi_bus_list_line(line: &str) -> Option<AtspiApplication> {
    let mut fields = line.split_whitespace();
    let service = fields.next()?.to_string();
    let pid = fields.next().and_then(|pid| {
        if pid == "-" {
            None
        } else {
            pid.parse::<u32>().ok()
        }
    });
    let process = fields.next().unwrap_or("").to_string();
    let registry = service == "org.a11y.atspi.Registry";

    Some(AtspiApplication {
        service,
        pid,
        process,
        registry,
        root_object: None,
        root_object_error: None,
    })
}

fn inspect_root_object(address: &str, service: &str) -> Result<AtspiRootObject, String> {
    const ROOT_PATH: &str = "/org/a11y/atspi/accessible/root";
    const ACCESSIBLE_INTERFACE: &str = "org.a11y.atspi.Accessible";

    let name_output = busctl_output(&[
        "--address",
        address,
        "get-property",
        service,
        ROOT_PATH,
        ACCESSIBLE_INTERFACE,
        "Name",
    ])?;
    let role_output = busctl_output(&[
        "--address",
        address,
        "call",
        service,
        ROOT_PATH,
        ACCESSIBLE_INTERFACE,
        "GetRoleName",
    ])?;
    let child_count_output = busctl_output(&[
        "--address",
        address,
        "get-property",
        service,
        ROOT_PATH,
        ACCESSIBLE_INTERFACE,
        "ChildCount",
    ])?;
    let children_output = busctl_output(&[
        "--address",
        address,
        "call",
        service,
        ROOT_PATH,
        ACCESSIBLE_INTERFACE,
        "GetChildren",
    ])
    .unwrap_or_default();

    Ok(AtspiRootObject {
        name: parse_busctl_string(&name_output).unwrap_or_default(),
        role: parse_busctl_string(&role_output).unwrap_or_default(),
        child_count: parse_busctl_int(&child_count_output).unwrap_or(0),
        children_sample: parse_atspi_object_refs(&children_output, 8),
    })
}

fn busctl_output(args: &[&str]) -> Result<String, String> {
    let output = Command::new("busctl")
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(command_error(&output));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn parse_busctl_string(value: &str) -> Option<String> {
    let first_quote = value.find('"')?;
    let mut escaped = false;
    let mut result = String::new();
    for character in value[first_quote + 1..].chars() {
        if escaped {
            result.push(character);
            escaped = false;
            continue;
        }
        match character {
            '\\' => escaped = true,
            '"' => return Some(result),
            character => result.push(character),
        }
    }
    None
}

fn parse_busctl_int(value: &str) -> Option<i32> {
    value
        .split_whitespace()
        .find_map(|field| field.parse::<i32>().ok())
}

fn parse_atspi_object_refs(value: &str, limit: usize) -> Vec<AtspiObjectRef> {
    let strings = parse_quoted_strings(value);
    strings
        .chunks(2)
        .filter_map(|chunk| {
            let service = chunk.first()?;
            let path = chunk.get(1)?;
            Some(AtspiObjectRef {
                service: service.clone(),
                path: path.clone(),
            })
        })
        .take(limit)
        .collect()
}

fn parse_quoted_strings(value: &str) -> Vec<String> {
    let mut strings = Vec::new();
    let mut current = String::new();
    let mut in_string = false;
    let mut escaped = false;

    for character in value.chars() {
        if !in_string {
            if character == '"' {
                in_string = true;
                current.clear();
            }
            continue;
        }

        if escaped {
            current.push(character);
            escaped = false;
            continue;
        }

        match character {
            '\\' => escaped = true,
            '"' => {
                strings.push(current.clone());
                in_string = false;
            }
            character => current.push(character),
        }
    }

    strings
}

fn command_error(output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let combined = format!("{} {}", stderr.trim(), stdout.trim());
    combined.trim().to_string()
}

fn json_escape(value: &str) -> String {
    let mut escaped = String::new();
    for character in value.chars() {
        match character {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            character if character.is_control() => {
                escaped.push_str(&format!("\\u{:04x}", character as u32));
            }
            character => escaped.push(character),
        }
    }
    escaped
}

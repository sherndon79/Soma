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
    let applications = parse_atspi_bus_list(&list_stdout, 64);
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
}

impl AtspiApplication {
    fn to_json(&self) -> String {
        format!(
            concat!(
                "{{",
                "\"service\":\"{}\",",
                "\"pid\":{},",
                "\"process\":\"{}\",",
                "\"registry\":{}",
                "}}"
            ),
            json_escape(&self.service),
            self.pid
                .map(|pid| pid.to_string())
                .unwrap_or_else(|| "null".to_string()),
            json_escape(&self.process),
            self.registry,
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
    })
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

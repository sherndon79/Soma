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
        Some("help") | Some("--help") | None => {
            eprintln!("usage: soma-desktop-broker inspect-environment");
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

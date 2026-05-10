use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

#[test]
fn traversal_command_remains_disabled_with_valid_args() {
    let fake_busctl = FakeBusctl::new("poison");
    let mut command = traversal_command_with_valid_args();
    fake_busctl.prepend_to_path(&mut command);
    let output = command
        .output()
        .expect("run soma-desktop-broker traversal command");

    assert_eq!(output.status.code(), Some(2));
    assert_eq!(String::from_utf8_lossy(&output.stdout), "");
    assert_eq!(
        String::from_utf8_lossy(&output.stderr).trim(),
        "inspect-atspi-traversal is not implemented",
    );
    assert!(!fake_busctl.was_invoked());
}

#[test]
fn traversal_command_rejects_malformed_args_without_json() {
    let output = Command::new(env!("CARGO_BIN_EXE_soma-desktop-broker"))
        .args(["inspect-atspi-traversal", "--root-ref", "desktop-ref-1"])
        .output()
        .expect("run soma-desktop-broker traversal command");

    assert_eq!(output.status.code(), Some(2));
    assert_eq!(String::from_utf8_lossy(&output.stdout), "");
    assert_eq!(
        String::from_utf8_lossy(&output.stderr).trim(),
        "unknown inspect-atspi-traversal option: --root-ref",
    );
}

fn traversal_command_with_valid_args() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_soma-desktop-broker"));
    command.args([
        "inspect-atspi-traversal",
        "--root-service",
        ":1.42",
        "--root-path",
        "/org/a11y/atspi/accessible/root",
        "--max-depth",
        "2",
        "--max-nodes",
        "64",
        "--max-children-per-node",
        "8",
    ]);
    command
}

struct FakeBusctl {
    temp_dir: PathBuf,
    log_path: PathBuf,
}

impl FakeBusctl {
    fn new(mode: &str) -> Self {
        let temp_dir = env::temp_dir().join(format!(
            "soma-fake-busctl-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        ));
        fs::create_dir(&temp_dir).expect("create fake busctl temp dir");
        let log_path = temp_dir.join("busctl.log");
        let busctl_path = temp_dir.join("busctl");
        fs::write(&busctl_path, fake_busctl_script(mode)).expect("write fake busctl");
        #[cfg(unix)]
        {
            let mut permissions = fs::metadata(&busctl_path)
                .expect("fake busctl metadata")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&busctl_path, permissions).expect("chmod fake busctl");
        }
        Self { temp_dir, log_path }
    }

    fn prepend_to_path(&self, command: &mut Command) {
        let current_path = env::var_os("PATH").unwrap_or_default();
        let path = env::join_paths(
            std::iter::once(self.temp_dir.as_os_str().to_owned())
                .chain(env::split_paths(&current_path).map(|path| path.into_os_string())),
        )
        .expect("join fake busctl PATH");
        command.env("PATH", path);
        command.env("SOMA_FAKE_BUSCTL_LOG", &self.log_path);
    }

    fn was_invoked(&self) -> bool {
        self.log_path.exists()
    }
}

impl Drop for FakeBusctl {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.temp_dir);
    }
}

fn fake_busctl_script(mode: &str) -> String {
    format!(
        r#"#!/bin/sh
set -eu
printf '%s\n' "$*" >> "${{SOMA_FAKE_BUSCTL_LOG:?}}"

mode={mode}
if [ "$mode" = "poison" ]; then
  echo "fake busctl should not be invoked" >&2
  exit 99
fi

if [ "$1" = "--user" ] && [ "$2" = "call" ] && [ "$6" = "GetAddress" ]; then
  if [ "$mode" = "unavailable" ]; then
    exit 1
  fi
  printf '%s\n' 's "unix:path=/tmp/fake-atspi"'
  exit 0
fi

method="${{7:-}}"
path="${{5:-}}"
case "$method:$path" in
  GetRoleName:/org/a11y/atspi/accessible/root)
    printf '%s\n' 's "application"'
    ;;
  ChildCount:/org/a11y/atspi/accessible/root)
    printf '%s\n' 'i 1'
    ;;
  GetChildren:/org/a11y/atspi/accessible/root)
    printf '%s\n' 'a(so) 1 ":1.42" "/org/a11y/atspi/accessible/1"'
    ;;
  GetRoleName:/org/a11y/atspi/accessible/1)
    printf '%s\n' 's "frame"'
    ;;
  ChildCount:/org/a11y/atspi/accessible/1)
    printf '%s\n' 'i 0'
    ;;
  GetChildren:/org/a11y/atspi/accessible/1)
    printf '%s\n' 'a(so) 0'
    ;;
  *)
    echo "unexpected fake busctl invocation: $*" >&2
    exit 98
    ;;
esac
"#,
    )
}

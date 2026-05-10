use std::process::Command;

#[test]
fn traversal_command_remains_disabled_with_valid_args() {
    let output = Command::new(env!("CARGO_BIN_EXE_soma-desktop-broker"))
        .args([
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
        ])
        .output()
        .expect("run soma-desktop-broker traversal command");

    assert_eq!(output.status.code(), Some(2));
    assert_eq!(String::from_utf8_lossy(&output.stdout), "");
    assert_eq!(
        String::from_utf8_lossy(&output.stderr).trim(),
        "inspect-atspi-traversal is not implemented",
    );
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

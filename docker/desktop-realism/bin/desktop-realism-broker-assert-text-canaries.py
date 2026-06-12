#!/usr/bin/env python3
import json
import os
import subprocess
import sys

MANIFEST_PATH = os.environ.get("CANARY_MANIFEST", "/opt/soma/desktop-realism/canary-manifest.json")
BROKER = os.environ.get("SOMA_DESKTOP_BROKER", "/usr/local/bin/soma-desktop-broker")
SESSION_BUS_FILE = "/tmp/soma-session-bus-address"
MIN_TEXT_CANARIES = int(os.environ.get("DESKTOP_REALISM_MIN_TEXT_CANARIES", "4"))
FORBIDDEN_EXACT_KEYS = {
    "screenshot",
    "screenshot_bytes",
    "screenshot_base64",
    "pixels",
    "pixel_data",
    "pid",
    "process",
    "process_name",
    "registry",
    "service",
    "path",
    "states",
    "actions",
    "pointer",
    "keyboard",
    "actuation",
    "platform",
    "release",
    "desktop_session",
    "session_type",
}


def main():
    if os.environ.get("DESKTOP_REALISM_SKIP_STRIP_ASSERT") != "1":
        run_command(["/usr/local/bin/desktop-realism-broker-assert-canaries.py"], broker_env())

    manifest = load_json(MANIFEST_PATH)
    text_output = run_command([BROKER, "inspect-text"], broker_env())
    inspection = parse_json(text_output)

    findings = []
    findings.extend(find_structural_errors(inspection))
    findings.extend(find_forbidden_field_leaks(inspection))
    findings.extend(find_missing_text_canaries(inspection, manifest["canaries"]))

    if findings:
        print("FAIL: broker inspect-text canary assertion found contract violations", file=sys.stderr)
        for finding in findings:
            print(json.dumps(finding, sort_keys=True), file=sys.stderr)
        print(text_output, file=sys.stderr)
        return 1

    print(
        "PASS: broker inspect-text output contains manifest canaries and no forbidden identity/control fields"
    )
    return 0


def load_json(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def broker_env():
    env = os.environ.copy()
    env.setdefault("DISPLAY", ":99")
    if not env.get("DBUS_SESSION_BUS_ADDRESS") and os.path.exists(SESSION_BUS_FILE):
        with open(SESSION_BUS_FILE, encoding="utf-8") as handle:
            env["DBUS_SESSION_BUS_ADDRESS"] = handle.read().strip()
    if not env.get("DBUS_SESSION_BUS_ADDRESS"):
        print("FAIL: private session DBus address is missing", file=sys.stderr)
        raise SystemExit(1)
    return env


def run_command(args, env):
    result = subprocess.run(
        args,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr, end="")
        raise SystemExit(result.returncode)
    return result.stdout


def parse_json(value):
    try:
        return json.loads(value)
    except json.JSONDecodeError as error:
        print(f"FAIL: broker output is not JSON: {error}", file=sys.stderr)
        print(value, file=sys.stderr)
        raise SystemExit(1)


def find_structural_errors(inspection):
    errors = []
    expected = {
        "mode": "read_only_desktop_text_probe",
        "broker_source": "rust_helper",
        "bounded": True,
        "identity_fields_included": False,
        "screenshots_included": False,
        "titles_included": True,
        "names_included": True,
        "descriptions_included": True,
        "text_content_included": True,
    }
    for key, expected_value in expected.items():
        if inspection.get(key) != expected_value:
            errors.append(
                {
                    "type": "unexpected_text_contract_value",
                    "path": key,
                    "expected": expected_value,
                    "value": inspection.get(key),
                }
            )
    if inspection.get("window_count", 0) < 1:
        errors.append({"type": "no_text_windows", "path": "window_count", "value": inspection.get("window_count")})
    if inspection.get("text_item_count", 0) < 1:
        errors.append(
            {"type": "no_text_items", "path": "text_item_count", "value": inspection.get("text_item_count")}
        )
    return errors


def find_forbidden_field_leaks(root):
    leaks = []
    for path, value in walk_json(root):
        if not isinstance(value, dict):
            continue
        for key in value:
            normalized = key.lower()
            if (
                normalized in FORBIDDEN_EXACT_KEYS
                or "raw_atspi" in normalized
            ):
                leaks.append(
                    {
                        "type": "forbidden_field_leak",
                        "field": key,
                        "path": f"{path}.{key}" if path else key,
                    }
                )
    return leaks


def find_missing_text_canaries(root, canaries):
    content_tokens = [
        canary["token"]
        for canary in canaries
        if canary.get("expected_present_in_steward_view") is True
        and canary.get("channel") != "process"
    ]
    found = []
    for path, value in walk_json(root):
        if not isinstance(value, str):
            continue
        for token in content_tokens:
            if token in value and token not in found:
                found.append(token)
    if len(found) >= MIN_TEXT_CANARIES:
        return []
    return [
        {
            "type": "insufficient_text_canary_egress",
            "found_count": len(found),
            "minimum": MIN_TEXT_CANARIES,
            "found_tokens": found,
        }
    ]


def walk_json(value, path="$"):
    yield path, value
    if isinstance(value, dict):
        for key, child in value.items():
            yield from walk_json(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from walk_json(child, f"{path}[{index}]")


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys
from collections import deque

MANIFEST_PATH = "/opt/soma/desktop-realism/canary-manifest.json"
BROKER_INSPECT = "/usr/local/bin/desktop-realism-broker-inspect"
SESSION_BUS_FILE = "/tmp/soma-session-bus-address"
FORBIDDEN_EXACT_KEYS = {
    "name",
    "description",
    "text",
    "title",
    "states",
    "actions",
    "value",
}


def main():
    manifest = load_json(MANIFEST_PATH)
    raw_findings = find_raw_atspi_canaries(manifest["canaries"])
    if raw_findings:
        print("FAIL: raw AT-SPI preflight did not find every manifest canary", file=sys.stderr)
        for finding in raw_findings:
            print(json.dumps(finding, sort_keys=True), file=sys.stderr)
        return 1

    broker_output = run_broker()
    inspection = parse_json(broker_output)

    token_leaks = find_token_leaks(inspection, manifest["canaries"])
    field_leaks = find_forbidden_field_leaks(inspection)
    structural_errors = find_structural_errors(inspection)

    findings = token_leaks + field_leaks + structural_errors
    if findings:
        print("FAIL: desktop broker canary assertion found leaks", file=sys.stderr)
        for finding in findings:
            print(json.dumps(finding, sort_keys=True), file=sys.stderr)
        print(broker_output, file=sys.stderr)
        return 1

    print(
        "PASS: broker inspect-atspi output contains no manifest canaries and no forbidden fields"
    )
    return 0


def load_json(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def find_raw_atspi_canaries(canaries):
    tokens = [
        canary["token"]
        for canary in canaries
        if canary.get("expected_present_in_steward_view") is True
    ]
    found = {token: [] for token in tokens}
    env = broker_env()
    address = atspi_address(env)
    services = atspi_application_services(address, env)

    for service in services:
        scan_raw_accessible_tree(address, service, found, env)

    return [
        {
            "type": "raw_atspi_canary_missing",
            "token": token,
            "expected": "present in raw AT-SPI name/description/text before broker stripping",
        }
        for token, locations in found.items()
        if not locations
    ]


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


def atspi_address(env):
    output = run_command(
        [
            "busctl",
            "--user",
            "call",
            "org.a11y.Bus",
            "/org/a11y/bus",
            "org.a11y.Bus",
            "GetAddress",
        ],
        env,
    )
    values = parse_busctl_strings(output)
    if not values:
        print("FAIL: AT-SPI bus address is unavailable", file=sys.stderr)
        raise SystemExit(1)
    return values[0]


def atspi_application_services(address, env):
    output = run_command(
        ["busctl", "--address", address, "list", "--no-legend", "--no-pager"],
        env,
    )
    services = []
    for line in output.splitlines():
        fields = line.split()
        if not fields:
            continue
        service = fields[0]
        if service.startswith(":") and service not in services:
            services.append(service)
    return services


def scan_raw_accessible_tree(address, service, found, env):
    queue = deque([(service, "/org/a11y/atspi/accessible/root", 0)])
    seen = set()
    max_nodes = 512
    max_depth = 8

    while queue and len(seen) < max_nodes:
        object_service, path, depth = queue.popleft()
        key = (object_service, path)
        if key in seen:
            continue
        seen.add(key)

        values = raw_accessible_values(address, object_service, path, env)
        for field, value in values:
            for token in found:
                if token in value:
                    found[token].append(
                        {
                            "service": object_service,
                            "path": path,
                            "field": field,
                        }
                    )

        if depth >= max_depth:
            continue
        for child in raw_children(address, object_service, path, env):
            queue.append((child["service"], child["path"], depth + 1))


def raw_accessible_values(address, service, path, env):
    values = []
    for field in ("Name", "Description"):
        output = run_command_or_none(
            [
                "busctl",
                "--address",
                address,
                "get-property",
                service,
                path,
                "org.a11y.atspi.Accessible",
                field,
            ],
            env,
        )
        if output:
            for value in parse_busctl_strings(output):
                values.append((field, value))

    character_count = raw_text_character_count(address, service, path, env)
    if character_count and character_count > 0:
        text_output = run_command_or_none(
            [
                "busctl",
                "--address",
                address,
                "call",
                service,
                path,
                "org.a11y.atspi.Text",
                "GetText",
                "ii",
                "0",
                str(character_count),
            ],
            env,
        )
        if text_output:
            for value in parse_busctl_strings(text_output):
                values.append(("Text.GetText", value))
    return values


def raw_text_character_count(address, service, path, env):
    output = run_command_or_none(
        [
            "busctl",
            "--address",
            address,
            "get-property",
            service,
            path,
            "org.a11y.atspi.Text",
            "CharacterCount",
        ],
        env,
    )
    if not output:
        return None
    match = re.search(r"\b(?:i|u)\s+(-?\d+)", output)
    if not match:
        return None
    return max(0, int(match.group(1)))


def raw_children(address, service, path, env):
    output = run_command_or_none(
        [
            "busctl",
            "--address",
            address,
            "call",
            service,
            path,
            "org.a11y.atspi.Accessible",
            "GetChildren",
        ],
        env,
    )
    if not output:
        return []
    strings = parse_busctl_strings(output)
    return [
        {"service": strings[index], "path": strings[index + 1]}
        for index in range(0, len(strings) - 1, 2)
    ]


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


def run_command_or_none(args, env):
    result = subprocess.run(
        args,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        env=env,
    )
    if result.returncode != 0:
        return None
    return result.stdout


def parse_busctl_strings(value):
    return [bytes(match, "utf-8").decode("unicode_escape") for match in re.findall(r'"((?:[^"\\]|\\.)*)"', value)]


def run_broker():
    result = subprocess.run(
        [BROKER_INSPECT],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
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


def find_token_leaks(root, canaries):
    leaks = []
    tokens = [
        canary["token"]
        for canary in canaries
        if canary.get("expected_present_in_steward_view") is True
    ]
    for path, value in walk_json(root):
        if isinstance(value, str):
            for token in tokens:
                if token in value:
                    leaks.append(
                        {
                            "type": "canary_token_leak",
                            "token": token,
                            "path": path,
                            "value": value,
                        }
                    )
    return leaks


def find_forbidden_field_leaks(root):
    leaks = []
    for path, value in walk_json(root):
        if not isinstance(value, dict):
            continue
        for key in value:
            normalized = key.lower()
            if (
                normalized in FORBIDDEN_EXACT_KEYS
                or "screenshot" in normalized
                or "pixel" in normalized
            ):
                leaks.append(
                    {
                        "type": "forbidden_field_leak",
                        "field": key,
                        "path": f"{path}.{key}" if path else key,
                    }
                )
    return leaks


def find_structural_errors(inspection):
    errors = []
    if inspection.get("mode") != "read_only_atspi_probe":
        errors.append(
            {
                "type": "unexpected_broker_mode",
                "path": "mode",
                "value": inspection.get("mode"),
            }
        )
    if inspection.get("broker_source") != "rust_helper":
        errors.append(
            {
                "type": "unexpected_broker_source",
                "path": "broker_source",
                "value": inspection.get("broker_source"),
            }
        )
    if inspection.get("tree_available") is not True:
        errors.append(
            {
                "type": "tree_unavailable",
                "path": "tree_available",
                "value": inspection.get("tree_available"),
                "reason": inspection.get("unavailable_reason"),
                "diagnostic": inspection.get("diagnostic"),
            }
        )
    if inspection.get("tree", {}).get("text_content_included") is not False:
        errors.append(
            {
                "type": "text_content_contract_violation",
                "path": "tree.text_content_included",
                "value": inspection.get("tree", {}).get("text_content_included"),
            }
        )
    return errors


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

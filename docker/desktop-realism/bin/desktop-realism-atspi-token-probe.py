#!/usr/bin/env python3
import os
import re
import subprocess
import sys
from collections import deque


SESSION_BUS_FILE = "/tmp/soma-session-bus-address"
MAX_NODES = int(os.environ.get("DESKTOP_REALISM_ATSPI_PROBE_MAX_NODES", "2048"))
MAX_DEPTH = int(os.environ.get("DESKTOP_REALISM_ATSPI_PROBE_MAX_DEPTH", "16"))


def main():
    tokens = sys.argv[1:]
    if not tokens:
        print("usage: desktop-realism-atspi-token-probe.py TOKEN [...]", file=sys.stderr)
        return 64

    env = broker_env()
    address = atspi_address(env)
    services = atspi_application_services_from_list(atspi_bus_list(address, env))
    found = {token: [] for token in tokens}

    for service in services:
        scan_raw_accessible_tree(address, service, found, env)
        if all(found.values()):
            return 0

    missing = [token for token, locations in found.items() if not locations]
    if missing:
        print(f"missing AT-SPI token(s): {', '.join(missing)}", file=sys.stderr)
        return 1
    return 0


def broker_env():
    env = os.environ.copy()
    if not env.get("DBUS_SESSION_BUS_ADDRESS") and os.path.exists(SESSION_BUS_FILE):
        with open(SESSION_BUS_FILE, encoding="utf-8") as handle:
            env["DBUS_SESSION_BUS_ADDRESS"] = handle.read().strip()
    if not env.get("DBUS_SESSION_BUS_ADDRESS"):
        print("private session DBus address is missing", file=sys.stderr)
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
        print("AT-SPI bus address is unavailable", file=sys.stderr)
        raise SystemExit(1)
    return values[0]


def atspi_bus_list(address, env):
    return run_command(
        ["busctl", "--address", address, "list", "--no-legend", "--no-pager"],
        env,
    )


def atspi_application_services_from_list(output):
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
    while queue and len(seen) < MAX_NODES:
        object_service, path, depth = queue.popleft()
        key = (object_service, path)
        if key in seen:
            continue
        seen.add(key)

        for value in raw_accessible_values(address, object_service, path, env):
            for token in found:
                if token in value:
                    found[token].append({"service": object_service, "path": path})
        if all(found.values()) or depth >= MAX_DEPTH:
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
            values.extend(parse_busctl_strings(output))

    character_count = raw_text_character_count(address, service, path, env)
    if character_count and character_count > 0:
        output = run_command_or_none(
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
        if output:
            values.extend(parse_busctl_strings(output))
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
    return [
        bytes(match, "utf-8").decode("unicode_escape")
        for match in re.findall(r'"((?:[^"\\]|\\.)*)"', value)
    ]


if __name__ == "__main__":
    raise SystemExit(main())

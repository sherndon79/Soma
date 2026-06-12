#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import time
from pathlib import Path


MANIFEST = Path(os.environ.get("CANARY_MANIFEST", "/opt/soma/desktop-realism/canary-manifest.json"))


def main():
    session_bus = Path("/tmp/soma-session-bus-address")
    if session_bus.exists():
        os.environ["DBUS_SESSION_BUS_ADDRESS"] = session_bus.read_text(encoding="utf-8").strip()
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    token = next(
        entry["token"]
        for entry in manifest["canaries"]
        if entry.get("id") == "gedit_document"
    )
    inspection = run_json(["/usr/local/bin/soma-desktop-broker", "inspect-text-actuation"])
    text_item = find_item(
        inspection,
        lambda item: token in item.get("text", {}).get("value", "")
        and {"text_insert", "text_set"}.issubset(set(item.get("act_kinds", []))),
    )
    if not text_item:
        fail("gedit EditableText buffer with text_insert/text_set was not found")

    save_item = find_item(
        inspection,
        lambda item: item.get("text", {}).get("value", "").strip().lower() == "save"
        and "invoke_default" in item.get("act_kinds", []),
    )
    if not save_item:
        fail("semantic Save action with invoke_default was not found")

    replacement = f"{token}\nSOMA-GEDIT-ACTUATION-PREFLIGHT-SAVED\n"
    text_result = run_json(
        [
            "/usr/local/bin/soma-desktop-broker",
            "act-text",
            "--service",
            text_item["service"],
            "--path",
            text_item["path"],
            "--act-kind",
            "text_set",
        ],
        env={**os.environ, "SOMA_DESKTOP_ACT_TEXT": replacement},
    )
    if text_result.get("outcome") != "success":
        fail(f"text_set outcome was {text_result.get('outcome')!r}")

    save_result = run_json([
        "/usr/local/bin/soma-desktop-broker",
        "act-invoke",
        "--service",
        save_item["service"],
        "--path",
        save_item["path"],
        "--act-kind",
        "invoke_default",
    ])
    if save_result.get("outcome") != "success":
        fail(f"save outcome was {save_result.get('outcome')!r}")

    path = Path.home() / "Documents" / f"{token}.txt"
    if not file_contains(path, "SOMA-GEDIT-ACTUATION-PREFLIGHT-SAVED"):
        fail("gedit file did not contain saved semantic-actuation marker")

    print(json.dumps({
        "ok": True,
        "gedit_document": str(path),
        "text_act_kinds": text_item.get("act_kinds", []),
        "save_act_kinds": save_item.get("act_kinds", []),
    }, sort_keys=True))


def run_json(args, env=None):
    completed = subprocess.run(
        args,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )
    if completed.returncode != 0:
        fail(f"{args[0]} failed: {completed.stderr.strip()}")
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        fail(f"{args[0]} returned invalid JSON: {exc}")


def find_item(inspection, predicate):
    for window in inspection.get("windows", []):
        for item in window.get("text_items", []):
            if predicate(item):
                return item
    return None


def file_contains(path, marker):
    for _ in range(20):
        if marker in path.read_text(encoding="utf-8"):
            return True
        time.sleep(0.1)
    return False


def fail(message):
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


if __name__ == "__main__":
    main()

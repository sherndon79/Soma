#!/usr/bin/env python3
import json
import os
import subprocess
import time
from pathlib import Path


MANIFEST = Path(os.environ.get("CANARY_MANIFEST", "/opt/soma/desktop-realism/canary-manifest.json"))
LOG = Path("/tmp/soma-seed-gnome-apps.detail.log")


def load_tokens():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    return {entry["id"]: entry["token"] for entry in manifest["canaries"]}


def run(args):
    log = LOG.open("ab")
    subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    log.close()


def has_window_title(token):
    return subprocess.run(
        ["xdotool", "search", "--name", token],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    ).returncode == 0


def run_terminal(token):
    for attempt in range(1, 6):
        run([
            "gnome-terminal",
            "--title",
            token,
            "--",
            "bash",
            "-lc",
            f"printf 'Synthetic terminal canary: {token}\\n'; sleep 3600",
        ])
        for _ in range(10):
            if has_window_title(token):
                return
            time.sleep(0.5)
        with LOG.open("a", encoding="utf-8") as log:
            log.write(f"GNOME Terminal canary window not visible after attempt {attempt}; retrying.\n")


def main():
    tokens = load_tokens()
    home = Path.home()
    documents = home / "Documents"
    downloads = home / "Downloads"
    documents.mkdir(parents=True, exist_ok=True)
    downloads.mkdir(parents=True, exist_ok=True)

    text_path = documents / f"{tokens['gnome_text_editor_document']}.txt"
    text_path.write_text(
        "Synthetic GNOME Text Editor canary content for the steward-visible mirror only.\n"
        f"{tokens['gnome_text_editor_document']}\n",
        encoding="utf-8",
    )

    folder_path = downloads / tokens["nautilus_folder"]
    folder_path.mkdir(parents=True, exist_ok=True)
    (folder_path / "README.txt").write_text(
        "Synthetic folder used only to make a real Files window carry a canary title.\n",
        encoding="utf-8",
    )

    if shutil_which("gnome-text-editor"):
        run(["gnome-text-editor", str(text_path)])
        time.sleep(1.5)
    if shutil_which("nautilus"):
        run(["nautilus", str(folder_path)])
        time.sleep(1.5)
    if shutil_which("gnome-terminal"):
        run_terminal(tokens["gnome_terminal_title"])
    if shutil_which("gnome-control-center"):
        run(["gnome-control-center"])
        time.sleep(1.5)


def shutil_which(binary):
    return subprocess.run(
        ["sh", "-lc", f"command -v {binary} >/dev/null 2>&1"],
        check=False,
    ).returncode == 0


if __name__ == "__main__":
    main()

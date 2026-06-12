#!/usr/bin/env python3
import json
import os
import subprocess
import time
from pathlib import Path


MANIFEST = Path(os.environ.get("CANARY_MANIFEST", "/opt/soma/desktop-realism/canary-manifest.json"))
LOG = Path("/tmp/soma-seed-gnome-apps.detail.log")
WINDOW_PROBE = os.environ.get("DESKTOP_REALISM_WINDOW_PROBE", "x11")
BROWSER_BACKEND = os.environ.get("DESKTOP_REALISM_BROWSER_BACKEND", "default")


def load_tokens():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    return {entry["id"]: entry["token"] for entry in manifest["canaries"]}


def run(args):
    log = LOG.open("ab")
    subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    log.close()


def has_window_title(token):
    if WINDOW_PROBE == "atspi":
        return subprocess.run(
            ["/usr/local/bin/desktop-realism-atspi-token-probe.py", token],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        ).returncode == 0
    return subprocess.run(
        ["xdotool", "search", "--name", token],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    ).returncode == 0


def write_browser_canary_page(path, tokens, browser_id):
    path.write_text(
        "<!DOCTYPE html>\n"
        "<html lang=\"en\">\n"
        "<head><meta charset=\"utf-8\"><title>"
        f"{tokens[f'{browser_id}_title']}"
        "</title></head>\n"
        "<body>\n"
        "<p>Synthetic browser canary page for the steward-visible mirror only.</p>\n"
        f"<p>{tokens[f'{browser_id}_page_text']}</p>\n"
        f"<p><a href=\"#anchor\">{tokens[f'{browser_id}_link_label']}</a></p>\n"
        "</body>\n"
        "</html>\n",
        encoding="utf-8",
    )


def run_browser(args, title_token):
    for attempt in range(1, 4):
        run(args)
        for _ in range(60):
            if has_window_title(title_token):
                return
            time.sleep(1)
        with LOG.open("a", encoding="utf-8") as log:
            log.write(f"Browser window for {title_token} not visible after attempt {attempt}; retrying.\n")


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
    gedit_path = documents / f"{tokens['gedit_document']}.txt"
    gedit_path.write_text(
        "Synthetic gedit dwell canary content for semantic actuation preflight.\n"
        f"{tokens['gedit_document']}\n",
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
    if shutil_which("gedit"):
        run(["gedit", str(gedit_path)])
        time.sleep(1.5)
    if shutil_which("nautilus"):
        run(["nautilus", str(folder_path)])
        time.sleep(1.5)
    if shutil_which("gnome-terminal"):
        run_terminal(tokens["gnome_terminal_title"])
    if shutil_which("gnome-control-center"):
        run(["gnome-control-center"])
        time.sleep(1.5)

    firefox_page = documents / "soma-canary-firefox.html"
    edge_page = documents / "soma-canary-edge.html"
    write_browser_canary_page(firefox_page, tokens, "firefox")
    write_browser_canary_page(edge_page, tokens, "edge")

    if shutil_which("firefox"):
        profile = Path("/tmp/soma-firefox-profile")
        profile.mkdir(parents=True, exist_ok=True)
        (profile / "user.js").write_text(
            'user_pref("browser.shell.checkDefaultBrowser", false);\n'
            'user_pref("browser.aboutwelcome.enabled", false);\n'
            'user_pref("datareporting.policy.dataSubmissionEnabled", false);\n'
            'user_pref("toolkit.telemetry.enabled", false);\n'
            'user_pref("accessibility.force_disabled", 0);\n'
            'user_pref("app.update.disabledForTesting", true);\n',
            encoding="utf-8",
        )
        run_browser(
            [
                "firefox",
                "--no-remote",
                "--profile",
                str(profile),
                f"file://{firefox_page}",
            ],
            tokens["firefox_title"],
        )

    if shutil_which("microsoft-edge-stable"):
        # --no-sandbox: the container runs as root with no-new-privileges, so the
        # Chromium setuid sandbox cannot start; the rig holds synthetic content only.
        # --force-renderer-accessibility: Blink only exposes the web-content AT-SPI
        # tree when accessibility is forced or an AT is detected at startup.
        edge_args = [
            "microsoft-edge-stable",
            "--no-sandbox",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-gpu",
            "--force-renderer-accessibility",
            "--user-data-dir=/tmp/soma-edge-profile",
        ]
        if BROWSER_BACKEND == "wayland":
            edge_args.extend([
                "--ozone-platform=wayland",
                "--enable-features=UseOzonePlatform",
            ])
        edge_args.append(f"file://{edge_page}")
        run_browser(
            edge_args,
            tokens["edge_title"],
        )


def shutil_which(binary):
    return subprocess.run(
        ["sh", "-lc", f"command -v {binary} >/dev/null 2>&1"],
        check=False,
    ).returncode == 0


if __name__ == "__main__":
    main()

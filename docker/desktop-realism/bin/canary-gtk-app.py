#!/usr/bin/env python3
import json
import os

import gi

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk


def token(channel):
    manifest_path = os.environ.get(
        "CANARY_MANIFEST",
        "/opt/soma/desktop-realism/canary-manifest.json",
    )
    with open(manifest_path, encoding="utf-8") as handle:
        manifest = json.load(handle)
    for entry in manifest["canaries"]:
        if entry["channel"] == channel and entry["toolkit"] == "gtk":
            return entry["token"]
    raise KeyError(channel)


window = Gtk.Window(title=token("title"))
window.set_default_size(560, 360)
window.connect("destroy", Gtk.main_quit)

box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
box.set_margin_top(20)
box.set_margin_bottom(20)
box.set_margin_start(20)
box.set_margin_end(20)

label = Gtk.Label(label=f"GTK label canary: {token('label')}")
label.set_xalign(0)
box.pack_start(label, False, False, 0)

description = Gtk.Label(label=f"GTK visible description canary: {token('description')}")
description.set_xalign(0)
description.set_line_wrap(True)
box.pack_start(description, False, False, 0)

text = Gtk.TextView()
text.set_wrap_mode(Gtk.WrapMode.WORD_CHAR)
text.get_buffer().set_text(
    "GTK text buffer canary. This text is visible to the steward only: "
    f"{token('text')}"
)
box.pack_start(text, True, True, 0)

window.add(box)
window.show_all()
Gtk.main()

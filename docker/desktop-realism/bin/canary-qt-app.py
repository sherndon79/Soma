#!/usr/bin/env python3
import json
import os
import sys

from PyQt5.QtWidgets import QApplication, QLabel, QTextEdit, QVBoxLayout, QWidget


def load_manifest():
    manifest_path = os.environ.get(
        "CANARY_MANIFEST",
        "/opt/soma/desktop-realism/canary-manifest.json",
    )
    with open(manifest_path, encoding="utf-8") as handle:
        return json.load(handle)


def token(manifest, channel):
    for entry in manifest["canaries"]:
        if entry["channel"] == channel and entry["toolkit"] == "qt":
            return entry["token"]
    raise KeyError(channel)


manifest = load_manifest()
app = QApplication(sys.argv)

window = QWidget()
window.setWindowTitle(
    " ".join(
        [
            token(manifest, "title"),
            token(manifest, "label"),
            token(manifest, "description"),
            token(manifest, "text"),
        ]
    )
)
window.setAccessibleDescription(
    "Qt steward-visible content canaries: "
    f"{token(manifest, 'label')} "
    f"{token(manifest, 'description')} "
    f"{token(manifest, 'text')}"
)
window.resize(560, 360)

layout = QVBoxLayout()

label = QLabel(f"Qt label canary: {token(manifest, 'label')}")
label.setAccessibleName(f"Qt label canary: {token(manifest, 'label')}")
layout.addWidget(label)

description = QLabel(f"Qt visible description canary: {token(manifest, 'description')}")
description.setAccessibleDescription(
    f"Qt visible description canary: {token(manifest, 'description')}"
)
description.setWordWrap(True)
layout.addWidget(description)

text = QTextEdit()
text.setPlainText(
    "Qt text buffer canary. This text is visible to the steward only: "
    f"{token(manifest, 'text')}"
)
text.setAccessibleName(
    "Qt text buffer canary. This text is visible to the steward only: "
    f"{token(manifest, 'text')}"
)
layout.addWidget(text)

window.setLayout(layout)
window.show()
sys.exit(app.exec_())

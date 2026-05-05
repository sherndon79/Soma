# Desktop Capability Broker

Status: draft concept

Soma's desktop-control surface should be mediated by a dedicated **Desktop Capability Broker**.
The broker is not one API. It is a policy-governed layer that chooses the least invasive desktop
channel capable of satisfying the user's intent.

The core rule:

**Prefer semantic desktop access before visual inference, and prefer visual inference before raw
input synthesis.**

## Purpose

Desktop interaction is one of Soma's most sensitive capabilities. It can reveal private context,
act on behalf of the participant, alter state, disclose information, or perform actions that
cannot be fully undone.

The broker should:

- keep the policy gateway on the path
- expose desktop capability as narrow named operations
- choose the least invasive implementation channel
- keep inspection separate from actuation
- record provenance for observations and actions
- support revocation through harness modules
- avoid treating MCP or any tool protocol as the trust boundary

## Implementation Boundary

The current scaffold lives in the Node service plane because Node is good for quickly shaping the
API, policy checks, CLI, and provenance records.

The first real desktop bridge should likely become a Rust helper process.

Recommended split:

```text
Node Soma service
        |
policy check + provenance intent
        |
Rust desktop broker helper
        |
AT-SPI / D-Bus, portals, compositor adapters, input helpers
        |
structured result
        |
Node provenance completion
```

Rust is a better fit for this broker once it starts touching host desktop APIs because it can
produce a small standalone binary, integrate cleanly with native D-Bus/portal crates, and give a
sharper boundary around privileged or semi-privileged operations.

Node should remain the policy/provenance authority at first. The Rust helper should be the
capability executor. Any future move toward policy enforcement inside the helper should be
intentional and documented.

## Layered Desktop Stack

```text
Soma Policy Gateway
        |
Desktop Capability Broker
        |
AT-SPI / D-Bus          semantic accessibility tree and actions
XDG Desktop Portals     consented screen/window capture
Compositor adapters     GNOME/Mutter, KDE/KWin, other desktop-specific surfaces
OCR / vision fallback   inaccessible, canvas, remote, or custom-rendered surfaces
Input synthesis         wtype, ydotool/uinput, xdotool as constrained last-mile actuation
MCP facade              optional adapter protocol, not the governing layer
        |
Provenance + Revocation
```

## Preferred Channel: AT-SPI / D-Bus

For Linux desktops, the first semantic path should be AT-SPI over D-Bus.

AT-SPI exposes accessibility interfaces for application objects: accessible nodes, roles, names,
states, text, editable text, selections, components, windows, and actions. This allows Soma to
work with the meaning of the interface rather than only pixels.

Examples of operations that belong here:

- list applications and accessible windows
- inspect focused object
- walk an accessible subtree
- read labels, roles, descriptions, and state
- list available actions on a UI object
- invoke a named accessibility action where permitted
- read or edit text controls where permitted

This should be the first implementation target because it can support **read-only desktop
inspection** without cursor movement, screenshots, or synthetic input.

Reference options to study:

- AT-SPI D-Bus interfaces: `Accessible`, `Action`, `Component`, `Text`, `EditableText`,
  `Selection`, `Window`
- `dogtail`, a Python GUI automation framework using AT-SPI
- LDTP, a desktop testing framework using accessibility libraries

## Screen And Window Perception: XDG Desktop Portals

Visual perception should be treated as a separate capability from semantic inspection.

On modern Linux desktops, especially Wayland sessions, XDG Desktop Portals are the consented path
for screen and window capture. The ScreenCast portal supports monitor, window, and virtual sources
and cursor modes.

This layer should be used for:

- consented screenshot or stream access
- visual grounding when accessibility trees are incomplete
- OCR over a selected window or region
- visual verification after semantic actions

It should not be used as the default when AT-SPI can provide the same information with less
exposure.

## Compositor And Window Adapters

Window management is not uniform across Linux desktops.

KDE/KWin exposes scripting and window-management surfaces. GNOME/Mutter has its own constraints
and extension/remote-desktop surfaces. X11 exposes more global control than Wayland, but with a
weaker security posture.

The broker should therefore treat compositor integration as adapter-specific:

- GNOME/Mutter adapter
- KDE/KWin adapter
- X11 fallback adapter where available
- Wayland portal-first adapter where direct global access is not available

Window operations should be explicit and separately scoped from app UI actions:

- list windows
- identify focused window
- move or resize a window
- focus a window
- switch workspace
- request a screenshot/stream grant

## OCR And Vision Fallback

Some surfaces will not expose useful accessibility trees:

- games
- canvas-heavy apps
- remote desktops
- video streams
- custom Electron/web canvases
- terminal or TUI contexts with incomplete semantic structure

OCR and vision should be a fallback perception layer. It observes more than semantic APIs, so it
requires stronger disclosure and should be local-first by default.

Provenance should clearly distinguish:

- semantic AT-SPI inspection
- portal-backed screen/window capture
- OCR/vision inference
- direct input synthesis

## Input Synthesis As Last-Mile Actuation

Raw input tools should be treated as powerful and low-semantic.

Potential Linux options include:

- `wtype` for Wayland virtual-keyboard text/key events
- `ydotool` for uinput-backed keyboard and pointer events
- `xdotool` for X11 sessions

These tools can type, click, and move the pointer without understanding the application. They
should be constrained behind capabilities such as:

- `tool.desktop.input.keyboard`
- `tool.desktop.input.pointer`
- `tool.desktop.actuate`

They should usually require confirmation unless the action is explicitly delegated, reversible,
and scoped.

## MCP Position

MCP is useful as an adapter protocol but should not become Soma's trust boundary.

Soma may expose or consume desktop tools through MCP servers, for example:

- `soma-atspi-mcp`
- `soma-desktop-portal-mcp`
- `soma-window-mcp`
- `soma-input-mcp`

But every tool call should still pass through Soma's native policy gateway.

MCP can provide:

- tool discovery
- schema-shaped calls
- adapter interoperability
- model-facing tool descriptions

Soma must still own:

- capability grants
- consent and confirmation
- disclosure
- revocation
- provenance
- refusal
- local/remote routing

## Capability Vocabulary Sketch

Possible future capability keys:

- `desktop.inspect.accessibility_tree`
- `desktop.inspect.focus`
- `desktop.inspect.windows`
- `desktop.inspect.text`
- `desktop.perception.screencast`
- `desktop.perception.screenshot`
- `desktop.perception.ocr`
- `desktop.action.accessible_action`
- `desktop.action.edit_text`
- `desktop.window.focus`
- `desktop.window.move`
- `desktop.window.resize`
- `desktop.input.keyboard`
- `desktop.input.pointer`
- `tool.desktop.actuate`
- `mcp.desktop.tools`

The current MVP already names `tool.desktop.actuate`, but this draft splits the desktop surface
more finely so inspection, perception, semantic action, window management, and raw input do not
collapse into one grant.

Current implemented inspection capabilities:

- `desktop.inspect.accessibility_tree` is allowed in the base harness for bounded environment,
  participant, application-root, and shallow child role/count metadata.
- `desktop.inspect.windows` is present but disabled until window-level metadata is designed.
- `desktop.inspect.focus` is present but disabled until focused-object inspection is designed.
- `desktop.inspect.text` is present but disabled and must gate child names, descriptions, text
  content, states that reveal private context, and actions.

## First Implementation Slice

The first desktop slice should be read-only:

```text
POST /desktop/inspect/accessibility-tree
```

Initial behavior:

- require `desktop.inspect.accessibility_tree`
- inspect AT-SPI accessible applications/windows
- return a bounded tree or focused subtree
- include roles, names, descriptions, states, and available actions
- omit text content by default unless `desktop.inspect.text` is separately granted
- record provenance
- no clicking, typing, pointer movement, screenshots, or model-driven actuation

This validates the broker without crossing into irreversible or high-exposure behavior.

Current scaffold:

- `desktop.inspect.accessibility_tree` is present in the base harness
- `desktop.inspect.windows`, `desktop.inspect.focus`, and `desktop.inspect.text` are present but
  disabled
- `POST /desktop/inspect/accessibility-tree` returns environment metadata by default
- `POST /desktop/inspect/accessibility-tree` accepts `{ "mode": "atspi" }` for bounded
  read-only AT-SPI bus participant, root-object, and shallow child role/count metadata
- `soma desktop inspect --json` calls the endpoint
- `soma desktop inspect --mode atspi --json` asks for AT-SPI participant, application-root, and
  shallow child role/count metadata
- `soma.module.no-desktop-inspection` revokes the capability
- provenance records `desktop.inspect.accessibility_tree`
- `crates/soma-desktop-broker` contains Rust `inspect-environment` and `inspect-atspi` helper
  commands
- Node uses `./target/debug/soma-desktop-broker` when present, or `SOMA_DESKTOP_BROKER` when set
- no screenshots, text extraction, pointer control, keyboard control, or model-driven desktop
  actions are implemented
- root object reads include root name, role, child count, and a bounded sample of child object
  references
- shallow child-object reads include role and child count only; child names and descriptions are
  excluded by default
- the current output contract is documented in
  `docs/schemas/desktop-inspection-result.schema.json`
- Node validates desktop broker output against the current contract before returning it or
  recording provenance
- helper contract failures return `desktop_inspection_schema_invalid` with HTTP 502 and validation
  paths, without returning the rejected helper payload
- no recursive AT-SPI child-object traversal has been implemented yet

Likely next implementation shape:

- keep the Node endpoint and capability vocabulary
- compile and use the Rust `soma-desktop-broker` helper
- keep using one-shot stdio until the broker needs long-lived state
- return a bounded shallow JSON accessibility tree from the AT-SPI object graph
- keep actuation out of scope

## Research Findings

These findings came from a short survey of current Linux desktop, accessibility, portal, input
automation, and MCP documentation.

### AT-SPI / D-Bus

Sources:

- [GNOME accessibility developer documentation](https://developer.gnome.org/documentation/guidelines/accessibility.html)
- [Ubuntu AT-SPI D-Bus XML interfaces](https://documentation.ubuntu.com/desktop/en/latest/reference/accessibility/dbus/)

Finding:

GNOME documents AT-SPI over D-Bus as the protocol used by assistive technologies to receive
application information. Ubuntu's AT-SPI reference lists the concrete D-Bus interfaces available
to clients, including `Accessible`, `Action`, `Component`, `Text`, `EditableText`, `Selection`,
and window/event interfaces.

Decision:

AT-SPI / D-Bus should be Soma's first semantic desktop inspection path on Linux. It gives object
roles, labels, states, text interfaces, and actions without requiring screenshots or raw pointer
control.

Implementation note:

The first Soma AT-SPI command uses the session bus `org.a11y.Bus` pointer to locate the separate
AT-SPI bus, lists bounded AT-SPI bus participants through `busctl`, and reads each participant's
accessible root object when available. The root-object read includes name, role, child count, and
bounded child references. It also reads shallow child role/count metadata for a small sample of root
children. It does not recursively traverse child objects, read child names/descriptions, extract
text content, or invoke actions.

### Accessibility Automation References

Sources:

- [dogtail on PyPI](https://pypi.org/project/dogtail/)
- [LDTP user manual](https://ldtp.freedesktop.org/user-doc/index.html)
- [LDTP project reference](https://github.com/ldtp/ldtp2)

Finding:

`dogtail` and LDTP both use accessibility technologies for GUI automation/testing. LDTP's manual
and project docs are useful for object naming, locating UI elements, and action ergonomics.

Decision:

Soma should study these projects for interaction patterns, but should not bind the harness
directly to either library yet. The first real broker should expose a small Soma-owned JSON shape
so implementation choices can change.

### XDG Desktop Portals

Source:

- [XDG Desktop Portal ScreenCast documentation](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.ScreenCast.html)

Finding:

The ScreenCast portal supports consented monitor, window, and virtual sources, plus cursor modes.
This is the Wayland-aligned path for screen/window capture under a user-mediated permission model.

Decision:

Portals belong in Soma's visual perception layer, not the default semantic control path. Use them
for consented screenshots/streams, OCR, and visual verification when AT-SPI is insufficient.

### Compositor-Specific Window Management

Sources:

- [KWin scripting tutorial](https://develop.kde.org/docs/plasma/kwin/)
- [KWin scripting API](https://develop.kde.org/docs/plasma/kwin/api/)

Finding:

KDE/KWin exposes scripting and window-management APIs, while GNOME/Mutter and other compositors
have different constraints. Wayland intentionally limits global desktop access outside the
compositor/portal model.

Decision:

Window management should be implemented through compositor-specific adapters rather than one
assumed universal Linux API.

### Input Synthesis

Sources:

- [wtype](https://github.com/atx/wtype)
- [wtype man page](https://man.archlinux.org/man/wtype.1.en)
- [ydotool](https://github.com/ReimuNotMoe/ydotool)
- [ydotool package notes](https://packages.fedoraproject.org/pkgs/ydotool/ydotool/)

Finding:

`wtype` provides Wayland virtual-keyboard-style typing/key events. `ydotool` uses Linux `uinput`
and can work across graphical stacks, but commonly requires a daemon and access to `/dev/uinput`,
which raises privilege and trust-boundary concerns.

Decision:

Input synthesis should remain last-mile actuation. It should be separately gated, strongly
provenanced, and normally require confirmation unless an action is explicitly delegated and
reversible.

### MCP

Sources:

- [MCP tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [MCP base protocol overview](https://modelcontextprotocol.io/specification/2025-06-18/basic/index)

Finding:

MCP standardizes how servers expose tools and how clients invoke them. The tools specification
includes security guidance around access controls, user confirmation for sensitive operations,
tool visibility, timeouts, and audit logging.

Decision:

MCP is a useful adapter/facade protocol for Soma desktop tools, but it should not be Soma's trust
boundary. Soma's native policy gateway should still decide which tools are visible, callable, and
provenanced.

## Source Notes

Research sources used for this draft:

- GNOME accessibility developer documentation: AT-SPI D-Bus protocol for assistive technologies
- Ubuntu AT-SPI D-Bus interface reference
- XDG Desktop Portal ScreenCast documentation
- KDE KWin scripting documentation
- `dogtail` and LDTP accessibility-based GUI automation references
- `wtype` and `ydotool` input-synthesis references
- MCP tools and base protocol documentation

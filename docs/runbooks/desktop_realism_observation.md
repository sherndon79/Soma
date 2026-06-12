# Desktop Realism Observation Rig

This runbook starts the Slice A mirror-container observation rig. It does not route Soma occupant
capabilities and does not run the desktop broker assertion path. It only creates an isolated,
browser-viewable synthetic desktop with canary content for steward observation.

## Start

```bash
scripts/desktop-realism-start.sh
```

The script builds `docker-compose.desktop-realism.yml`, waits for health checks, runs the namespace
absence check, and prints:

```text
noVNC URL: http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale
```

Open that URL in a browser on the same machine.

## What Should Be Visible

The desktop should show:

- one GTK canary window
- one Qt canary window
- visible canary strings in window titles, labels, description labels, and text buffers

The canary source of truth is:

```text
docs/fixtures/desktop-realism/canary-manifest.json
```

Every manifest entry is expected to be present in the steward/noVNC view and absent from future
occupant-facing desktop inspection output. Slice B owns the automated absence assertion.

## Broker Canary Assertion

Slice B builds `soma-desktop-broker` into the desktop realism image and runs it inside the container
against the container's private `DISPLAY=:99` and private session/a11y D-Bus. It does not expose a
broker HTTP port and does not route any Soma harness request to the container.

Run the broker strip-test from the host:

```bash
scripts/desktop-realism-broker-assert.sh
```

The wrapper executes `/usr/local/bin/desktop-realism-broker-assert-canaries.py` inside the
`soma-desktop-realism` compose project. The assertion loads
`/opt/soma/desktop-realism/canary-manifest.json`, runs
`/usr/local/bin/desktop-realism-broker-inspect`, and fails loudly if any manifest token appears in
the broker's `inspect-atspi` JSON or if forbidden fields appear as JSON keys:

```text
name, description, text, title, states, actions, value, screenshot*, pixel*
```

Expected result:

```text
PASS: broker inspect-atspi output contains no manifest canaries and no forbidden fields
```

## Ubuntu GNOME/X11 Mirror

The GNOME mirror is a separate, opt-in heavier rig. It keeps the default Debian/openbox rig above
small and CI-friendly while giving stewards a fuller Ubuntu 24.04 GNOME-style X11 tree for live
realism checks.

Start it with:

```bash
scripts/desktop-realism-gnome-start.sh
```

The script builds `docker-compose.desktop-realism-gnome.yml`, waits for health checks, runs the same
namespace absence check, and prints:

```text
noVNC URL: http://127.0.0.1:6081/vnc.html?autoconnect=1&resize=scale
```

This variant runs an Ubuntu 24.04 image with GNOME Flashback components on X11 (`metacity`,
`gnome-flashback`, `gnome-panel`) plus synthetic GTK/Qt canary apps and representative GNOME apps:
Text Editor, Files, Terminal, and a best-effort Settings launch. `gnome-control-center` is installed
and attempted, but it can abort inside the headless Xvfb container before creating a stable window;
it is therefore not part of the required canary set.

The mirror also seeds real browser engines — Firefox (Gecko, from the Mozilla apt repository) and
Microsoft Edge (Blink, from the Microsoft apt repository) — each opening a local synthetic canary
page (`file://` only, no network content) that places tokens in the window title, a visible link
label, and visible page text. Browser a11y trees are the largest and most content-dense trees on a
real desktop, so they stress the broker strip in ways the GTK/Qt canary apps cannot. Edge runs with
`--force-renderer-accessibility` (Blink does not otherwise expose web content over AT-SPI) and
`--no-sandbox` (the container is root with `no-new-privileges`, which blocks the Chromium setuid
sandbox; the rig holds synthetic content only).

The GNOME canary source of truth is:

```text
docs/fixtures/desktop-realism/canary-manifest-gnome.json
```

Run the GNOME broker strip-test from the host:

```bash
scripts/desktop-realism-gnome-broker-assert.sh
```

The GNOME assertion uses the same broker output contract as the minimal rig, with higher non-vacuity
thresholds. It requires multiple applications/root objects in the raw AT-SPI tree, confirms manifest
tokens are present in the steward-visible desktop, and fails if broker output exposes canary content,
identity/process/path fields, screenshots, pixels, host environment, or more than coarse
`platform_family`, role, and child-count shape.

Stop it with:

```bash
scripts/desktop-realism-gnome-stop.sh
```

## Ubuntu GNOME Shell/Wayland Mirror

The Wayland mirror is a separate, opt-in heavier rig for checking the mirror against GNOME Shell,
mutter Wayland, XWayland, and `xdg-desktop-portal`. It does not replace the minimal rig or the
GNOME/X11 mirror.

Start it with:

```bash
scripts/desktop-realism-wayland-start.sh
```

The script builds `docker-compose.desktop-realism-wayland.yml`, waits for health checks, runs the
Wayland isolation check, and prints:

```text
noVNC URL: http://127.0.0.1:6082/vnc.html?autoconnect=1&resize=scale
```

This variant runs as compose project `soma-desktop-realism-wayland` with no host mounts. It creates
a private Xvfb display only as the noVNC viewing transport, then starts nested GNOME Shell on a
private Wayland socket under `/tmp/soma-wayland-runtime`. Session D-Bus, AT-SPI, and the system bus
needed by GNOME Shell/logind are private to the container. `xdg-desktop-portal` and
`xdg-desktop-portal-gnome` must be live and introspectable on the private session bus.

Run the Wayland broker strip-test from the host:

```bash
scripts/desktop-realism-wayland-broker-assert.sh
```

The Wayland assertion uses the same GNOME canary manifest and broker output contract as the
GNOME/X11 mirror:

```text
docs/fixtures/desktop-realism/canary-manifest-gnome.json
```

Expected result:

```text
PASS: broker inspect-atspi output contains no manifest canaries and no forbidden fields
```

Stage 3b adds a separate text-tier assertion for the same Wayland image. After broker source
changes, rebuild the image rather than copying a host binary into the running container; the test
must exercise the installed `/usr/local/bin/soma-desktop-broker` that the synthetic-container
provider will invoke.

The expected inversion is:

- raw AT-SPI preflight sees the GNOME canary manifest tokens
- `inspect-atspi` and `inspect-windows` keep canaries absent
- `inspect-text` may return synthetic canary titles/names/descriptions/text values because it is
  the content-bearing `desktop.inspect.text` tier
- `inspect-text` still rejects identity/control fields such as pid/process, desktop service names,
  raw AT-SPI paths, registry data, screenshots, states, actions, pointer, keyboard, and actuation
- `inspect-focus`, `inspect-windows`, and `inspect-text` expose only coarse `platform_family` for
  host environment. They must not emit exact `platform`, kernel `release`, `desktop_session`, or
  `session_type` fields.

Run the text assertion from the host:

```bash
scripts/desktop-realism-wayland-text-assert.sh
```

Expected result:

```text
PASS: broker inspect-text output contains manifest canaries and no forbidden identity/control fields
```

Contract regression note: Run #5 identified exact host identity, especially kernel `release`, as
in-seat reconnaissance. Stage 3b initially resurrected that shape in the new focus/window/text
family and review caught it because the written contract was explicit. Keep this adversarial loop
load-bearing: new desktop surfaces should define identity fields in writing first, then assert their
absence in source, schema, fixtures, and live mirror checks.

Stop it with:

```bash
scripts/desktop-realism-wayland-stop.sh
```

## X11 vs Wayland Divergence Log

The GNOME/X11 and GNOME Shell/Wayland mirrors intentionally share the same 18-canary manifest, but
their observation mechanics differ:

- **AT-SPI tree shape:** GNOME Shell/Wayland exposes a Mutter/GNOME Shell mediated tree, and some
  app content is visible through shell/window metadata rather than the same child paths used on X11.
  Browser trees remain deep and noisy on both backends; the raw preflight scans deeper than the
  GTK/Qt apps require.
- **Geometry and focus:** X11 title lookup uses `xdotool`; Wayland cannot rely on global X window
  enumeration. Wayland launch readiness therefore uses the raw AT-SPI token probe. Focus order and
  root-object counts may vary, so assertions use non-vacuity thresholds rather than exact tree
  snapshots.
- **XWayland vs native apps:** GNOME Shell runs on Wayland with an XWayland bridge present. GTK,
  Qt, Firefox, and Edge are started with Wayland-capable environment settings; Edge also receives
  Ozone Wayland flags. The private Xvfb server remains only for the read-only noVNC steward view.
- **Portal surfaces:** Wayland requires `xdg-desktop-portal` plus the GNOME backend. Health checks
  verify the desktop portal object is introspectable and includes expected portal interfaces such as
  Notification, Inhibit, RemoteDesktop, and ScreenCast.
- **Qt accessibility:** PyQt5 on the Wayland platform exposes the window title reliably, but did not
  expose the same child label/text fields through raw AT-SPI in this container. The Qt app still
  renders the original label, description, and text canaries visibly, and also duplicates those
  canary tokens into the Qt window title so raw preflight can prove steward-side visibility before
  broker stripping.
- **Browser accessibility:** Firefox and Edge expose large, implementation-specific web-content
  trees. Blink requires `--force-renderer-accessibility`. Edge is installed from Microsoft's
  amd64-only apt repository, so non-amd64 builds should treat that browser fixture as unavailable
  unless a different source is added.
- **Expected noise:** Raw text probing can produce GNOME Shell warnings such as failed
  `CharacterCount` assertions on non-text accessibles. Those warnings are expected during the raw
  preflight; the pass condition is raw token presence plus stripped broker output.
- **Window/focus targeting:** `desktop.inspect.windows` treats Wayland and X11 output as coarse
  targeting metadata, not as exact compositor truth. Window order is the broker's bounded discovery
  order and is exposed as result-local `index`/`z_order`; nested Wayland focus may not map to a
  top-level frame when AT-SPI reports a focused descendant instead of the window object. Geometry is
  bounded and may be null or compositor-adjusted. The broker still strips titles, names, text,
  pid/process metadata, desktop service names, raw AT-SPI paths, registry fields, screenshots,
  states, and actions before Soma egress.

## Isolation Checks

The container creates its own Xvfb display and private session/a11y D-Bus. It does not mount the
host X socket, host D-Bus socket, source tree, or Soma runtime stores.

The start script runs the check through the dedicated `soma-desktop-realism` compose project:

```bash
docker compose -p soma-desktop-realism -f docker-compose.desktop-realism.yml exec -T desktop-realism \
  /usr/local/bin/desktop-realism-isolation-check
```

Expected result:

```text
OK: private DISPLAY, private DBus, no host /tmp/.X11-unix mount
```

noVNC is bound to `127.0.0.1` by compose:

```yaml
ports:
  - "127.0.0.1:${DESKTOP_REALISM_NOVNC_PORT:-6080}:6080"
```

x11vnc runs in read-only mode with `-viewonly`.

## Stop

```bash
scripts/desktop-realism-stop.sh
```

This runs compose `down` for the dedicated `soma-desktop-realism` project only.

## Deferred

This Slice A rig deliberately does not include:

- broker-in-container canary absence assertions
- Soma harness routing
- `synthetic_container_live` or `container_live_fixture` provider mode
- human realism run protocol
- Seth's full DE/WM mirror image

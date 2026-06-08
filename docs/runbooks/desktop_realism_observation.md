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

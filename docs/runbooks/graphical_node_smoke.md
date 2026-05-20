# Graphical Node Smoke Workflow

This runbook verifies the current `soma-agent-desktop` graphical lab node. The node is a remote,
rollback-capable desktop VM for visual applications, browser work, and future governed
remote-session experiments. It is not the default local desktop authority boundary.

## Current Baseline

- Host: `primus.local.sthnet.org`
- VM domain: `soma-agent-desktop`
- Guest DNS: `soma-agent-desktop.local.sthnet.org`
- Guest user: `sherndon`
- Storage dataset: `storage/vms/soma-agent-desktop`
- Base snapshot:
  `storage/vms/soma-agent-desktop@base-graphical-agent-lab-20260520-202622`
- Base XML artifact:
  `/storage/vms/soma-agent-desktop/artifacts/soma-agent-desktop.base.xml`

The tested base includes Ubuntu 26.04, GNOME autologin, NVIDIA GTX 1070 passthrough, Sunshine,
Chrome, Edge, Firefox, Vulkan tools, and the small 3D smoke utilities. The VM intentionally remains
a remote graphical lab; Soma should still prefer local semantic surfaces for local desktop work.

## Manual Smoke

Boot the VM from Primus:

```bash
ssh primus.local.sthnet.org 'sudo virsh start soma-agent-desktop'
```

Check state and guest address:

```bash
ssh primus.local.sthnet.org \
  'sudo virsh domstate soma-agent-desktop; sudo virsh domifaddr soma-agent-desktop --source agent'
```

Connect with Moonlight and verify:

- the host is discoverable
- the stream connects
- keyboard and pointer input work
- audio works with a browser video
- Chrome, Edge, and Firefox launch without signed-in user state

Run the visible Vulkan cube from the Soma workstation:

```bash
ssh sherndon@soma-agent-desktop.local.sthnet.org \
  'export XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus;
   timeout 25s vkcube --wsi wayland --gpu_number 0 --width 1280 --height 720'
```

Expected posture:

- Moonlight displays the rotating cube
- `vkcube` selects `NVIDIA GeForce GTX 1070`
- `nvidia-smi` shows one active encoder session while Moonlight is connected

## Scripted Smoke

The guarded script performs read-only checks by default:

```bash
npm run graphical-node:smoke
```

It checks:

- VM state on Primus
- qemu guest-agent address reporting
- guest SSH reachability
- NVIDIA device visibility
- no virtual DRM connector
- Sunshine user service state
- Moonlight/Sunshine listening ports
- browser versions
- browser profile/cache cleanliness
- user keyring cleanliness

Use JSON for automation:

```bash
npm run graphical-node:smoke -- --json
```

Print commands without executing them:

```bash
npm run graphical-node:smoke -- --dry-run
```

Launch a visible 3D render as part of the smoke:

```bash
npm run graphical-node:smoke -- --launch-vkcube
```

The `--launch-vkcube` path starts a bounded visible workload in the active GNOME session. Use it
only when the operator expects a Moonlight stream to be connected or visible.

## Cleanup Before New Base Snapshots

Before creating or replacing a base snapshot, clean browser and keyring state:

```bash
ssh sherndon@soma-agent-desktop.local.sthnet.org '
  for name in google-chrome google-chrome-stable chrome microsoft-edge microsoft-edge-stable msedge firefox; do
    pkill -u sherndon -x "$name" 2>/dev/null || true
  done
  rm -rf \
    "$HOME/.config/google-chrome" \
    "$HOME/.cache/google-chrome" \
    "$HOME/.config/microsoft-edge" \
    "$HOME/.cache/microsoft-edge" \
    "$HOME/.mozilla/firefox" \
    "$HOME/.cache/mozilla" \
    "$HOME/.config/chromium" \
    "$HOME/.cache/chromium" \
    "$HOME/.local/share/keyrings"
  mkdir -p "$HOME/.local/share/keyrings"
  chmod 700 "$HOME/.local/share/keyrings"
'
```

Shut down cleanly:

```bash
ssh primus.local.sthnet.org 'sudo virsh shutdown soma-agent-desktop'
```

Confirm:

```bash
ssh primus.local.sthnet.org 'sudo virsh domstate soma-agent-desktop'
```

Expected:

```text
shut off
```

Create a ZFS snapshot only while the VM is shut off:

```bash
ssh primus.local.sthnet.org '
  name="base-graphical-agent-lab-$(date +%Y%m%d-%H%M%S)"
  sudo virsh dumpxml --inactive soma-agent-desktop |
    sudo tee "/storage/vms/soma-agent-desktop/artifacts/soma-agent-desktop.${name}.xml" >/dev/null
  sudo cp "/storage/vms/soma-agent-desktop/artifacts/soma-agent-desktop.${name}.xml" \
    /storage/vms/soma-agent-desktop/artifacts/soma-agent-desktop.base.xml
  sudo zfs snapshot "storage/vms/soma-agent-desktop@${name}"
  sudo zfs set "com.soma:base-snapshot=${name}" storage/vms/soma-agent-desktop
'
```

## Restore Shape

Restoring from the base snapshot is intentionally a host-operator action. Do not perform it while
the VM is running. The high-level shape is:

1. Shut off `soma-agent-desktop`.
2. Confirm no one is using the Moonlight session.
3. Restore the `storage/vms/soma-agent-desktop` dataset from the intended snapshot.
4. Redefine the saved base XML if the libvirt domain drifted.
5. Boot and run this smoke workflow again.

This restore path is destructive to post-snapshot VM changes. Treat it as a lab reset, not a
normal application rollback.

## Soma Boundary

This node is a remote graphical substrate. Future Soma integration should keep the same capability
split described in the remote graphical session provider draft:

- view/stream access is perception
- pointer and keyboard input are separate actuation capabilities
- pairing or network reachability is not authorization
- rollback is an operator affordance, not a substitute for consent
- frames, screenshots, keystrokes, pointer paths, clipboard contents, and browser profiles should
  not be recorded by default

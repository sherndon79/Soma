# Sensorium RealSense Sandbox Activation

This runbook is for an attended host deployment after Seth provides the RealSense `lsusb`
identity. It does not enable live depth presence. The invariant for this slice is that the
helper sandbox is packaged and reviewable, while hardware access remains disabled until a
live udev graph is resolved on the host.

## Preflight

Confirm the Intel RealSense device and record the product id:

```bash
lsusb -d 8086:
```

Use the observed `8086:PID` value as `REALSENSE_PRODUCT_ID`. Do not reuse a stale product
id from another host or camera.

Create the static identity if it does not already exist:

```bash
getent group soma-sensorium >/dev/null || groupadd --system soma-sensorium
id soma-sensorium >/dev/null 2>&1 || \
  useradd --system --gid soma-sensorium --home-dir /nonexistent \
    --shell /usr/sbin/nologin soma-sensorium
```

## Install Inert Files

Render and install the udev rule from the reviewed template:

```bash
sed "s/@@REALSENSE_PRODUCT_ID@@/$REALSENSE_PRODUCT_ID/g" \
  "$SOMA_REPO/packaging/udev/71-soma-sensorium-realsense.rules.in" \
  >/etc/udev/rules.d/71-soma-sensorium-realsense.rules
chown root:root /etc/udev/rules.d/71-soma-sensorium-realsense.rules
chmod 0644 /etc/udev/rules.d/71-soma-sensorium-realsense.rules
udevadm verify --resolve-names=never /etc/udev/rules.d/71-soma-sensorium-realsense.rules
udevadm control --reload
```

Install the base unit and tmpfiles rule:

```bash
install -m 0644 -o root -g root \
  "$SOMA_REPO/packaging/systemd/soma-sensor-broker.service" \
  /etc/systemd/system/soma-sensor-broker.service
install -m 0644 -o root -g root \
  "$SOMA_REPO/packaging/tmpfiles/soma-sensorium.conf" \
  /usr/lib/tmpfiles.d/soma-sensorium.conf
systemd-tmpfiles --create /usr/lib/tmpfiles.d/soma-sensorium.conf
systemctl daemon-reload
```

The base service intentionally has `DevicePolicy=closed` and no `DeviceAllow`.

## Resolve The Live Device Graph

Physically replug the camera, settle udev, and resolve the live node set:

```bash
udevadm settle
node "$SOMA_REPO/scripts/sensorium-realsense-device-allow.mjs" \
  --product-id "$REALSENSE_PRODUCT_ID" \
  | tee "$STAGE/sensorium-device-allow-plan.json"
RESOLVER_STATUS=${PIPESTATUS[0]}
```

Exit code `0` means the resolver identified a clean minimal depth set. Exit code `2`
means manual review is required before installing a drop-in.

The desired result is:

- `minimal_depth_set_preferred: true`
- `minimal_depth_set_clean: true`
- `device_allow` contains only depth, infrared, IMU, control, media, or USB control nodes
- `excluded_color_nodes` names the color/RGB video node
- `unresolved_nodes` is empty

If the color node is not cleanly separable, record the resolver output and stop. The fallback
state is software color-off only; it is not equivalent to device-topology color denial.

## Cross-Check Stream Mapping

Before installing any `DeviceAllow` drop-in, independently confirm the stream-to-node mapping
with tooling that observes the camera stack, not the udev metadata used by the resolver:

```bash
rs-enumerate-devices | tee "$STAGE/realsense-enumerate-devices.txt"
v4l2-ctl --list-devices | tee "$STAGE/realsense-v4l2-list-devices.txt"
for node in $(jq -r '.device_allow[], .excluded_color_nodes[]' \
  "$STAGE/sensorium-device-allow-plan.json"); do
  v4l2-ctl --device "$node" --all 2>&1 | tee "$STAGE/v4l2-$(basename "$node").txt"
done
```

The operator must confirm both facts from the librealsense or v4l2 output:

- every node listed in `excluded_color_nodes` is a color/RGB stream node;
- no node listed in `device_allow` is a color/RGB stream node.

If this independent cross-check disagrees with the resolver classification, stop and keep the
service without a `DeviceAllow` drop-in. The fallback state is manual review plus software
color-off only; do not describe it as topology-enforced color denial.

## Install The DeviceAllow Drop-In

Only after a clean resolver output:

```bash
mkdir -p /etc/systemd/system/soma-sensor-broker.service.d
node "$SOMA_REPO/scripts/sensorium-realsense-device-allow.mjs" \
  --product-id "$REALSENSE_PRODUCT_ID" \
  --drop-in \
  >/etc/systemd/system/soma-sensor-broker.service.d/10-realsense-device-allow.conf
chown root:root /etc/systemd/system/soma-sensor-broker.service.d/10-realsense-device-allow.conf
chmod 0644 /etc/systemd/system/soma-sensor-broker.service.d/10-realsense-device-allow.conf
systemctl daemon-reload
```

The generated drop-in must contain one `DeviceAllow=... rw` line per approved node and must
not contain any node listed under `excluded_color_nodes`.

## Verification

Before starting the helper, verify the resolved node ownership:

```bash
jq -r '.device_allow[], .excluded_color_nodes[]' "$STAGE/sensorium-device-allow-plan.json" |
  while read -r node; do
    stat -Lc '%n %a:%U:%G' "$node"
  done
```

Expected owned nodes are `660:root:soma-sensorium`. Active seat users and the harness should
not have ACL access to the color node. If ACLs are present, remove them before proceeding.

The service still carries:

```bash
systemctl cat soma-sensor-broker.service | grep -E \
  'DevicePolicy=closed|SOMA_SENSORIUM_LIVE_DEPTH_PRESENCE_ALLOWED=false|PrivateNetwork=yes'
```

Do not enable live depth presence in this gate. If the helper starts later, it starts with
`SOMA_SENSORIUM_LIVE_DEPTH_PRESENCE_ALLOWED=false`.

## Emergency Off

Stop the service and remove hardware access:

```bash
systemctl stop soma-sensor-broker.service || true
rm -rf /etc/systemd/system/soma-sensor-broker.service.d
rm -f /etc/udev/rules.d/71-soma-sensorium-realsense.rules
udevadm control --reload
systemctl daemon-reload
```

Replug the device and confirm its nodes no longer have `soma-sensorium` ownership.

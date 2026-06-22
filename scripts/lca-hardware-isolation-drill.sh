#!/usr/bin/env bash
set -euo pipefail

if [[ "${SOMA_LCA_HARDWARE_ISOLATION_TEST:-}" != "1" ]]; then
  echo "Refusing: set SOMA_LCA_HARDWARE_ISOLATION_TEST=1 after reviewed rule installation." >&2
  exit 2
fi

seat_user="${SOMA_LCA_SEAT_USER:-}"
broker_user="${SOMA_LCA_COMPUTER_USE_USER:-}"

[[ -n "$seat_user" ]]
[[ -n "$broker_user" ]]
id soma-lca >/dev/null
id soma-harness >/dev/null

matches=()
for sys_node in /sys/class/hidraw/hidraw*; do
  [[ -e "$sys_node" ]] || continue
  properties=$(udevadm info --query=property --path="$sys_node")
  if grep -qx 'ID_FIDO_TOKEN=1' <<<"$properties" \
    && grep -qx 'ID_VENDOR_ID=1050' <<<"$properties" \
    && grep -qx 'ID_MODEL_ID=0407' <<<"$properties" \
    && grep -qx 'ID_USB_INTERFACE_NUM=01' <<<"$properties"; then
    matches+=("/dev/$(basename "$sys_node")")
  fi
done

if [[ ${#matches[@]} -ne 1 ]]; then
  echo "Expected exactly one udev-matched YubiKey FIDO hidraw node; found ${#matches[@]}." >&2
  exit 1
fi
matched_device=$(readlink -f "${matches[0]}")
device=$(readlink -f "${SOMA_LCA_FIDO_DEVICE:-$matched_device}")
[[ -c "$device" ]]
if [[ "$device" != "$matched_device" ]]; then
  echo "Requested device does not resolve to the exact udev-matched FIDO hidraw node." >&2
  exit 1
fi

open_as() {
  local user=$1
  runuser -u "$user" -- sh -c 'exec 3<>"$1"' sh "$device"
}

if open_as "$seat_user" 2>/dev/null; then
  echo "Seat user unexpectedly opened the FIDO device." >&2
  exit 1
fi
if open_as soma-harness 2>/dev/null; then
  echo "Soma harness unexpectedly opened the FIDO device." >&2
  exit 1
fi
if open_as "$broker_user" 2>/dev/null; then
  echo "Computer-use identity unexpectedly opened the FIDO device." >&2
  exit 1
fi
open_as soma-lca

acl=$(getfacl -cp "$device")
if grep -Eq "^user:(${seat_user}|soma-harness|${broker_user}):.*[rw]" <<<"$acl"; then
  echo "Forbidden FIDO device ACL remains." >&2
  exit 1
fi
[[ $(stat -Lc '%a:%U:%G' "$device") == "660:root:soma-lca" ]]

echo "LCA hardware isolation drill: PASS"

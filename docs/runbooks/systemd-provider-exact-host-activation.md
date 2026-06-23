# Systemd Provider Exact-Host Enrollment And First Restart

This is the attended Seth-run procedure. Repository builds do not execute it. A second steward
reviews the filled command transcript and generated artifacts before enrollment and again before
the restart. Stop at the first failed, unexpected, interactive, or ambiguous result. Never widen
policy, retry a possibly dispatched restart, or continue after substituting a device, identity,
unit, or generation.

## Fixed Tuple And Records

Set this tuple once in a root shell. Do not edit it later in the run:

```bash
set -euo pipefail
export SOMA_REPO=/absolute/path/to/reviewed/Soma
export LAB_ID=restart-proof
export INVENTORY_ID="$LAB_ID"
export UNIT="soma-lab-${LAB_ID}.service"
export HOST_ID="reviewed-host-id"
export SEAT_USER="reviewed-seat-user"
export COMPUTER_USE_USER="reviewed-computer-use-uid-name"
export STAGE="/root/soma-attended-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0700 -o root -g root "$STAGE"
test "$UNIT" = "soma-lab-${INVENTORY_ID}.service"
```

`UNIT` is the single source of truth for the throwaway service. Every inventory, policy, polkit,
preview, enrollment, verification, and rollback step must name exactly this value.

Record:

```bash
cd "$SOMA_REPO"
git status --short
git rev-parse HEAD | tee "$STAGE/repository-commit.txt"
sha256sum \
  packaging/systemd/soma-systemd-provider.{service,socket} \
  packaging/systemd/soma-local-confirmation-issuer.service \
  packaging/udev/{71,99}-soma-lca-fido-isolation.rules \
  config/systemd-provider-inventory.json \
  | tee "$STAGE/artifact-sha256.txt"
```

Stop unless the commit is reviewed and `git status --short` is empty. Use a separate clean
checkout for this procedure rather than tolerating unrelated worktree state.

## Emergency Off

This block is valid from every checkpoint after artifact staging. It does not depend on the
issuer or provider responding:

```bash
pkill -u soma-harness -f systemd-provider-attended-host.mjs 2>/dev/null || true
rm -f /run/soma-lca/issuer.sock /run/soma/systemd-provider.sock
install -m 0640 -o root -g soma-systemd-provider \
  "$SOMA_REPO/config/systemd-provider-inventory.json" \
  /etc/soma/systemd-provider-inventory.json
systemctl stop soma-local-confirmation-issuer.service || true
systemctl stop soma-systemd-provider.socket soma-systemd-provider.service || true
rm -rf /run/soma-attended
rm -f /etc/polkit-1/rules.d/00-soma-systemd-provider.rules
rm -f /etc/systemd/system/soma-local-confirmation-issuer.service.d/10-enrolled-device.conf
systemctl daemon-reload
```

Then verify:

```bash
jq -e '
  .activation_status == "disabled" and
  .restart_enabled == false and
  .controlled_testing == false and
  .attended_host_activation == false and
  .units == []
' /etc/soma/systemd-provider-inventory.json
test ! -S /run/soma-lca/issuer.sock
test ! -S /run/soma/systemd-provider.sock
```

Preserve enrollment evidence and replay state unless Seth explicitly revokes the credential.
Removing the drop-in removes device access from the issuer on its next start. Removing the udev
rules is a separate rollback step described at the end.

## Gate 0: Preconditions

1. Confirm `soma-harness`, `soma-systemd-provider`, and `soma-lca` are distinct static identities
   used by no unrelated process. Resolve and record:

   ```bash
   for command in jq socat pkcheck evtest udevadm runuser getfacl openssl npm cargo; do
     command -v "$command" >/dev/null
   done
   id "$SEAT_USER"
   id "$COMPUTER_USE_USER"
   getent passwd soma-harness soma-systemd-provider soma-lca | tee "$STAGE/passwd.txt"
   getent group soma-harness soma-systemd-provider soma-lca | tee "$STAGE/group.txt"
   export HARNESS_UID=$(id -u soma-harness)
   export HARNESS_GID=$(id -g soma-harness)
   export LCA_UID=$(id -u soma-lca)
   test "$HARNESS_UID" -ne 0
   test "$LCA_UID" -ne 0
   test "$HARNESS_UID" -ne "$LCA_UID"
   ```

2. Confirm the route and authorities are off:

   ```bash
   if test -e /etc/soma/systemd-provider-inventory.json; then
     OFF_INVENTORY=/etc/soma/systemd-provider-inventory.json
   else
     OFF_INVENTORY="$SOMA_REPO/config/systemd-provider-inventory.json"
   fi
   jq -e '
     .activation_status == "disabled" and
     .restart_enabled == false and
     .controlled_testing == false and
     .attended_host_activation == false and
     .units == []
   ' "$OFF_INVENTORY"
   ! systemctl is-active --quiet soma-local-confirmation-issuer.service
   ! systemctl is-active --quiet soma-systemd-provider.socket
   test ! -S /run/soma-lca/issuer.sock
   test ! -S /run/soma/systemd-provider.sock
   ```

3. Create the throwaway unit. It must perform no writes and have no dependencies beyond ordinary
   system defaults:

   ```bash
   cat >"$STAGE/$UNIT" <<EOF
   [Unit]
   Description=Soma attended restart proof

   [Service]
   Type=simple
   ExecStart=/usr/bin/sleep infinity
   Restart=no
   NoNewPrivileges=yes
   PrivateTmp=yes
   ProtectSystem=strict
   ProtectHome=yes
   EOF
   install -m 0644 -o root -g root "$STAGE/$UNIT" "/etc/systemd/system/$UNIT"
   systemctl daemon-reload
   systemctl start "$UNIT"
   systemctl is-active --quiet "$UNIT"
   ```

4. Record the complete definition, reverse relations, propagation relations, and initial
   `InvocationID`:

   ```bash
   systemctl cat "$UNIT" | tee "$STAGE/unit-definition.txt"
   systemctl show "$UNIT" \
     -p Requires -p Wants -p Requisite -p BindsTo -p PartOf \
     -p RequiredBy -p WantedBy -p RequisiteOf -p BoundBy -p ConsistsOf \
     -p PropagatesReloadTo -p PropagatesStopTo -p ReloadPropagatedFrom \
     -p StopPropagatedFrom -p TriggeredBy \
     | tee "$STAGE/unit-closure.txt"
   export INVOCATION_BEFORE=$(systemctl show -P InvocationID "$UNIT")
   test -n "$INVOCATION_BEFORE"
   ```

Stop unless steward review confirms the affected restart closure is exactly `UNIT` and the unit is
not needed by Soma, confirmation, desktop, network, storage, recovery, or the current shell.

## Gate 1: Install Inert Packages

Build with the reviewed compiler/toolchain:

```bash
cd "$SOMA_REPO"
cargo build --release -p soma-systemd-provider
cargo build --release -p soma-local-confirmation-issuer --features hardware-fido
npm run systemd-provider:package-validate
npm run lca:package-validate
sha256sum \
  target/release/soma-systemd-provider \
  target/release/soma-local-confirmation-issuer \
  target/release/soma-local-confirmation-client \
  target/release/soma-local-confirmation-enroll \
  | tee "$STAGE/release-binary-sha256.txt"
```

Install the binaries, systemd units, tmpfiles files, and empty provider inventory declared by
`packaging/systemd-provider-manifest.json` and `packaging/lca-manifest.json`. Keep both LCA udev
rules staged in the repository until Gate 4. Generate the root-readable channel files:

```bash
install -d -m 0755 -o root -g root /usr/libexec/soma
install -d -m 0755 -o root -g root /etc/soma/lca
install -m 0600 -o root -g root /dev/null /etc/soma/systemd-provider-channel.conf
printf 'SOMA_SYSTEMD_PROVIDER_EXPECTED_UID=%s\n' "$HARNESS_UID" \
  > /etc/soma/systemd-provider-channel.conf
chmod 0600 /etc/soma/systemd-provider-channel.conf
install -m 0600 -o root -g root /dev/null /etc/soma/lca/channel.conf
printf 'SOMA_LCA_EXPECTED_HARNESS_UID=%s\nSOMA_LCA_EXPECTED_HARNESS_GID=%s\n' \
  "$HARNESS_UID" "$HARNESS_GID" > /etc/soma/lca/channel.conf
chmod 0600 /etc/soma/lca/channel.conf
systemd-tmpfiles --create \
  /usr/lib/tmpfiles.d/soma-systemd-provider.conf \
  /usr/lib/tmpfiles.d/soma-local-confirmation-issuer.conf
systemctl daemon-reload
```

Verify ownership/modes from both manifests. The provider inventory must still be the checked-in
empty inventory. Do not install polkit policy, an LCA device drop-in, credential policy, or
enrollment output yet. Do not start either service.

Run `systemd-analyze verify` and `systemd-analyze security` for all installed units. Stop on an
unsupported directive, warning requiring relaxation, or unexpected access. Emergency Off on
failure.

## Gate 2: Provider Read-Only Preflight

Start only the provider socket while restart authority remains false:

```bash
systemctl start soma-systemd-provider.socket
systemctl is-active --quiet soma-systemd-provider.socket
test -S /run/soma/systemd-provider.sock
stat -Lc '%a:%U:%G' /run/soma /run/soma/systemd-provider.sock \
  | tee "$STAGE/provider-socket-modes.txt"
```

Prove root is rejected by peer authentication and `soma-harness` can perform only typed reads.
The empty inventory means an authenticated read still refuses the target, but with a different
code:

```bash
ROOT_RESPONSE=$(
  printf '%s\n' \
    '{"request_id":"root-probe","method":"status_read","inventory_id":"restart-proof"}' \
    | socat - UNIX-CONNECT:/run/soma/systemd-provider.sock
)
HARNESS_RESPONSE=$(
  runuser -u soma-harness -- sh -c \
    'printf "%s\n" "$1" | socat - UNIX-CONNECT:/run/soma/systemd-provider.sock' sh \
    '{"request_id":"harness-probe","method":"status_read","inventory_id":"restart-proof"}'
)
jq -e '.error.code == "provider_peer_unauthorized"' <<<"$ROOT_RESPONSE"
jq -e '.error.code == "service_unit_not_allowlisted"' <<<"$HARNESS_RESPONSE"
```

Run malformed, connection-loss, recovery, definition-drift, status, digest, and
canary-minimization checks from the dedicated harness context. No response may expose the unit
name, paths, commands, environment, status text, PIDs, or raw DBus diagnostics.

Stop the socket and prove the endpoint disappears, then restart it and repeat one typed status
read:

```bash
systemctl stop soma-systemd-provider.socket
test ! -S /run/soma/systemd-provider.sock
systemctl start soma-systemd-provider.socket
```

Emergency Off on any discrepancy.

## Gate 3: Stage Exact Provider Authority

Generate, but do not install, the one-unit inventory and polkit rule:

```bash
jq -n --arg id "$INVENTORY_ID" --arg unit "$UNIT" '{
  schema_version: 1,
  activation_status: "disabled",
  restart_enabled: false,
  controlled_testing: false,
  attended_host_activation: false,
  units: [{inventory_id: $id, unit_name: $unit}]
}' >"$STAGE/provider-inventory-off.json"

node "$SOMA_REPO/scripts/generate-systemd-provider-polkit.mjs" \
  "$UNIT" "$STAGE/00-soma-systemd-provider.rules"
chmod 0600 "$STAGE/00-soma-systemd-provider.rules"
```

Review both files and require exactly one identical `UNIT`. Install them while restart remains
disabled:

```bash
install -m 0640 -o root -g soma-systemd-provider \
  "$STAGE/provider-inventory-off.json" /etc/soma/systemd-provider-inventory.json
install -m 0600 -o root -g root \
  "$STAGE/00-soma-systemd-provider.rules" \
  /etc/polkit-1/rules.d/00-soma-systemd-provider.rules
systemctl restart soma-systemd-provider.socket
```

Prove the polkit matrix without invoking systemd. `pkcheck` evaluates policy only:

```bash
runuser -u soma-systemd-provider -- env UNIT="$UNIT" sh -c '
  pkcheck --action-id org.freedesktop.systemd1.manage-units \
    --process $$ --detail unit "$UNIT" --detail verb restart
'
for denied in \
  "soma-lab-denied-proof.service restart" \
  "$UNIT start" "$UNIT stop" "$UNIT reload"; do
  read -r denied_unit denied_verb <<<"$denied"
  if runuser -u soma-systemd-provider -- \
    env DENIED_UNIT="$denied_unit" DENIED_VERB="$denied_verb" sh -c '
      pkcheck --action-id org.freedesktop.systemd1.manage-units \
        --process $$ --detail unit "$DENIED_UNIT" --detail verb "$DENIED_VERB"
    '; then
    echo "Unexpected polkit authorization: $denied" >&2
    exit 1
  fi
done
```

No case may prompt. `InvocationID` must remain `INVOCATION_BEFORE`.

Emergency Off if a negative case succeeds, any case prompts, or the invocation changes.

## Gate 4: Install Udev Isolation

The FIDO hidraw number is not stable across replug. Never carry a previously observed `hidrawN`
across this gate.

Install the reviewed rules, reload them, and physically replug the dedicated YubiKey:

```bash
install -m 0644 -o root -g root \
  "$SOMA_REPO/packaging/udev/71-soma-lca-fido-isolation.rules" \
  /etc/udev/rules.d/71-soma-lca-fido-isolation.rules
install -m 0644 -o root -g root \
  "$SOMA_REPO/packaging/udev/99-soma-lca-fido-isolation.rules" \
  /etc/udev/rules.d/99-soma-lca-fido-isolation.rules
udevadm verify --resolve-names=never \
  /etc/udev/rules.d/71-soma-lca-fido-isolation.rules \
  /etc/udev/rules.d/99-soma-lca-fido-isolation.rules
udevadm control --reload
```

After replug and `udevadm settle`, dynamically resolve exactly one FIDO interface `01` matching
`ID_FIDO_TOKEN=1`, vendor `1050`, model `0407`. Run the repository drill without an override:

```bash
cd "$SOMA_REPO"
SOMA_LCA_HARDWARE_ISOLATION_TEST=1 \
SOMA_LCA_SEAT_USER="$SEAT_USER" \
SOMA_LCA_COMPUTER_USE_USER="$COMPUTER_USE_USER" \
scripts/lca-hardware-isolation-drill.sh | tee "$STAGE/isolation-drill.txt"
```

The drill must prove:

- exactly one dynamically matched node;
- seat user, `soma-harness`, and the computer-use identity cannot `open()` it;
- only `soma-lca` can open it;
- it is exactly `0660 root:soma-lca` with no forbidden ACL.

Resolve the node again using the same udev predicates and record it as `FIDO_DEVICE`. Do not use
`readlink` output from before the replug:

```bash
mapfile -t FIDO_MATCHES < <(
  for n in /sys/class/hidraw/hidraw*; do
    p=$(udevadm info --query=property --path="$n")
    grep -qx 'ID_FIDO_TOKEN=1' <<<"$p" &&
    grep -qx 'ID_VENDOR_ID=1050' <<<"$p" &&
    grep -qx 'ID_MODEL_ID=0407' <<<"$p" &&
    grep -qx 'ID_USB_INTERFACE_NUM=01' <<<"$p" &&
    printf '/dev/%s\n' "$(basename "$n")"
  done
)
test "${#FIDO_MATCHES[@]}" -eq 1
export FIDO_DEVICE="${FIDO_MATCHES[0]}"
test "$(stat -Lc '%a:%U:%G' "$FIDO_DEVICE")" = "660:root:soma-lca"
printf '%s\n' "$FIDO_DEVICE" | tee "$STAGE/fido-device.txt"
```

Emergency Off on failure. To reverse udev isolation too, remove both rules, reload udev, replug the
key, and verify the node no longer has `soma-lca` ownership.

## Gate 5: Two-Touch Enrollment

Stop the issuer and confirm no LCA endpoint:

```bash
systemctl stop soma-local-confirmation-issuer.service || true
test ! -S /run/soma-lca/issuer.sock
```

Stage the current FIDO MDS3 JWT and separately reviewed signing root as root-owned,
non-group/world-writable files. Record source URLs, retrieval time, blob number, `nextUpdate`, and
SHA-256 hashes. Do not fetch metadata from the issuer.

Run enrollment with a clean environment and a new absolute output directory:

```bash
export ENROLL_OUT="$STAGE/enrollment-review"
env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /usr/libexec/soma/soma-local-confirmation-enroll \
  --device "$FIDO_DEVICE" \
  --mds-blob "$STAGE/mds.jwt" \
  --mds-root "$STAGE/mds-root.pem" \
  --inventory-id "$INVENTORY_ID" \
  --exact-target "$UNIT" \
  --output "$ENROLL_OUT"
```

Seth performs exactly two touches:

1. create one non-discoverable ES256 credential for RP `lca.soma.local`;
2. obtain one assertion to establish a nonzero counter baseline.

Stop on another token, prompt, touch, zero counter, timeout, or partial output. Do not rerun
enrollment automatically. A credential may already have been created even if later steps failed.

Independently review:

```bash
jq . "$ENROLL_OUT/policy.json"
jq . "$ENROLL_OUT/replay-state.json"
jq . "$ENROLL_OUT/enrollment-evidence.json"
cat "$ENROLL_OUT/10-enrolled-device.conf"
sha256sum "$ENROLL_OUT"/* | tee "$STAGE/enrollment-output-sha256.txt"
```

Require:

- exact `INVENTORY_ID` and `UNIT`;
- RP `lca.soma.local`, ES256, non-discoverable, `require_uv:false`;
- pinned AAGUID `d7781e5de35346aaafe23ca49f13332a`;
- reviewed MDS blob/root hashes, acceptable status, full attestation chain, and nonzero baseline;
- identical current `FIDO_DEVICE` in `SOMA_LCA_FIDO_DEVICE` and `DeviceAllow`.

Do not install output until the second steward signs this review.

## Gate 6: Install Enrollment And Prove OTP Isolation

Install reviewed output atomically:

```bash
install -d -m 0755 -o root -g root /etc/soma/lca
install -d -m 0755 -o root -g root \
  /etc/systemd/system/soma-local-confirmation-issuer.service.d
install -m 0644 -o root -g root \
  "$ENROLL_OUT/policy.json" /etc/soma/lca/policy.json
install -m 0600 -o root -g root \
  "$ENROLL_OUT/enrollment-evidence.json" /etc/soma/lca/enrollment-evidence.json
install -m 0600 -o soma-lca -g soma-lca \
  "$ENROLL_OUT/replay-state.json" /var/lib/soma-lca/replay-state.json
install -m 0644 -o root -g root \
  "$ENROLL_OUT/10-enrolled-device.conf" \
  /etc/systemd/system/soma-local-confirmation-issuer.service.d/10-enrolled-device.conf
systemctl daemon-reload
systemd-analyze verify soma-local-confirmation-issuer.service
```

Re-resolve the FIDO node dynamically and require it still equals the installed drop-in path.
Re-run the isolation drill. If replug changed `hidrawN`, stop: regenerate and review only the
drop-in for the newly resolved exact node before starting the issuer.

Before restart authority is enabled, prove a CTAP assertion touch emits no OTP keyboard input:

Create and record the stable generation values used by both confirmation-only and restart:

```bash
export HOST_IDENTITY_GENERATION=$(cat /proc/sys/kernel/random/boot_id)
export UNIT_INVENTORY_GENERATION=$(
  {
    systemctl cat "$UNIT"
    systemctl show "$UNIT" \
      -p Requires -p Wants -p Requisite -p BindsTo -p PartOf \
      -p RequiredBy -p WantedBy -p RequisiteOf -p BoundBy -p ConsistsOf \
      -p PropagatesReloadTo -p PropagatesStopTo -p ReloadPropagatedFrom \
      -p StopPropagatedFrom -p TriggeredBy
  } | sha256sum | cut -d' ' -f1
)
export ATTENDED_RUN_ID="otp-$(openssl rand -hex 8)"
export PLAN_CREATED_AT_MS=$(date +%s%3N)
```

1. Dynamically identify every `/dev/input/event*` descended from the same physical USB key's
   interface `00` (`ID_VENDOR_ID=1050`, `ID_MODEL_ID=0407`, `ID_USB_INTERFACE_NUM=00`):

   ```bash
   mapfile -t OTP_EVENTS < <(
     for e in /sys/class/input/event*; do
       p=$(udevadm info --query=property --path="$e")
       grep -qx 'ID_VENDOR_ID=1050' <<<"$p" &&
       grep -qx 'ID_MODEL_ID=0407' <<<"$p" &&
       grep -qx 'ID_USB_INTERFACE_NUM=00' <<<"$p" &&
       printf '/dev/input/%s\n' "$(basename "$e")"
     done
   )
   test "${#OTP_EVENTS[@]}" -ge 1
   printf '%s\n' "${OTP_EVENTS[@]}" | tee "$STAGE/otp-event-devices.txt"
   ```

2. Ensure the seat desktop, harness, and computer-use environment are otherwise idle.
3. As root, start non-grabbing `evtest` capture for every matched event node, writing raw events to
   `$STAGE/otp-evtest/`. Also focus a canary text field visible to the computer-use observer and
   record its exact before value. `CANARY_READ_COMMAND` must be a separately reviewed absolute
   helper that emits only the exact focused canary value and does not mutate focus, input,
   clipboard, or desktop state:

   ```bash
   export CANARY_READ_COMMAND=/root/reviewed-read-focused-canary
   test -x "$CANARY_READ_COMMAND"
   "$CANARY_READ_COMMAND" >"$STAGE/otp-canary-before.txt"
   install -d -m 0700 -o root -g root "$STAGE/otp-evtest"
   OTP_PIDS=()
   for e in "${OTP_EVENTS[@]}"; do
     evtest "$e" >"$STAGE/otp-evtest/$(basename "$e").log" 2>&1 &
     OTP_PIDS+=("$!")
   done
   sleep 1
   ```

4. Start the issuer and invoke the attended driver with both
   `SOMA_SYSTEMD_ATTENDED_HOST_RESTART=1` and `SOMA_SYSTEMD_ATTENDED_CONFIRM_ONLY=1`. Touch only
   when CTAP `getAssertion` is visibly pending. Require exit status `5`,
   `outcome:"confirmation_verified"`, and `restart_dispatched:false`:

   ```bash
   install -d -m 0700 -o soma-harness -g soma-harness /run/soma-attended
   export LCA_REQUEST_PATH=/run/soma-attended/otp-confirmation-preview.json
   systemctl start soma-local-confirmation-issuer.service
   set +e
   runuser -u soma-harness -- env -i \
     PATH=/usr/bin:/bin \
     SOMA_SYSTEMD_ATTENDED_HOST_DRIVER=1 \
     SOMA_SYSTEMD_ATTENDED_HOST_RESTART=1 \
     SOMA_SYSTEMD_ATTENDED_CONFIRM_ONLY=1 \
     SOMA_SYSTEMD_ATTENDED_RUN_ID="$ATTENDED_RUN_ID" \
     SOMA_SYSTEMD_PLAN_CREATED_AT_MS="$PLAN_CREATED_AT_MS" \
     SOMA_SYSTEMD_HOST_ID="$HOST_ID" \
     SOMA_SYSTEMD_HOST_IDENTITY_GENERATION="$HOST_IDENTITY_GENERATION" \
     SOMA_SYSTEMD_UNIT_INVENTORY_ID="$INVENTORY_ID" \
     SOMA_SYSTEMD_UNIT_INVENTORY_GENERATION="$UNIT_INVENTORY_GENERATION" \
     SOMA_SYSTEMD_UNIT_NAME="$UNIT" \
     SOMA_SYSTEMD_LCA_REQUEST_PATH="$LCA_REQUEST_PATH" \
     SOMA_SYSTEMD_SOCKET_PATH=/run/soma/systemd-provider.sock \
     SOMA_LCA_SOCKET_PATH=/run/soma-lca/issuer.sock \
     SOMA_LCA_EXPECTED_SERVER_UID="$LCA_UID" \
     npm --silent --prefix "$SOMA_REPO" run systemd-provider:attended-host \
     | tee "$STAGE/otp-confirmation-result.json"
   OTP_CONFIRM_RC=${PIPESTATUS[0]}
   set -e
   test "$OTP_CONFIRM_RC" -eq 5
   jq -e '
     .outcome == "confirmation_verified" and
     .restart_dispatched == false
   ' "$STAGE/otp-confirmation-result.json"
   ```

5. Stop the captures. Require no `EV_KEY` or text event from interface `00`, no ModHex string in
   the canary field, terminal, clipboard, desktop automation log, harness input, or other
   agent-observable surface. Record the empty capture and unchanged canary:

   ```bash
   for p in "${OTP_PIDS[@]}"; do kill -INT "$p" 2>/dev/null || true; done
   wait "${OTP_PIDS[@]}" 2>/dev/null || true
   ! grep -R -E 'type 1 \\(EV_KEY\\)|Event: time .* type 1' "$STAGE/otp-evtest"
   "$CANARY_READ_COMMAND" >"$STAGE/otp-canary-after.txt"
   cmp -s "$STAGE/otp-canary-before.txt" "$STAGE/otp-canary-after.txt"
   ```

Confirmation-only mode exits immediately after validating the issuer response. It does not create
a confirmation receipt or construct the restart runtime. Do not use the first restart as the OTP
experiment.

The authenticator signature counter advances on every successful touch. The expected sequence is
enrollment baseline, then Gate 6 confirmation-only OTP drill, then Gate 8 restart confirmation,
with a strict increase at each step. The Gate 6 advance is intentional and must not be mistaken
for replay-state drift.

Stop the issuer immediately after the drill:

```bash
systemctl stop soma-local-confirmation-issuer.service
test ! -S /run/soma-lca/issuer.sock
```

Emergency Off on any keyboard event, text change, ambiguity, or inability to observe all relevant
surfaces.

## Gate 7: Preview With All Restart Authority Off

Create a new final-run binding. Preview and dispatch must complete inside its two-minute window:

```bash
export ATTENDED_RUN_ID="restart-$(openssl rand -hex 8)"
export PLAN_CREATED_AT_MS=$(date +%s%3N)
export LCA_REQUEST_PATH=/run/soma-attended/restart-preview.json
```

With `restart_enabled:false`, `controlled_testing:false`, and
`attended_host_activation:false`, run the driver as `soma-harness` with
`SOMA_SYSTEMD_ATTENDED_HOST_RESTART` absent:

```bash
set +e
runuser -u soma-harness -- env -i \
  PATH=/usr/bin:/bin \
  SOMA_SYSTEMD_ATTENDED_HOST_DRIVER=1 \
  SOMA_SYSTEMD_ATTENDED_RUN_ID="$ATTENDED_RUN_ID" \
  SOMA_SYSTEMD_PLAN_CREATED_AT_MS="$PLAN_CREATED_AT_MS" \
  SOMA_SYSTEMD_HOST_ID="$HOST_ID" \
  SOMA_SYSTEMD_HOST_IDENTITY_GENERATION="$HOST_IDENTITY_GENERATION" \
  SOMA_SYSTEMD_UNIT_INVENTORY_ID="$INVENTORY_ID" \
  SOMA_SYSTEMD_UNIT_INVENTORY_GENERATION="$UNIT_INVENTORY_GENERATION" \
  SOMA_SYSTEMD_UNIT_NAME="$UNIT" \
  SOMA_SYSTEMD_LCA_REQUEST_PATH="$LCA_REQUEST_PATH" \
  SOMA_SYSTEMD_SOCKET_PATH=/run/soma/systemd-provider.sock \
  SOMA_LCA_SOCKET_PATH=/run/soma-lca/issuer.sock \
  npm --silent --prefix "$SOMA_REPO" run systemd-provider:attended-host \
  | tee "$STAGE/restart-preview-result.json"
PREVIEW_RC=${PIPESTATUS[0]}
set -e
test "$PREVIEW_RC" -eq 3
jq -e '
  .outcome == "confirmation_required" and
  .restart_dispatched == false
' "$STAGE/restart-preview-result.json"
```

Require exit status `3`, `outcome:"confirmation_required"`,
`restart_dispatched:false`, a root-reviewed exact-plan preview, no LCA connection, and unchanged
`InvocationID`. Copy the preview into the audit directory, then remove the harness-writable copy:

```bash
install -m 0600 -o root -g root "$LCA_REQUEST_PATH" "$STAGE/restart-preview.json"
rm -f "$LCA_REQUEST_PATH"
export EXPECTED_PLAN_DIGEST=$(jq -er '.plan_digest' "$STAGE/restart-preview.json")
```

## Gate 8: One Attended Restart

Obtain a separate explicit Seth approval for the reviewed preview, exact tuple, one touch, and one
restart. Then create the only restart-authorizing inventory:

```bash
jq -n --arg id "$INVENTORY_ID" --arg unit "$UNIT" '{
  schema_version: 1,
  activation_status: "disabled",
  restart_enabled: true,
  controlled_testing: false,
  attended_host_activation: true,
  units: [{inventory_id: $id, unit_name: $unit}]
}' >"$STAGE/provider-inventory-attended-once.json"
```

Require XOR exactly:

```bash
jq -e '
  .restart_enabled == true and
  (.controlled_testing != .attended_host_activation) and
  .controlled_testing == false and
  .attended_host_activation == true
' "$STAGE/provider-inventory-attended-once.json"
```

Install it, restart the provider socket so the provider reloads inventory, start the issuer for
this session only, and verify both endpoints:

```bash
install -m 0640 -o root -g soma-systemd-provider \
  "$STAGE/provider-inventory-attended-once.json" \
  /etc/soma/systemd-provider-inventory.json
systemctl restart soma-systemd-provider.socket
systemctl start soma-local-confirmation-issuer.service
test -S /run/soma/systemd-provider.sock
test -S /run/soma-lca/issuer.sock
```

Run the same bindings before `PLAN_CREATED_AT_MS + 120000`, adding restart authority and the
reviewed digest:

```bash
export LCA_REQUEST_PATH=/run/soma-attended/restart-live-preview.json
set +e
runuser -u soma-harness -- env -i \
  PATH=/usr/bin:/bin \
  SOMA_SYSTEMD_ATTENDED_HOST_DRIVER=1 \
  SOMA_SYSTEMD_ATTENDED_HOST_RESTART=1 \
  SOMA_SYSTEMD_ATTENDED_RUN_ID="$ATTENDED_RUN_ID" \
  SOMA_SYSTEMD_PLAN_CREATED_AT_MS="$PLAN_CREATED_AT_MS" \
  SOMA_SYSTEMD_EXPECTED_PLAN_DIGEST="$EXPECTED_PLAN_DIGEST" \
  SOMA_SYSTEMD_HOST_ID="$HOST_ID" \
  SOMA_SYSTEMD_HOST_IDENTITY_GENERATION="$HOST_IDENTITY_GENERATION" \
  SOMA_SYSTEMD_UNIT_INVENTORY_ID="$INVENTORY_ID" \
  SOMA_SYSTEMD_UNIT_INVENTORY_GENERATION="$UNIT_INVENTORY_GENERATION" \
  SOMA_SYSTEMD_UNIT_NAME="$UNIT" \
  SOMA_SYSTEMD_LCA_REQUEST_PATH="$LCA_REQUEST_PATH" \
  SOMA_SYSTEMD_SOCKET_PATH=/run/soma/systemd-provider.sock \
  SOMA_LCA_SOCKET_PATH=/run/soma-lca/issuer.sock \
  SOMA_LCA_EXPECTED_SERVER_UID="$LCA_UID" \
  npm --silent --prefix "$SOMA_REPO" run systemd-provider:attended-host \
  | tee "$STAGE/restart-result.json"
RESTART_RC=${PIPESTATUS[0]}
set -e
test "$RESTART_RC" -eq 0
jq -e '.outcome == "verified_success"' "$STAGE/restart-result.json"
```

The driver refuses before LCA contact if live inspection does not reproduce
`EXPECTED_PLAN_DIGEST`.

Seth touches once for the fresh exact-plan assertion. Require:

- one successful LCA confirmation with fresh nonce/expiry and strict counter advance;
- exactly one provider restart call;
- `outcome:"verified_success"`;
- a changed, nonempty `InvocationID`;
- expected active/running state and unchanged definition/closure;
- no second dispatch and content-free evidence.

Do not retry on timeout, cancellation, ambiguous provider response, connection loss, or
post-dispatch verification failure. Enter reconciliation instead.

Immediately run Emergency Off. Then verify the throwaway unit's observed state and preserve all
records.

## Final Rollback

After evidence preservation:

```bash
systemctl stop "$UNIT" || true
rm -f "/etc/systemd/system/$UNIT"
systemctl daemon-reload
rm -f /etc/udev/rules.d/71-soma-lca-fido-isolation.rules
rm -f /etc/udev/rules.d/99-soma-lca-fido-isolation.rules
udevadm control --reload
```

Physically replug the key and verify no stale `soma-lca` ownership or ACL remains. Keep credential
policy, enrollment evidence, and replay state sealed for audit unless Seth explicitly decides to
revoke them. Remove binaries, static identities, or stores only after proving no remaining file,
process, unit, ACL, or ownership reference exists.

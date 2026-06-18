#!/usr/bin/env bash
set -euo pipefail

if [[ "${SOMA_SYSTEMD_CONTROLLED_TEST:-}" != "1" ]]; then
  echo "Refusing: set SOMA_SYSTEMD_CONTROLLED_TEST=1 for the privileged disposable-container drill." >&2
  exit 2
fi

compose=(docker compose -f docker-compose.systemd-provider-test.yml)
provider_env=(env SOMA_SYSTEMD_PROVIDER_INVENTORY=/etc/soma/systemd-provider-inventory.json)
provider=(runuser -u soma-systemd-provider -- "${provider_env[@]}" /usr/local/bin/soma-systemd-provider)

cleanup() {
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

"${compose[@]}" up -d --build

for _ in $(seq 1 60); do
  if "${compose[@]}" exec -T systemd-provider-test systemctl is-active --quiet \
    soma-lab-restart-proof.service soma-lab-denied-proof.service; then
    break
  fi
  sleep 1
done

"${compose[@]}" exec -T systemd-provider-test systemctl is-active --quiet \
  soma-lab-restart-proof.service soma-lab-denied-proof.service

request() {
  local method=$1
  local inventory_id=$2
  local request_id=$3
  printf '{"request_id":"%s","method":"%s","inventory_id":"%s"}\n' \
    "$request_id" "$method" "$inventory_id" \
    | "${compose[@]}" exec -T systemd-provider-test "${provider[@]}"
}

before=$(request status_read lab-restart-proof before)
before_digest=$(jq -er '.result.unit_definition_digest' <<<"$before")
before_invocation=$(jq -er '.result.invocation_id' <<<"$before")
[[ $(jq -er '.result.affected_closure' <<<"$before") == "target_only" ]]

"${compose[@]}" exec -T systemd-provider-test sh -c \
  'mkdir -p /etc/systemd/system/soma-lab-restart-proof.service.d &&
   printf "[Service]\nCapabilityBoundingSet=\n" > /etc/systemd/system/soma-lab-restart-proof.service.d/privilege.conf &&
   systemctl daemon-reload'

drifted=$(request restart_inspect lab-restart-proof drifted)
drifted_digest=$(jq -er '.result.unit_definition_digest' <<<"$drifted")
[[ "$before_digest" != "$drifted_digest" ]]

allowed=$(request restart_apply lab-restart-proof allowed)
[[ $(jq -er '.ok' <<<"$allowed") == "true" ]]
after_invocation=$(jq -er '.result.invocation_id' <<<"$allowed")
[[ "$before_invocation" != "$after_invocation" ]]
if grep -Eq 'soma-lab-restart-proof|/usr/bin/sleep|CANARY' <<<"$allowed"; then
  echo "Provider output leaked a real unit identifier or command." >&2
  exit 1
fi

denied=$(request restart_apply lab-denied-proof denied)
[[ $(jq -er '.ok' <<<"$denied") == "false" ]]

"${compose[@]}" exec -T systemd-provider-test systemctl stop soma-lab-denied-proof.service
inactive=$(request restart_apply lab-denied-proof inactive)
[[ $(jq -er '.error.code' <<<"$inactive") == "service_restart_prestate_unsupported" ]]
! "${compose[@]}" exec -T systemd-provider-test systemctl is-active --quiet \
  soma-lab-denied-proof.service

if "${compose[@]}" exec -T systemd-provider-test runuser -u soma-systemd-provider -- \
  busctl call org.freedesktop.systemd1 /org/freedesktop/systemd1 \
  org.freedesktop.systemd1.Manager StopUnit ss \
  soma-lab-restart-proof.service replace >/dev/null 2>&1; then
  echo "Non-restart verb unexpectedly passed polkit." >&2
  exit 1
fi

node scripts/systemd-provider-controlled-runtime.mjs

"${compose[@]}" exec -T systemd-provider-test systemctl is-active --quiet \
  soma-lab-restart-proof.service

echo "systemd provider controlled test: PASS"

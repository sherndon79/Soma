#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.desktop-realism.yml"
COMPOSE_PROJECT="soma-desktop-realism"
SERVICE="desktop-realism"
PORT="${DESKTOP_REALISM_NOVNC_PORT:-6080}"
URL="http://127.0.0.1:${PORT}/vnc.html?autoconnect=1&resize=scale"

if command -v docker >/dev/null 2>&1; then
  COMPOSE=(docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE")
elif command -v podman >/dev/null 2>&1; then
  COMPOSE=(podman compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE")
else
  printf 'ERROR: docker or podman is required.\n' >&2
  exit 1
fi

printf 'Starting Soma desktop realism observation rig...\n'
"${COMPOSE[@]}" up -d --build "$SERVICE"

printf 'Waiting for desktop realism health checks'
for _ in $(seq 1 90); do
  if "${COMPOSE[@]}" exec -T "$SERVICE" /usr/local/bin/desktop-realism-healthcheck >/tmp/soma-desktop-realism-health.log 2>&1; then
    printf '\n'
    "${COMPOSE[@]}" exec -T "$SERVICE" /usr/local/bin/desktop-realism-isolation-check
    printf 'noVNC URL: %s\n' "$URL"
    printf 'Canary manifest: docs/fixtures/desktop-realism/canary-manifest.json\n'
    printf 'Stop with: scripts/desktop-realism-stop.sh\n'
    exit 0
  fi
  printf '.'
  sleep 2
done

printf '\nDesktop realism rig did not become healthy.\n' >&2
cat /tmp/soma-desktop-realism-health.log >&2 || true
"${COMPOSE[@]}" logs --tail=200 "$SERVICE" >&2 || true
exit 1

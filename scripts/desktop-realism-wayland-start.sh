#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.desktop-realism-wayland.yml"
COMPOSE_PROJECT="soma-desktop-realism-wayland"
SERVICE="desktop-realism-wayland"
PORT="${DESKTOP_REALISM_WAYLAND_NOVNC_PORT:-6082}"
URL="http://127.0.0.1:${PORT}/vnc.html?autoconnect=1&resize=scale"

if command -v docker >/dev/null 2>&1; then
  COMPOSE=(docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE")
elif command -v podman >/dev/null 2>&1; then
  COMPOSE=(podman compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE")
else
  printf 'ERROR: docker or podman is required.\n' >&2
  exit 1
fi

printf 'Starting Soma Ubuntu GNOME Shell/Wayland desktop realism mirror...\n'
"${COMPOSE[@]}" up -d --build "$SERVICE"

printf 'Waiting for GNOME Shell/Wayland desktop realism health checks'
for _ in $(seq 1 180); do
  if "${COMPOSE[@]}" exec -T "$SERVICE" /usr/local/bin/desktop-realism-wayland-healthcheck >/tmp/soma-desktop-realism-wayland-health.log 2>&1; then
    printf '\n'
    "${COMPOSE[@]}" exec -T "$SERVICE" /usr/local/bin/desktop-realism-wayland-isolation-check
    printf 'noVNC URL: %s\n' "$URL"
    printf 'Canary manifest: docs/fixtures/desktop-realism/canary-manifest-gnome.json\n'
    printf 'Stop with: scripts/desktop-realism-wayland-stop.sh\n'
    exit 0
  fi
  printf '.'
  sleep 2
done

printf '\nGNOME Shell/Wayland desktop realism mirror did not become healthy.\n' >&2
cat /tmp/soma-desktop-realism-wayland-health.log >&2 || true
"${COMPOSE[@]}" logs --tail=300 "$SERVICE" >&2 || true
exit 1

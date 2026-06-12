#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.desktop-realism-wayland.yml"
COMPOSE_PROJECT="soma-desktop-realism-wayland"

if command -v docker >/dev/null 2>&1; then
  COMPOSE=(docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE")
elif command -v podman >/dev/null 2>&1; then
  COMPOSE=(podman compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE")
else
  printf 'ERROR: docker or podman is required.\n' >&2
  exit 1
fi

"${COMPOSE[@]}" down
printf 'Soma Ubuntu GNOME Shell/Wayland desktop realism mirror stopped.\n'

#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.gpu.yml"
LLM_URL="${SOMA_LLM_URL:-http://127.0.0.1:8000}"
LLM_MODEL="${SOMA_LLM_MODEL:-ciocan/gemma-4-E4B-it-W4A16}"
SOMA_URL="${SOMA_URL:-http://127.0.0.1:${SOMA_PORT:-8765}}"

FAILED=0

section() {
  printf '\n== %s ==\n' "$1"
}

fail() {
  FAILED=1
  printf 'FAIL: %s\n' "$1"
}

pass() {
  printf 'OK: %s\n' "$1"
}

section "Docker Compose"
if command -v docker >/dev/null 2>&1; then
  if docker compose -f "$COMPOSE_FILE" ps; then
    pass "compose status available"
  else
    fail "compose status unavailable"
  fi
else
  fail "docker command not found"
fi

section "vLLM Health"
if curl -fsS "${LLM_URL}/health" >/dev/null; then
  pass "${LLM_URL}/health"
else
  fail "${LLM_URL}/health"
fi

section "vLLM Models"
MODELS_JSON="$(curl -fsS "${LLM_URL}/v1/models" 2>/dev/null || true)"
if [[ -n "$MODELS_JSON" ]]; then
  printf '%s\n' "$MODELS_JSON"
  if printf '%s' "$MODELS_JSON" | grep -q "$LLM_MODEL"; then
    pass "model listed: ${LLM_MODEL}"
  else
    fail "model not listed: ${LLM_MODEL}"
  fi
else
  fail "${LLM_URL}/v1/models"
fi

section "vLLM Chat Probe"
CHAT_STATUS="$(
  curl -sS -o /tmp/soma-vllm-probe.json -w '%{http_code}' \
    -H 'content-type: application/json' \
    -X POST "${LLM_URL}/v1/chat/completions" \
    --data "{\"model\":\"${LLM_MODEL}\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: soma runtime ready\"}],\"max_tokens\":16,\"temperature\":0}" \
    2>/tmp/soma-vllm-probe.err || true
)"
if [[ "$CHAT_STATUS" == "200" ]]; then
  cat /tmp/soma-vllm-probe.json
  printf '\n'
  pass "vLLM chat completion"
else
  cat /tmp/soma-vllm-probe.err 2>/dev/null || true
  fail "vLLM chat completion HTTP ${CHAT_STATUS:-unavailable}"
fi

section "Soma Service"
if curl -fsS "${SOMA_URL}/health" >/dev/null 2>&1; then
  pass "${SOMA_URL}/health"

  SOMA_STATUS="$(
    curl -sS -o /tmp/soma-chat-probe.json -w '%{http_code}' \
      -H 'content-type: application/json' \
      -X POST "${SOMA_URL}/chat" \
      --data "{\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: soma policy path ready\"}],\"max_tokens\":20,\"temperature\":0}" \
      2>/tmp/soma-chat-probe.err || true
  )"
  if [[ "$SOMA_STATUS" == "200" ]]; then
    cat /tmp/soma-chat-probe.json
    printf '\n'
    pass "Soma policy-gated chat"
  else
    cat /tmp/soma-chat-probe.err 2>/dev/null || true
    fail "Soma policy-gated chat HTTP ${SOMA_STATUS:-unavailable}"
  fi
else
  printf 'SKIP: Soma service is not listening at %s\n' "$SOMA_URL"
fi

exit "$FAILED"

# Soma

Soma is a local-first agent harness for desktop interaction, memory, tools, perception, and
embodied presence.

The first implementation slice is intentionally narrow: a dependency-free local service that
exposes a conservative base harness, routes chat to a local vLLM/OpenAI-compatible model, and
puts early local capabilities behind policy checks and provenance.

Current scaffold capabilities include local chat, ephemeral session memory, in-process
provenance, text-only cognitive-load stewardship, scoped file reads, and read-only desktop
inspection readiness.

## Architecture Direction

Soma's early service plane is implemented in Node.js for fast iteration on HTTP, JSON, policy,
CLI, provenance, local model orchestration, and MCP-facing glue. Future nervous-system executors,
especially desktop/host-control bridges, are expected to move into small Rust helper processes
where native D-Bus, portals, input helpers, and privilege boundaries matter more.

Node remains the policy/provenance authority for now. Rust helpers should execute bounded
capabilities and return structured results.

## Run

```bash
npm start
```

Defaults:

- service: `http://127.0.0.1:8765`
- local model endpoint: `http://127.0.0.1:8000`
- model: `ciocan/gemma-4-E4B-it-W4A16`

Environment variables:

- `SOMA_PORT`
- `SOMA_LLM_URL`
- `SOMA_LLM_MODEL`

Runtime profiles are defined in [config/runtime-profiles.json](./config/runtime-profiles.json).
Self-scoped narrowing modules are defined in [config/harness-modules.json](./config/harness-modules.json).

## Desktop Broker Helper

The desktop inspection endpoint currently has a Node fallback probe. A Rust helper scaffold is
also present for the future nervous-system boundary:

```bash
npm run desktop-broker:build
./target/debug/soma-desktop-broker inspect-environment
./target/debug/soma-desktop-broker inspect-atspi
```

When `./target/debug/soma-desktop-broker` exists, Soma uses it for desktop inspection. Override
with `SOMA_DESKTOP_BROKER=/path/to/soma-desktop-broker`. The AT-SPI probe is read-only and returns
bounded participant/root-object metadata; it does not extract text content, capture screenshots, or
perform desktop actions.

## CLI

The local CLI talks to the running Soma service:

```bash
npm run cli -- status
npm run cli -- chat "hello"
npm run cli -- chat "help me slow this down" --assess-load
npm run cli -- modules list
npm run cli -- modules adopt soma.module.no-session-memory
npm run cli -- memory add "Session note" --role note
npm run cli -- files read README.md
npm run cli -- desktop inspect
npm run cli -- desktop inspect --mode atspi --json
npm run cli -- provenance summary
npm run cli -- stewardship assess "I feel overwhelmed and need a break"
```

Use `--json` on any command to print the full API response.

## Endpoints

- `GET /health`
- `GET /harness`
- `GET /harness-modules`
- `POST /harness-modules/adopt`
- `POST /harness-modules/drop`
- `GET /session-memory`
- `POST /session-memory`
- `DELETE /session-memory`
- `GET /provenance`
- `GET /provenance/summary`
- `DELETE /provenance`
- `POST /stewardship/cognitive-load`
- `POST /files/read`
- `POST /desktop/inspect/accessibility-tree`
- `POST /chat`

## Test

```bash
npm test
```

## Smoke Check

With the local model runtime running, check the stack:

```bash
./scripts/check-local-runtime.sh
```

## Local Model Runtime

For MVP testing, Soma includes an optional GPU compose file that mirrors the current
TheCommons Gemma/vLLM setup:

```bash
docker compose -f docker-compose.gpu.yml up gemma4-llm
```

Then run Soma in another shell:

```bash
npm start
```

The Soma service defaults to `SOMA_LLM_URL=http://127.0.0.1:8000`, matching the compose port.

## Docs

Start with [docs/README.md](./docs/README.md).

Project direction is tracked in [ROADMAP.md](./ROADMAP.md).

## License

Licensed under the [Apache License 2.0](./LICENSE).

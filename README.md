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
- `SOMA_SENSORIUM_ENABLED`
- `SOMA_SENSOR_BROKER`

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
bounded participant, root-object, and shallow child role/count metadata; it does not extract child
names, text content, capture screenshots, or perform desktop actions.

The current desktop inspection output contract is documented in
[docs/schemas/desktop-inspection-result.schema.json](./docs/schemas/desktop-inspection-result.schema.json).
Future recursive traversal is expected to depend on an in-process
[desktop disclosure registry](./docs/concepts/drafts/desktop_disclosure_registry.md) before any
helper receives a traversal root. The future path for exposing opaque root ids is documented in
[desktop root ref exposure](./docs/concepts/drafts/desktop_root_ref_exposure.md), and future
request validation is documented in
[desktop traversal request validation](./docs/concepts/drafts/desktop_traversal_request_validation.md).
Future traversal provenance is expected to remain summary-only by default, as documented in
[desktop traversal provenance](./docs/concepts/drafts/desktop_traversal_provenance.md).
The remaining gates before traversal can be enabled are ordered in
[desktop traversal enablement sequence](./docs/concepts/drafts/desktop_traversal_enablement_sequence.md).

## Sensorium Runtime

Sensorium integration is default-off. The service only constructs the sensor broker helper and
subscriber when explicitly enabled:

```bash
SOMA_SENSORIUM_ENABLED=1 npm start
```

Override the helper path with `SOMA_SENSOR_BROKER=/path/to/soma-sensor-broker`. No Sensorium grants
ship in `config/grants.json`, so subscription requests still fail closed until an explicit active
grant exists for the exact `perception.sensorium.*.subscribe` capability.

## CLI

The local CLI talks to the running Soma service:

```bash
npm run cli -- status
npm run cli -- chat "hello"
npm run cli -- chat "help me slow this down" --assess-load
npm run cli -- chat "this task may need a stronger planner" --assess-escalation --json
npm run cli -- capabilities
npm run cli -- notifications
npm run cli -- modules list
npm run cli -- modules adopt soma.module.no-session-memory
npm run cli -- grants list
npm run cli -- proposals list
npm run cli -- proposals show proposal-id
npm run cli -- proposals approve proposal-id --scope session
npm run cli -- proposals deny proposal-id --reason "Not needed right now."
npm run cli -- memory add "Session note" --role note
npm run cli -- files read README.md
npm run cli -- desktop inspect
npm run cli -- desktop inspect --mode atspi
npm run cli -- desktop focus
npm run cli -- desktop inspect --mode atspi --max-apps 8 --max-children 2
npm run cli -- desktop inspect --mode atspi --json
npm run cli -- provenance summary
npm run cli -- provenance list --capability desktop.inspect.accessibility_tree
npm run cli -- stewardship assess "I feel overwhelmed and need a break"
```

Use `--json` on any command to print the full API response. `desktop inspect`,
`provenance summary`, and `provenance list` print concise operator summaries by default; full
records stay behind `--json`.

## Endpoints

- `GET /health`
- `GET /harness`
- `GET /capability-view`
- `GET /notifications`
- `GET /harness-modules`
- `POST /harness-modules/adopt`
- `POST /harness-modules/drop`
- `GET /grants`
- `GET /capability-proposals`
- `GET /capability-proposals/:id`
- `POST /capability-proposals`
- `POST /capability-proposals/:id/approve`
- `POST /capability-proposals/:id/deny`
- `GET /session-memory`
- `POST /session-memory`
- `DELETE /session-memory`
- `GET /provenance`
- `GET /provenance/summary`
- `DELETE /provenance`
- `POST /stewardship/cognitive-load`
- `POST /files/read`
- `POST /desktop/inspect/accessibility-tree`
- `POST /desktop/inspect/focus`
- `POST /chat`

## Test

```bash
npm test
```

Opt-in local-model capability evals require the local OpenAI-compatible model runtime:

```bash
npm run eval:capabilities
```

Current eval scenarios cover focused desktop inspection, excluded desktop actuation, and
unsupported remote planning.

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

Start with [docs/README.md](./docs/README.md). For current runbook-style usage, see
[docs/operators.md](./docs/operators.md).

Project direction is tracked in [ROADMAP.md](./ROADMAP.md).

## License

Licensed under the [Apache License 2.0](./LICENSE).

# MVP Slice

Status: current implementation scaffold

This document defines Soma's first concrete implementation boundary.

The goal is not to build the full agent harness. The goal is to build the smallest local service
that proves Soma's core shape across several narrow local capabilities:

**capability goes through policy before it reaches a model, memory, tool, perception channel, or
remote service.**

## MVP Goal

Soma should run locally and expose a policy-gated service scaffold backed by an existing local
model runtime.

The scaffold currently includes:

- local chat through a configured runtime profile
- ephemeral session memory
- in-process provenance
- text-only cognitive-load stewardship
- scoped read-only file access
- read-only desktop broker environment inspection
- self-scoped narrowing modules that can revoke enabled capabilities

Initial target:

- local service process
- base harness manifest
- runtime profile config
- self-scoped narrowing module registry
- capability vocabulary
- `/health`
- `/harness`
- `/harness-modules`
- `/session-memory`
- `/provenance`
- `/stewardship/cognitive-load`
- `/files/read`
- `/desktop/inspect/accessibility-tree`
- `/chat`
- local vLLM-compatible model backend
- request provenance
- ephemeral session memory only
- no durable memory
- no filesystem writes
- no shell execution
- no visual/audio perception
- no remote model routing

## Why This Slice

The first implementation should prove the control plane while adding only narrow, inspectable
power.

If Soma begins with tools, memory, camera, desktop control, or remote routing before the policy
path exists, the project will inherit the same shape it is trying to avoid: capability first,
governance later.

This slice keeps capability narrow enough to implement while making the policy layer real.
Read-only file access and desktop inspection readiness are included because they exercise the
same policy/provenance path that future desktop power will need, without enabling actuation.

## Service Shape

```text
Client / CLI / Local UI
        |
    Soma API
        |
 Policy Gateway
        |
 Local Capability Services
        |
 Model Runtime | Session Memory | File Read | Desktop Broker Probe | Stewardship
```

The policy gateway should be on the request path for every enabled capability, including local
chat, memory, file reads, stewardship assessment, and desktop inspection.

## Initial Endpoints

### `GET /health`

Returns service health and the read-only runtime write posture.

Minimum response:

```json
{
  "status": "ok",
  "runtime_writes_enabled": false,
  "runtime_write_posture": {
    "runtime_writes_enabled": false,
    "durable_grant_mutation_enabled": false,
    "activation_supported": false,
    "requested": false,
    "status": "disabled"
  }
}
```

### `GET /harness`

Returns the effective base harness manifest.

This should make current capability terms and runtime profiles visible rather than implicit.

### `GET /capability-view`

Returns a read-only initialization/review view derived from the capability catalog, provider
registry, and effective harness. The view groups capabilities by category and status:

- `active`
- `requestable`
- `unsupported`
- `disabled`
- `forbidden`
- `excluded`

The capability view does not activate or grant capabilities.

### `GET /notifications`

Returns pending review notifications. The current implementation derives notifications from
pending capability proposals and includes action paths for show, approve, and deny.

Notification surfacing does not create grants or activate capabilities.

### `GET /harness-modules`

Returns approved visible harness modules and the current active module stack.
Also includes the current pending capability proposal count.

MVP modules are self-scoped narrowing overlays only.

### `POST /harness-modules/adopt`

Adopts an approved `impact_scope=self`, `capability_effect=narrowing`,
`adoption_policy=self_apply` module.

Widening, shared, or governance-mediated modules are not part of the MVP.

### `POST /harness-modules/drop`

Drops a previously adopted module from the active stack.

Dropping a module restores the base harness posture plus any remaining active modules.

### `GET /capability-proposals`

Returns in-memory capability proposals. Supports `status=pending`.

### `GET /capability-proposals/:id`

Returns the full review context for one proposal, including reason, requested scope, exposed data,
exclusions, risk, fallback, decision state, and activation status.

### `POST /capability-proposals`

Creates an in-memory pending capability proposal. Proposal creation requires requester,
capability, reason, requested scope, data exposure, risk, and fallback. It records
`capability.proposal.created` provenance and does not activate any capability.

### `POST /capability-proposals/:id/approve`

Marks a pending proposal approved with an explicit approved scope. It records
`capability.proposal.approved` provenance and does not activate any capability.

### `POST /capability-proposals/:id/deny`

Marks a pending proposal denied with a denial reason. It records
`capability.proposal.denied` provenance and does not activate any capability.

### `GET /grants`

Returns the file-backed grant store in a read-only operator shape. Supports status filters such as
`status=active` and `status=revoked`.

The grant list route does not write grants, revoke grants, or activate capabilities. It exists so
grant records have an inspectable shape before any widening path can depend on them.
Revoked grant records may include `revoked_at`, `revoked_by`, `revocation_reason`, and
`replacement_grant_id`.
The response also includes the same non-authorizing runtime write posture surfaced by health.

### `GET /grants/recovery`

Returns the current grant mutation recovery inspection summary when one is provided to the request
handler. If no recovery inspection is available, the route reports `ok: null` instead of treating
absence as a clean recovery state.

Recovery findings are bounded operator metadata: code, grant id, status, capability, provider,
scope, authorizing safety, and small mismatch descriptors such as event type or field name. The
route may also report durable provenance read failure class. It does not expose mismatch values,
grant reason text, payloads, activate capabilities, or mutate the grant store.
The response includes runtime write posture so recovery inspection can show whether runtime writes
are currently enabled without treating that posture as grant authority.

The server startup path composes the read-only grant store with append-only grant mutation
provenance inspection. Missing provenance for active durable grants produces degraded recovery
findings; unreadable provenance produces non-authorizing findings instead of silently authorizing
durable grants.

### `POST /grants`

Creates a durable grant only when the server is started with `SOMA_RUNTIME_WRITES_ENABLED=1`.
Without that opt-in, this route returns `durable_grant_mutation_not_enabled` with `durable: false`,
`grant_written: false`, `provenance_appended: false`, `activation_performed: false`, and the runtime
write posture. With the opt-in, it validates the request, writes the grant store, appends mutation
provenance, refreshes recovery inspection, and still does not activate capability use.

### `POST /grants/:id/revoke`

Revokes a durable grant only when the server is started with `SOMA_RUNTIME_WRITES_ENABLED=1`.
Without that opt-in, this route returns `durable_grant_mutation_not_enabled` with the requested
grant id and the same non-writing, non-activation flags as durable create denial. With the opt-in,
it writes terminal grant metadata, appends revocation provenance, refreshes recovery inspection, and
does not repair recovery or activate/deactivate provider sessions outside the grant authority change.

### `POST /grants/mutation-previews`

Validates a future durable grant creation or revocation request without writing the grant store or
appending provenance. The route returns a metadata-only grant mutation event preview, receipt
preview, and next-store summary with `dry_run: true`.

The route is intentionally distinct from the reserved active mutation routes. It refuses degraded
recovery state before previewing authority changes and always reports `durable: false`,
`grant_written: false`, `provenance_appended: false`, and `activation_performed: false`.
Unsupported mutation kinds and malformed preview inputs fail as dry-run refusals with the same
non-writing and non-activation flags. Degraded recovery refusals also include those flags before
returning bounded recovery findings.

Reserved future mutation routes are documented in the grant lifecycle draft, but are not
implemented in the MVP.

### `POST /chat`

Sends a chat request to the local model runtime only when `model.local.chat` is allowed.

The request should include:

- messages
- optional `model_profile`
- optional max tokens
- optional temperature
- optional `use_session_memory`
- optional `write_session_memory`

The response should include:

- model response text
- model id/profile actually used
- capability used
- provenance id
- whether any remote service was used
- whether ephemeral session memory was read or written

For MVP, remote service should always be `false`.

Unknown runtime profiles fail closed. Remote profiles require `model.remote.chat`, which is
disabled in the MVP base harness.

### `GET /session-memory`

Returns ephemeral in-process session memory when `memory.session.read` is allowed.

### `POST /session-memory`

Writes an explicit ephemeral memory entry when `memory.session.write` is allowed.
Records a `memory.session.written` provenance event with metadata only, not memory content.

### `DELETE /session-memory`

Clears ephemeral session memory when `memory.session.write` is allowed.
Records a `memory.session.cleared` provenance event with the removed entry count.

Session memory is not durable memory. It is lost when the Soma process stops.

### `GET /provenance`

Returns the in-process provenance log when `provenance.read` is allowed.

Optional filters:

- `allowed=true|false`
- `capability=<capability key>`
- `event_type=<event type>`
- `limit=<positive integer>`

### `GET /provenance/summary`

Returns aggregate counts for provenance entries when `provenance.read` is allowed.

### `DELETE /provenance`

Clears the in-process provenance log when `provenance.clear` is allowed.

The MVP provenance log is not durable. It is lost when the Soma process stops.
The CLI prints concise provenance summaries and list views by default and keeps full records behind
`--json`.

### `POST /stewardship/cognitive-load`

Assesses submitted text for cognitive-load stewardship signals when
`stewardship.cognitive_load.assess` is allowed.

The assessment is text-only, non-diagnostic, non-blocking, and writes no memory. It may return a
gentle advisory with choices such as summarize, slow down, pause, or continue.

Standalone stewardship assessments are recorded in provenance as
`stewardship.cognitive_load.assessed` events. The event records assessment metadata, such as
whether an advisory was needed, but does not store the submitted text.

### `POST /files/read`

Reads a UTF-8 text file when `tool.files.read` is allowed and the resolved real path is inside a
granted `filesystem.read_roots` entry.

The response includes file content and metadata. Provenance records `tool.files.read` with path,
root, and byte count, but does not duplicate file content.

### `POST /desktop/inspect/accessibility-tree`

Returns read-only desktop broker metadata when `desktop.inspect.accessibility_tree` is allowed.

By default the endpoint reports platform, session, D-Bus, display, and candidate adapter
availability. With `{ "mode": "atspi" }`, it asks the Rust helper for a bounded AT-SPI probe that
lists bus participant metadata, application root-object metadata, and shallow child role/count
metadata when available. The current scaffold does not recursively traverse AT-SPI child objects,
read child names/descriptions, extract text content, take screenshots, or perform actuation.
Callers may pass `max_apps` and `max_children` to narrow the returned application list and root
child samples after broker output validation. Provenance records requested mode and requested
limits separately from returned object counts.

### `POST /desktop/inspect/focus`

Returns read-only focused-object metadata when an active runtime grant authorizes
`desktop.inspect.focus`.

The base harness keeps this capability disabled. Use requires `grant_id` plus a matching provider
and scope; the route validates grant status, catalog membership, provider support, and grant
recovery before helper invocation. When authorized, the endpoint returns focus availability,
broker/session metadata, focused object role, child count, service/path references,
withheld-field markers, and provenance including grant id/provider/scope. It rejects
`include_text=true` and does not return focused names, descriptions, text, states, actions,
screenshots, pointer position, keyboard input, or actuation.

## Initial Capability Vocabulary

Capability keys should be stable strings. They will become the policy language shared by
manifests, modules, audit records, UI, and future tools.

### Model

- `model.local.chat` — send chat prompts to a local model runtime
- `model.local.tool_calls` — allow local model tool-call planning
- `model.remote.chat` — send chat prompts to a remote model provider
- `model.remote.tool_calls` — allow remote model tool-call planning
- `model.remote.plan` — escalate a task to a remote model for structured planning, with each plan
  step validated against the active harness before local execution; distinct from
  `model.remote.chat` because the planner influences local execution paths, not only the
  user-facing response. See
  [Escalation and Planning](../concepts/drafts/escalation_and_planning.md).

MVP enables local chat only for model routing. Tool-call planning, remote chat, and remote
planning remain disabled.

### Memory

- `memory.session.read` — read ephemeral session context
- `memory.session.write` — write ephemeral session context
- `memory.durable.read` — read durable memory
- `memory.durable.write` — write durable memory
- `memory.export` — export memory outside Soma
- `memory.forget` — remove or tombstone stored memory

MVP enables ephemeral session memory. Durable memory remains disabled.

### Provenance

- `provenance.read` — read the in-process provenance log
- `provenance.clear` — clear the in-process provenance log

### Stewardship

- `stewardship.cognitive_load.assess` — assess submitted text for non-diagnostic pacing signals

### Desktop

- `desktop.inspect.accessibility_tree` — inspect bounded desktop environment, application root
  objects, and shallow child role/count metadata
- `desktop.inspect.windows` — inspect window-level metadata beyond the root-object sample
- `desktop.inspect.focus` — inspect currently focused desktop or accessibility object metadata
- `desktop.inspect.text` — inspect text content, child names, descriptions, or other sensitive UI
  text

### Tools

- `tool.files.read` — read files within granted scope
- `tool.files.write` — write files within granted scope
- `tool.shell.run` — run shell commands
- `tool.browser.use` — operate a browser context
- `tool.desktop.actuate` — operate desktop UI directly
- `tool.network.call` — call external network services

MVP enables read-only file access within granted scopes. `desktop.inspect.accessibility_tree` is
enabled for the current bounded read-only AT-SPI probe. Desktop windows, focus, text inspection,
file writes, and other tool capabilities remain disabled.

### Perception

- `perception.screen` — inspect screen or application state
- `perception.remote_desktop.video.subscribe` — receive a bounded graphical stream from a local or
  remote desktop session
- `perception.camera` — inspect camera/video input
- `perception.microphone` — inspect microphone input
- `perception.filesystem_context` — infer context from files or project structure
- `perception.sensorium.color.subscribe` — subscribe to Sensorium color frames from an authorized
  host/topic
- `perception.sensorium.depth.subscribe` — subscribe to Sensorium depth maps from an authorized
  host/topic
- `perception.sensorium.imu.subscribe` — subscribe to Sensorium IMU samples from an authorized
  host/topic
- `perception.sensorium.location.subscribe` — subscribe to Sensorium static location metadata from
  an authorized host/topic
- `perception.sensorium.status.subscribe` — subscribe to Sensorium status/liveness metadata from an
  authorized host/topic

MVP does not enable perception beyond submitted chat text by default. Sensorium subscription
capabilities exist in the catalog and provider registry, and the HTTP seam exists for injected test
or opt-in runtimes, but default server startup does not configure a subscriber and
`config/grants.json` does not include active Sensorium grants.

Remote graphical sessions, including possible Sunshine/Moonlight support, remain unimplemented and
disabled. They should be treated as high-risk visual perception and separate input-actuation
surfaces, not as the default local desktop API. Local semantic inspection remains the preferred
local host path.

### Embodiment

- `embodiment.visual.show` — render an agent presence
- `embodiment.voice.speak` — speak responses aloud
- `embodiment.state.display` — display listening/thinking/paused/unavailable state

MVP may omit embodiment entirely or expose only a CLI/text UI.

## Base Harness Defaults

The MVP base harness should be conservative.

Default posture:

- local chat allowed
- ephemeral session memory read/write allowed
- in-process provenance read/clear allowed
- text-only cognitive-load stewardship allowed
- file read allowed within granted `filesystem.read_roots`
- read-only desktop inspection scaffold allowed
- remote model calls disabled
- durable memory disabled
- filesystem write disabled
- shell disabled
- camera disabled
- microphone disabled
- screen inspection disabled
- tool calls disabled
- no training/export of conversation data
- provenance recorded for requests handled by Soma

Active self-scoped narrowing modules may further reduce these defaults. The effective harness is
what `/chat` uses for policy checks.

## Manifest Sketch

The first manifest can be JSON or YAML. A JSON sketch:

```json
{
  "schema_version": 1,
  "harness_id": "soma.base",
  "name": "Soma Base Harness",
  "mode": "local_text",
  "capabilities": [
    {
      "key": "model.local.chat",
      "status": "allowed",
      "revocable": true,
      "description": "Send chat prompts to the configured local model runtime."
    },
    {
      "key": "model.remote.chat",
      "status": "disabled",
      "requires": "explicit_grant",
      "description": "Send prompts to a remote model provider."
    },
    {
      "key": "memory.durable.write",
      "status": "disabled",
      "requires": "explicit_grant",
      "description": "Persist durable memory beyond the current session."
    },
    {
      "key": "tool.shell.run",
      "status": "disabled",
      "requires": "explicit_grant",
      "description": "Run shell commands on the host."
    }
  ],
  "disclosure": {
    "remote_services_used": false,
    "memory_writes_enabled": false,
    "perception_mode": "submitted_text_only"
  }
}
```

## Provenance

Each `/chat` request should get a provenance id.

Minimum provenance fields:

- request id
- timestamp
- capability used
- local/remote route
- model profile
- caller identity if available
- whether memory was read
- whether memory was written
- whether tools were available
- whether cognitive-load stewardship was assessed
- whether the request was allowed
- denial reason when the harness blocks the request

For MVP, provenance can be logged to stdout or a local append-only development log.

The current implementation stores provenance in a bounded in-process log and also logs to stdout.
Denied `/chat` attempts are recorded when the runtime profile can be resolved, so self-applied
module blocks are inspectable without granting the blocked capability.
Harness module adoption and drop events are also recorded so changes to the active capability
surface are visible.
Standalone cognitive-load stewardship assessments are recorded without retaining submitted text.

Current event types include:

- `model.chat.completed`
- `model.chat.denied`
- `harness.module.adopted`
- `harness.module.dropped`
- `memory.session.written`
- `memory.session.cleared`
- `stewardship.cognitive_load.assessed`
- `tool.files.read`
- `desktop.inspect.accessibility_tree`

## Runtime Profiles

Runtime profiles live in `config/runtime-profiles.json`.

The initial profile is `gemma4-local`, which points at the local vLLM/OpenAI-compatible endpoint
and is classified as `route=local`.

## Harness Modules

Harness modules live in `config/harness-modules.json`.

The MVP includes only self-scoped narrowing modules:

- `soma.module.pause-local-chat` disables `model.local.chat`
- `soma.module.local-only` keeps remote model/network posture disabled
- `soma.module.no-session-memory` disables `memory.session.read` and `memory.session.write`
- `soma.module.no-cognitive-load-stewardship` disables `stewardship.cognitive_load.assess`
- `soma.module.no-file-read` disables `tool.files.read`
- `soma.module.no-desktop-inspection` disables `desktop.inspect.accessibility_tree`

The important behavior is enforcement: if a module disables `model.local.chat`, `/chat` fails
closed until the module is dropped.

## Out Of Scope

These are explicitly out of scope for MVP:

- durable memory
- vector database
- file editing
- shell execution
- browser automation
- camera/microphone/screen perception
- visual embodiment
- module registry
- multi-agent routing
- cloud bridge
- TheCommons integration
- Sanctuary integration

Leaving these out is intentional. The policy path should exist before these powers are added.

## First Validation

The MVP is valid when:

- `GET /health` succeeds
- `GET /harness` returns visible base terms
- `POST /chat` succeeds through the policy gateway using local vLLM
- disabling `model.local.chat` causes `/chat` to fail closed
- response metadata discloses local model use and no remote service
- session memory can be written, read, cleared, and audited without durable persistence
- provenance can be listed, filtered, summarized, and cleared
- cognitive-load stewardship can be assessed and revoked
- file reads are confined to granted roots and can be revoked
- desktop inspection readiness reports environment metadata and can be revoked
- request and capability provenance is recorded

## Initial Implementation

The first implementation lives in the repository root as a dependency-free Node service:

- `src/server.js` starts the local service on `127.0.0.1:${SOMA_PORT:-8765}`
- `src/app.js` defines the HTTP routes and policy checks
- `src/harness.js` loads and checks the base harness manifest
- `src/harnessModules.js` applies self-scoped narrowing modules
- `src/modelClient.js` calls a vLLM/OpenAI-compatible local model endpoint
- `src/sessionMemory.js` stores ephemeral in-process memory
- `src/provenanceLog.js` stores bounded in-process provenance
- `src/fileAccess.js` enforces scoped read-only file access
- `src/desktopBroker.js` probes desktop broker environment readiness and uses the Rust helper
  when available
- `src/cli.js` provides the local operator CLI
- `crates/soma-desktop-broker` scaffolds the future Rust nervous-system helper
- `config/base-harness.json` defines the conservative MVP base harness

Useful environment variables:

- `SOMA_PORT` — local service port, default `8765`
- `SOMA_LLM_URL` — local model endpoint, default `http://127.0.0.1:8000`
- `SOMA_LLM_MODEL` — local model id, default `ciocan/gemma-4-E4B-it-W4A16`

Run locally:

```bash
npm start
```

Run tests:

```bash
npm test
```

Smoke-check local runtime:

```bash
./scripts/check-local-runtime.sh
```

Optional local model runtime:

```bash
docker compose -f docker-compose.gpu.yml up gemma4-llm
```

## Next Slice Candidates

After MVP:

- local-only escalation trigger surfacing without remote routing
- remote-planning provider contract design without provider registration
- provider-overreach tests for broader desktop inspection
- clearer module/provenance UI surface
- durable memory design with explicit write boundaries
- remote model bridge with disclosure and explicit consent

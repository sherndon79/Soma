# First Run And Onboarding

Status: initial first-run sketch for the local MVP

This guide describes how a new participant should first encounter Soma. It is intentionally calmer
than the operator guide. The goal is orientation, not permission fatigue.

## What Soma Should Communicate First

On first run, Soma should make the current posture understandable:

```text
Soma is running local-first.

Active:
- local model chat
- ephemeral session memory
- read-only project file access within configured roots
- read-only bounded desktop accessibility metadata
- provenance summaries
- text-only cognitive-load stewardship

Disabled:
- remote model calls
- durable memory
- file writes
- shell commands
- camera, microphone, and screen perception
- desktop text inspection
- keyboard or pointer control

Nothing here activates hidden remote services or desktop actuation.
```

The exact UI can change, but the information should stay stable:

- what is active
- what is disabled
- what is unsupported
- what can be revoked
- what needs explicit approval
- what Soma will not do

## Start The Local Runtime

If using the included GPU compose setup:

```bash
docker compose -f docker-compose.gpu.yml up gemma4-llm
```

Then start Soma in another shell:

```bash
npm start
```

Soma listens on `http://127.0.0.1:8765` by default. The local model runtime is expected at
`http://127.0.0.1:8000` unless `SOMA_LLM_URL` is set.

## First Checks

Check service status:

```bash
npm run cli -- status
```

Inspect the current capability posture:

```bash
npm run cli -- capabilities
```

Inspect available narrowing modules:

```bash
npm run cli -- modules list
```

Send a local chat message:

```bash
npm run cli -- chat "hello"
```

## Understanding The Capability View

The capability view is read-only. It does not grant or activate anything.

Status classes:

- `active`: available now
- `requestable`: known, supported, disabled, and eligible for proposal
- `unsupported`: known, but no installed provider/runtime supports it
- `disabled`: not currently allowed
- `forbidden`: intentionally non-activatable
- `excluded`: explicitly outside the current request or active module posture

The concise view groups by category. Use JSON when exact keys or provider claims matter:

```bash
npm run cli -- capabilities --json
```

## Revoking Current Capabilities

Soma supports self-scoped narrowing modules. These reduce capability for the current service
process.

Disable desktop inspection:

```bash
npm run cli -- modules adopt soma.module.no-desktop-inspection
```

Disable session memory:

```bash
npm run cli -- modules adopt soma.module.no-session-memory
```

Disable file reads:

```bash
npm run cli -- modules adopt soma.module.no-file-read
```

Restore by dropping a module:

```bash
npm run cli -- modules drop soma.module.no-desktop-inspection
```

Modules are in-process state. Restarting Soma clears the active module stack.

## Capability Proposals

Capability proposals are reviewable requests. They do not activate anything in the current
implementation.

Current proposal commands:

```bash
npm run cli -- proposals list
npm run cli -- proposals approve proposal-id --scope session
npm run cli -- proposals deny proposal-id --reason "Not needed right now."
```

Approval records a decision and provenance. It still does not widen the harness.

Future first-run UI should explain this distinction plainly:

```text
Approving records your decision.
Activation is separate and not automatic.
```

## Desktop Inspection

The current desktop path is read-only.

Build the helper:

```bash
npm run desktop-broker:build
```

Run a bounded inspection:

```bash
npm run cli -- desktop inspect --mode atspi
```

It does not read child names, text content, screenshots, pointer position, keyboard input, camera,
or microphone data.

If the helper or AT-SPI is unavailable, Soma should continue with lower-fidelity environment
metadata and explain what is unavailable.

## Local Model Unavailable

If chat fails because the local model runtime is unavailable:

- Soma should not fall back to a remote model automatically.
- Check that the model container or runtime is running.
- Check `SOMA_LLM_URL` and `SOMA_LLM_MODEL` if using a non-default runtime.

Useful check:

```bash
./scripts/check-local-runtime.sh
```

## Memory At First Run

Current session memory is ephemeral and in-process. It is lost when Soma stops.

Memory read/write is opt-in per chat request:

```bash
npm run cli -- chat "help me keep track of this" --memory --write-memory
```

Durable memory is disabled. Future durable memory should include review, allowed uses, forbidden
uses, and explicit forgetting controls before it becomes available.

## Provenance

Soma records metadata about governed actions such as model chat, file reads, desktop inspection,
module adoption/drop, proposals, and proposal decisions.

Inspect a summary:

```bash
npm run cli -- provenance summary
```

List recent records:

```bash
npm run cli -- provenance list
```

The current provenance log is in-process and is lost when the service stops.

## What Soma Will Not Do By Default

Soma should not:

- call remote models
- write durable memory
- write files
- run shell commands
- read desktop text
- capture screenshots
- use camera or microphone
- click, type, or control the pointer
- activate a capability from a proposal alone
- treat provider installation as permission

## First-Run UX Principle

Orient first. Interrupt later only when necessary.

The participant should get a clear baseline posture at startup. During normal work, Soma should
only ask for additional authority when the current task materially needs a requestable capability.

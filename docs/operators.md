# Soma Operator Guide

This guide covers the current Soma MVP as it exists today. Commands assume the repository root is
the current working directory.

## Start The Service

```bash
npm start
```

By default Soma listens on `http://127.0.0.1:8765`.

The local model profile expects an OpenAI-compatible runtime at `http://127.0.0.1:8000`. The
included GPU compose file can start the current Gemma/vLLM test runtime:

```bash
docker compose -f docker-compose.gpu.yml up gemma4-llm
```

## Check Status

```bash
npm run cli -- status
```

Use JSON when you need the full response:

```bash
npm run cli -- status --json
```

Status includes concise pending capability proposal details so an operator can see whether any
review requests need attention without opening the full proposal records.

## Chat Through The Local Runtime

```bash
npm run cli -- chat "hello"
```

Session memory and cognitive-load stewardship are opt-in per request:

```bash
npm run cli -- chat "help me keep track of this" --memory --write-memory --assess-load
```

Session memory is in-process only. It is lost when the service stops.

## Inspect Desktop State

Build the Rust helper first:

```bash
npm run desktop-broker:build
```

Environment probe:

```bash
npm run cli -- desktop inspect
```

Read-only AT-SPI probe:

```bash
npm run cli -- desktop inspect --mode atspi
```

Narrow returned output:

```bash
npm run cli -- desktop inspect --mode atspi --max-apps 8 --max-children 2
```

Full inspection JSON:

```bash
npm run cli -- desktop inspect --mode atspi --json
```

The current AT-SPI probe is read-only. It returns bounded participant, application root-object, and
shallow child role/count metadata. It does not read child names, descriptions, text content, states,
actions, screenshots, pointer position, keyboard input, or camera/microphone data.

## Inspect Provenance

Concise summary:

```bash
npm run cli -- provenance summary
```

Concise event list:

```bash
npm run cli -- provenance list
```

Desktop inspection events only:

```bash
npm run cli -- provenance list --capability desktop.inspect.accessibility_tree
```

Full records:

```bash
npm run cli -- provenance list --json
```

The provenance log is in-process only. It is lost when the service stops.

## Inspect Capability View

The capability view summarizes the current effective harness against the known capability catalog
and installed providers. It is read-only and does not activate anything.

Concise grouped view:

```bash
npm run cli -- capabilities
```

Full capability keys, provider claims, data exposure, exclusions, and status classes:

```bash
npm run cli -- capabilities --json
```

Status classes include `active`, `requestable`, `unsupported`, `disabled`, `forbidden`, and
`excluded`.

## Revoke Desktop Inspection

Disable all current desktop inspection capabilities for the active process:

```bash
npm run cli -- modules adopt soma.module.no-desktop-inspection
```

Verify the active module:

```bash
npm run cli -- modules list
```

Try the disabled path:

```bash
npm run cli -- desktop inspect --mode atspi
```

Restore by dropping the module:

```bash
npm run cli -- modules drop soma.module.no-desktop-inspection
```

Modules are in-process state for the current service run.

## Review Capability Proposals

Capability proposals are requests for future or disabled capability. They do not activate anything
in the current implementation, including after approval.

List pending proposals:

```bash
npm run cli -- proposals list
```

Show the full review context for a proposal:

```bash
npm run cli -- proposals show proposal-id
```

Approve a proposal record without activating the capability:

```bash
npm run cli -- proposals approve proposal-id --scope session
```

Deny a proposal record with a reason:

```bash
npm run cli -- proposals deny proposal-id --reason "Not needed right now."
```

Full proposal JSON:

```bash
npm run cli -- proposals list --json
```

Approval and denial write provenance decision records. Revocation and capability activation are not
implemented yet.

Proposal approval records intent. Grants record authority. Activation remains a separate future
step and is not implied by either proposal creation or proposal approval.

## Inspect Grants

The current grant store is file-backed and read-only. It records the intended shape of grants, but
runtime writes and grant-based activation are not implemented.

List grants:

```bash
npm run cli -- grants list
```

List grants by status:

```bash
npm run cli -- grants list --status active
```

Full grant JSON:

```bash
npm run cli -- grants list --json
```

`GET /grants` does not create, approve, revoke, or activate capabilities.

## Read Files In Scope

The base harness allows read-only text file access under the configured read roots:

```bash
npm run cli -- files read README.md
```

File writes and shell execution remain disabled in the base harness.

## Clear Ephemeral State

Clear session memory:

```bash
npm run cli -- memory clear
```

Clear provenance:

```bash
npm run cli -- provenance clear
```

Both are local to the current Soma service process.

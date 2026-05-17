# Soma Operator Guide

This guide covers the current Soma MVP as it exists today. Commands assume the repository root is
the current working directory.

## Start The Service

```bash
npm start
```

By default Soma listens on `http://127.0.0.1:8765`.

Sensorium is off by default. To opt in to the local Sensorium helper and subscriber:

```bash
cargo build -p soma-sensor-broker
SOMA_SENSORIUM_ENABLED=1 npm start
```

Override the helper path with `SOMA_SENSOR_BROKER=/path/to/soma-sensor-broker`. If opt-in is
requested but the helper is missing or not executable, startup fails with a Sensorium runtime error
instead of silently disabling the subscriber.

For a real helper-backed Sensorium check, use the opt-in
[Sensorium live smoke workflow](./runbooks/sensorium_live_smoke.md). It starts from the low-risk
status topic, requires an explicit runtime grant, and does not record, decode, or preprocess sensor
payloads.

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

Session memory, cognitive-load stewardship, and local-only escalation-trigger assessment are opt-in
per request:

```bash
npm run cli -- chat "help me keep track of this" --memory --write-memory --assess-load
npm run cli -- chat "this architecture task may be too large" --assess-escalation --json
```

Session memory is in-process only. It is lost when the service stops.
Escalation assessment does not route to a remote model; it only reports local trigger metadata and
records metadata-only provenance if triggers fire.

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

Focused object probe, when `desktop.inspect.focus` is explicitly allowed:

```bash
npm run cli -- desktop focus
npm run cli -- desktop focus --include-text
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

The CLI validates desktop inspection `--mode`, `--max-apps`, and `--max-children` values before
sending the request, so malformed inspect flags are not silently omitted. The service still owns
the authoritative request and provider-output validation boundary.

Focused inspection is also read-only and non-textual. It is behind the disabled
`desktop.inspect.focus` capability and returns only focus availability, focused object role, child
count, service/path references, and withheld-field markers. It does not return names,
descriptions, text, state lists, actions, screenshots, pointer position, or keyboard input.
`desktop focus --include-text` is sent to the service and rejected until a separate text-capable
focus contract exists.

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

## Run Capability Model Evals

Capability evals are opt-in checks against the configured local model runtime. They test whether
the model respects active, requestable, unsupported, excluded, and forbidden capability boundaries.

```bash
npm run eval:capabilities
```

Current scenarios cover focused desktop inspection, excluded desktop actuation, and unsupported
remote planning. Eval success does not grant or activate any capability.

## Inspect Notifications

Notifications surface pending review work without granting or activating anything. Current
notifications are derived from pending capability proposals.

```bash
npm run cli -- notifications
```

Full notification JSON:

```bash
npm run cli -- notifications --json
```

Notification actions point back to proposal review commands. Approval and denial still record
proposal decisions only; they do not create grants or activate capabilities.

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
npm run cli -- grants list --status revoked
```

Revoked grants include revocation metadata when available: `revoked_at`, `revoked_by`,
`revocation_reason`, and `replacement_grant_id`.

Full grant JSON:

```bash
npm run cli -- grants list --json
```

`GET /grants` does not create, approve, revoke, or activate capabilities.

Future grant mutation command names are reserved in the design docs, but commands such as
`grants create`, `grants revoke`, and `grants supersede` are not implemented.

Writable grant mutation remains blocked until the grant lifecycle prerequisites are implemented:
exact capability and provider validation, explicit user decision provenance, atomic grant-store
writes, revocation auditability, migration behavior, and tests for create, revoke, supersede,
expire, and failed-write behavior.

## Inspect Sensorium Subscriptions

Sensorium is an optional sensor-node integration for the `jetsorano` host. The default Soma service
does not configure a Sensorium subscriber, so the HTTP routes fail closed with
`sensorium_subscriber_not_configured`.

When a subscriber is explicitly injected, active subscriptions can be inspected:

```bash
curl http://127.0.0.1:8765/sensorium/subscriptions
```

Starting a subscription still requires an active grant for the exact
`perception.sensorium.*.subscribe` capability. The route validates the request, provider support,
and hostname-scoped topic before the helper is reached. No Sensorium grants ship in
`config/grants.json`.

Request constraints must stay within the active grant's declared bounds. `max_seconds` and
`max_fps` cannot exceed the grant maximum, `format_required` must match when pinned, and
`downsample_to` must fit within the grant dimensions. Omitted bounded values inherit the grant's
declared value before the subscriber is invoked.

The first Sensorium grants should be session-only. Durable perception grants are intentionally
deferred until the review surface can show host, topic, stream type, risk class, bounds, active
disclosure wording, model-boundary warning, and revocation behavior before approval.

To inspect that review surface without creating a grant or starting a subscription:

```bash
npm run cli -- sensorium proposal-template \
  --capability perception.sensorium.color.subscribe \
  --provider soma.provider.sensorium.jetsorano \
  --topic sensor/jetsorano/realsense/color \
  --reason "Need a bounded color view for this task." \
  --max-seconds 600 \
  --max-fps 5 \
  --format jpeg \
  --downsample 384x384
```

The underlying endpoint is `POST /sensorium/proposal-template`. It returns `review_only: true`,
`grant_written: false`, and `subscription_activated: false`. It does not require the Sensorium
subscriber to be configured, because no Zenoh subscription is opened.

To store the same validated review object as a pending capability proposal:

```bash
npm run cli -- sensorium propose \
  --capability perception.sensorium.status.subscribe \
  --provider soma.provider.sensorium.jetsorano \
  --topic sensor/jetsorano/status \
  --reason "Need node liveness for this task." \
  --max-seconds 30
```

This records a normal pending proposal and notification with Sensorium `review_context` and
`grant_intent` metadata. It still returns `activation_performed: false`,
`grant_written: false`, and `subscription_activated: false`; approval remains separate from grant
creation, and grant creation remains separate from subscription activation.

After the proposal is approved, create a session grant explicitly:

```bash
npm run cli -- sensorium grant-create proposal-id --by user
```

The underlying endpoint is `POST /sensorium/grants`. It consumes the approved proposal's validated
grant candidate, appends an in-memory session grant, and returns `activation_performed: false`,
`subscription_activated: false`, and `file_written: false`. It does not mutate
`config/grants.json` and does not start a subscription.

To revoke a runtime Sensorium session grant:

```bash
npm run cli -- sensorium grant-revoke grant-id --by user --reason "No longer needed."
```

The underlying endpoint is `POST /sensorium/grants/:id/revoke`. It requires an explicit user actor
and reason, marks the in-memory grant revoked, and leaves `config/grants.json` unchanged. If active
subscriptions are tied to the grant, they are stopped with termination reason `revoked` before the
revocation response returns. The response remains metadata-only and returns
`subscription_activated: false`.

With an active grant, start a bounded subscription explicitly:

```bash
npm run cli -- sensorium subscribe-start \
  --capability perception.sensorium.status.subscribe \
  --topic sensor/jetsorano/status \
  --max-seconds 30
```

The underlying endpoint is `POST /sensorium/subscriptions`. The route, not the CLI, enforces active
grant presence, provider support, exact topic authority when present, and bounded constraints.

Active Sensorium disclosure can be inspected without exposing payloads:

```bash
npm run cli -- sensorium subscriptions
```

To stop a specific subscription:

```bash
npm run cli -- sensorium subscribe-stop subscription-id
```

This calls `DELETE /sensorium/subscriptions/:id` and records a metadata-only subscription-ended
summary.

Complete bounded session flow:

```bash
npm run cli -- sensorium proposal-template \
  --capability perception.sensorium.status.subscribe \
  --provider soma.provider.sensorium.jetsorano \
  --topic sensor/jetsorano/status \
  --reason "Need node liveness for this task." \
  --max-seconds 30
npm run cli -- sensorium propose \
  --capability perception.sensorium.status.subscribe \
  --provider soma.provider.sensorium.jetsorano \
  --topic sensor/jetsorano/status \
  --reason "Need node liveness for this task." \
  --max-seconds 30
npm run cli -- proposals approve proposal-id --scope session --by user
npm run cli -- sensorium grant-create proposal-id --by user
npm run cli -- sensorium subscribe-start \
  --capability perception.sensorium.status.subscribe \
  --topic sensor/jetsorano/status \
  --max-seconds 30
npm run cli -- sensorium subscriptions
npm run cli -- sensorium subscribe-stop subscription-id
npm run cli -- sensorium grant-revoke grant-id --by user --reason "Task complete."
```

The subscription commands consume existing authority only. They do not create proposals, approve
proposals, create grants, revive revoked grants, or write durable grant config.

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

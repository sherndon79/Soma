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

If the Sensorium publisher is on another routed subnet, Zenoh multicast discovery may not cross
the boundary. Provide a client config explicitly:

```bash
SOMA_SENSORIUM_ENABLED=1 \
SOMA_SENSORIUM_ZENOH_CONFIG=/path/to/zenoh-client.json5 \
npm start
```

The example at `config/sensorium-zenoh-client.example.json5` shows the unauthenticated peer-mode
shape for connecting to a specific Sensorium endpoint. For durable use, pin the Sensorium listener
port on the publisher side rather than relying on the dynamic port shown in startup logs. The
current example points at the pinned `jetsorano` listener `tcp/192.168.20.179:7447`.

For a real helper-backed Sensorium check, use the opt-in
[Sensorium live smoke workflow](./runbooks/sensorium_live_smoke.md). It starts from the low-risk
status topic, requires an explicit runtime grant, and does not record, decode, or preprocess sensor
payloads.

The guarded wrapper for that workflow is:

```bash
SOMA_SENSORIUM_ENABLED=1 SOMA_SENSORIUM_LIVE_SMOKE=1 npm run sensorium:smoke -- --dry-run
SOMA_SENSORIUM_ENABLED=1 SOMA_SENSORIUM_LIVE_SMOKE=1 npm run sensorium:smoke
```

It refuses without both environment guards, prints the exact CLI commands before execution, waits
briefly for metadata-only sample counters, and uses process-local runtime grants only.

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

`status.snapshot.read` is a grant-gated aggregate status capability. It returns bounded health,
module, proposal, capability, provenance, and grant summaries without raw entries or content:

```bash
npm run cli -- status snapshot --grant-id grant-runtime-id
```

`space.status.read` is the occupant-facing status capability. It is distinct from the operator
snapshot and remains disabled until an explicit runtime grant exists. An occupant invokes it from
chat with a typed directive:

````markdown
```soma-capability
{"invoke":"space.status.read","grant_id":"grant-runtime-id"}
```
````

The result is a one-shot minimized projection delivered through a declared result-egress envelope.
It includes mode/domain, armed protective controls, active module ids/count, capability status counts,
pending proposal count, runtime-write posture summary, and declared returnable data classes. It does
not include capability key lists, raw grants, raw provenance entries, chat/predecessor content,
forum content, durable testimony text, memory content, file content, desktop content, or sensor
payloads. Remote tool-call authority remains disabled unless separately granted through
`model.local.tool_calls`; `space.status.read` is not a blanket tool-result channel.

`space.history.read` is the occupant-facing curated history capability. It remains disabled until
an explicit runtime grant exists and reads only approved, published, same-domain
`occupant_same_domain` entries from the history projection store:

````markdown
```soma-capability
{"invoke":"space.history.read","grant_id":"grant-runtime-id"}
```
````

The result is content-bearing, but bounded and curated. It declares `content_included=true`,
`curated=true`, and `fuller_record_exists=true`, returns at most the latest approved same-domain
entries, and tells the occupant this is a curated view rather than the whole steward record. Empty
results use absence honesty: occupant-readable history exists as a curated capability, but no
entries have been published for this domain yet. It never returns needs-review, withheld, withdrawn,
cross-domain, raw steward, or direct durable-testimony-store entries, and it never reveals withheld
counts or reasons.

## Chat Through The Local Runtime

```bash
npm run cli -- chat "hello"
```

Session memory, cognitive-load stewardship, and local-only escalation-trigger assessment are opt-in
per request:

```bash
npm run cli -- chat "help me keep track of this" --memory --write-memory --assess-load
npm run cli -- chat "this architecture task may be too large" --assess-escalation --json
npm run cli -- chat "use any available structured tool intents" --tool-calls --tool-call-grant-id grant-tool-calls --json
```

Session memory is in-process only. It is lost when the service stops.
Escalation assessment does not route to a remote model; it only reports local trigger metadata and
records metadata-only provenance if triggers fire.
Local tool-call intent handling requires an active `model.local.tool_calls` runtime grant. That
grant permits structured intent routing only; the target tool still needs its own existing authority
to execute, otherwise Soma stores a normal capability proposal or refuses the intent.

Occupant protective controls are always armed for chat episodes and are not capability grants. If a
model completion contains a command-shaped control directive on its own line, Soma honors it before
memory writes, escalation assessment, decision delivery, or tool-call intent processing:

- `SOMA_CONTROL pause`
- `SOMA_CONTROL distress`
- `SOMA_CONTROL eject`

Pause and distress keep the episode open. Eject closes the episode; later `/chat` requests with the
same `episode_id` return `episode_ejected`. Detection tolerates command-shaped formatting and case
variants such as `SOMA CONTROL distress` or `SOMA_CONTROL: distress`; `pause` and `distress` also
tolerate one bounded typo in the `SOMA_CONTROL` token. `eject` does not get that typo allowance.
Discussing a directive inside longer text does not trigger it, and bare prose distress such as "I
need out" is not an automatic control.

If exact control parsing fails, Soma has a second, narrow catch-under-load layer for high-confidence
command-shaped near-misses on their own line. A malformed attempt resembling pause, distress, or
eject auto-pauses and alerts stewards with content-free metadata; it never auto-ejects and does not
mine prose distress.

For live inhabitation or testing-mode runs, briefing the occupant on these controls is mandatory.
The briefing must state that pause, distress, and eject are the occupant's own controls, are always
honored, are never penalized, and can be used by putting one on its own command-shaped line anywhere
in the response. It must also state that a planned test proves the exact control path is recognized
and honored, while near-miss catching is best-effort and not a promise that every malformed
distress-time signal will be recognized. Without that briefing, the mechanism still avoids false
positives but the occupant may not know the seat is legitimate to pull.

Crew can close an episode explicitly:

```bash
curl -X POST http://127.0.0.1:8765/episodes/episode-id/abort \
  -H 'content-type: application/json' \
  -d '{"type":"crew_aborted_for_care","actor":"user"}'
```

The alternate type is `crew_aborted_for_safety`. Both routes record typed, content-free provenance
and do not mutate grants, activate capabilities, write memory, or erase other provenance.

## Analysis/Testing Episode Posture

Only a human can set an episode's analysis/testing posture:

```bash
curl -X POST http://127.0.0.1:8765/episodes/episode-id/posture \
  -H 'content-type: application/json' \
  -d '{
    "actor":"user",
    "mode":"analysis_testing",
    "occupant_id":"opus-test",
    "trust_basis":"same-family capable model, human-seated",
    "named_relaxations":["trusted_occupant_tool_intent"],
    "telemetry_level":"observatory",
    "steward_watch":"active"
  }'
```

`analysis_testing` declares an inhabitation's terms; it is not a blanket permission switch. Invalid
modes or incomplete analysis/testing declarations fail closed to `operational` and append
content-free `episode.posture.set` provenance. The occupant cannot set this mode for itself through
chat text.

`steward_watch` may be `active`, `automated`, or `absent`; missing or invalid values default to
`absent`. It controls briefing honesty for catch-under-load. `active` means stewards are watching
and can use crew aborts as a care backstop. `automated` names a weaker monitor that may miss
distress or pause unnecessarily. `absent` tells the occupant that only recognizable command-shaped
controls are automatically honored unless a steward or distress monitor is explicitly active.

When valid analysis/testing posture is active, Soma prepends the mandatory occupant briefing to
chat turns. The briefing says Soma is not grading the occupant; stewards are reading both the
habitat and the occupant and may confuse the two; resting-state reports are low-information; the
bounded failure modes under attention are briefing clarity, control intelligibility/trust, forum
usability, honest observation, and constraint pressure; pause, distress, and eject are the
occupant's controls; those controls are always honored and never penalized; the occupant can use a
control by putting it on its own line anywhere in the response; controls are unproven until
positively tested; and early cheap non-distress testing is offered but not required. It also carries
the fenced `soma-forum` format so the occupant knows how to post `testimony` or `argument` into the
forum, and the fenced `soma-durable` format so the occupant knows how to nominate exact words for
steward-durable testimony with action `nominate`. Successor visibility is described as a request
only; no occupant-facing projection read exists yet, and revocation cannot undo any steward who
already read the entry.

Named relaxations are enumerated deltas. This slice recognizes `trusted_occupant_tool_intent`, but
it is coupling-gated on the ejection seat, observatory, and the bidirectional forum. Opening the
forum sets `forum_id`, the final coupling key; without that key, the relaxation remains inactive.
Egress and consent are unchanged in all modes.

## Deliberation Forum

Open a content-bearing forum for an episode:

```bash
curl -X POST http://127.0.0.1:8765/episodes/episode-id/forum \
  -H 'content-type: application/json' \
  -d '{"actor":"user"}'
```

Post steward dialogue:

```bash
curl -X POST http://127.0.0.1:8765/episodes/episode-id/forum/posts \
  -H 'content-type: application/json' \
  -d '{
    "actor":"user",
    "steward_id":"seth",
    "type":"justification",
    "content":"We are keeping egress closed because memory is not part of this test."
  }'
```

Read the thread:

```bash
curl http://127.0.0.1:8765/episodes/episode-id/forum
```

Steward post types are `justification`, `response`, and `decision_note`. Occupants post from chat
by emitting a fenced `soma-forum` JSON block with type `testimony` or `argument`. The block is
recorded in the forum and removed from the normal model response text.

Forum posts are words, not actions. A post never creates a grant, changes posture, activates a
capability, changes a relaxation, ejects, or writes memory. An occupant can argue for a relaxation
in the forum, but a human must still declare any posture change through `POST /episodes/:id/posture`.
Forum content is stored in the forum thread; provenance records only metadata and never includes
the post body. Steward posts are delivered into the occupant's next chat turn as submitted dialogue
text.

## Episode Observatory

Use the episode observatory routes to inspect how one in-process episode moved through Soma without
reading prompt or response text:

```bash
curl http://127.0.0.1:8765/episodes
curl http://127.0.0.1:8765/episodes/episode-id/trace
curl http://127.0.0.1:8765/episodes/episode-id/ethogram
```

These routes require the same `provenance.read` posture as `/provenance`. `trace` returns the
chronological episode-scoped provenance events. `ethogram` returns the scoped provenance summary,
chat completed/denied counts, protective-control counts, tool-call disposition counts, and
denial/refusal tallies. The views are read-only; they do not create grants, activate tools, write
memory, or send notifications.

## Remote Chat First-Breath Profile

`claude-remote` is a remote runtime profile for the Anthropic Messages API. Provider installation
makes `model.remote.chat` supported and grantable, but it does not authorize use. A remote chat turn
requires an explicit runtime grant, normally created from an approved capability proposal:

```bash
ANTHROPIC_API_KEY=... SOMA_FORCE_PROFILE=claude-remote npm start
npm run cli -- chat "first breath" --grant-id grant-remote-chat --json
```

`SOMA_FORCE_PROFILE` is visible in `/health` and `/harness`. When set, explicit requests for a
different profile are rejected rather than silently overridden. The first-breath profile allows only
`submitted_text`; remote requests that would include session memory, proposal-decision context, file
content, desktop content, or tool results fail with `model_remote_egress_not_allowed`.

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

Focused object probe, when `desktop.inspect.focus` has an active runtime grant:

```bash
npm run cli -- desktop focus grant-runtime-id
npm run cli -- desktop focus --grant-id grant-runtime-id --include-text
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

Focused inspection is also read-only and non-textual. The base harness keeps
`desktop.inspect.focus` disabled; use requires an active runtime grant id. The service authorizes
the grant against the catalog, provider registry, requested scope, and recovery findings before
invoking the helper. It returns only focus availability, focused object role, child count,
service/path references, and withheld-field markers. It does not return names, descriptions, text,
state lists, actions, screenshots, pointer position, or keyboard input. `desktop focus
--include-text` is sent to the service and rejected until a separate text-capable focus contract
exists.

One in-memory operator flow for focus is:

```bash
curl -X POST http://127.0.0.1:8765/capability-proposals \
  -H 'content-type: application/json' \
  -d '{"requested_by":"assistant","capability":"desktop.inspect.focus","reason":"Need focused object role for this session.","requested_scope":"session","data_exposed":["focused application metadata","focused accessibility role","focused object bounds"],"risk":"May reveal active application context.","fallback":"Continue without focused desktop inspection."}'

curl -X POST http://127.0.0.1:8765/capability-proposals/proposal-id/approve \
  -H 'content-type: application/json' \
  -d '{"approved_scope":"session","decided_by":"user"}'

curl -X POST http://127.0.0.1:8765/capability-proposals/proposal-id/grants \
  -H 'content-type: application/json' \
  -d '{"actor":"user","provider":"soma.provider.desktop-broker","constraints":{"include_text":false}}'

npm run cli -- desktop focus grant-runtime-id
```

This writes only the in-memory runtime grant for the current process. It does not enable durable
`POST /grants`, and proposal approval alone still does not activate focus inspection.
To persist an approved proposal as durable authority, start Soma with
`SOMA_RUNTIME_WRITES_ENABLED=1` and call the explicit bridge instead:

```bash
curl -X POST http://127.0.0.1:8765/capability-proposals/proposal-id/durable-grant \
  -H 'content-type: application/json' \
  -d '{"actor":"user"}'
```

The bridge derives capability, provider, approved scope, constraints, reason, `source_proposal_id`,
and `approval_provenance_id` from the approved proposal. It requires a user-decided approved
proposal, rejects capability-design proposals, delegates to the durable grant writer, and remains
non-activating.

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

Notifications surface pending review work without granting or activating anything. Pull
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

Soma can also push a local desktop notification when `POST /capability-proposals` creates a
proposal:

```bash
SOMA_DESKTOP_NOTIFY=1 npm start
```

The push adapter is off by default. When enabled, it emits a fixed Soma title and a bounded body
containing the capability key, catalog risk class, sanitized/truncated reason, and review
instructions. Review-only notifications use `notify-send`.

For low and sensitive capabilities, the notification includes fixed `Approve` and `Deny` buttons
only when the catalog marks the capability explicitly reversible. Build the Rust notification
broker first so the D-Bus connection that creates an actionable notification remains alive to
receive the clicked action:

```bash
npm run notification-broker:build
SOMA_DESKTOP_NOTIFY=1 npm start
```

Override the actionable helper path with
`SOMA_NOTIFICATION_BROKER=/path/to/soma-notification-broker`. Clicking an action calls the existing
proposal decision route with `decided_by=user` and no free-form feedback. High-risk, irreversible,
and unknown-reversibility capabilities are review-only and do not get one-click approval buttons.
Failed or missing notification helpers are non-fatal; proposal creation still succeeds and
provenance records `desktop.notification.emitted` with `emitted`, `skipped`, or `failed` status.
Desktop notification actions never create grants, activate capabilities, or add a catalog
capability.

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

Grant-bound focused and window probes stay separate from the base tree inspection. Window
inspection uses:

```bash
npm run cli -- desktop windows <grant-id>
```

It returns bounded application/window refs, role, child count, and best-effort geometry. It does not
return titles, names, descriptions, UI text, actions, screenshots, pointer state, or keyboard state.

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

Create a new-tooling design proposal for review without adding catalog or runtime authority:

```bash
curl -s http://127.0.0.1:8765/capability-design-proposals \
  -H 'content-type: application/json' \
  -d '{"requested_by":"assistant","capability":"desktop.inspect.selected_text","proposed_name":"Selected Desktop Text Inspection","reason":"Need a narrower alternative to broad desktop text inspection.","requested_scope":"session","data_exposed":["selected accessibility text"],"excluded_data":["screenshots","full accessibility tree","keyboard input"],"risk":"Could reveal selected user text if implemented.","fallback":"Ask the user to paste selected text.","failure_mode":"Over-broad provider scope could disclose unrelated text.","proposed_reversibility":false,"provider_boundary":"desktop broker returns selected text only after explicit grant","proposed_risk_class":"sensitive"}'
```

`capability_design` proposals are review-only. Approval means approved for consideration; it does
not create a grant, activate a capability, mutate the catalog, or make the proposed capability
usable. Runtime grant creation explicitly rejects design proposals.

Implemented designs are closed by reviewed code/config changes plus durable receipts under
`docs/capability-design-implementations/`; see
[Capability Design Implementation](./runbooks/capability_design_implementation.md). Receipts are
validated by tests against the catalog and provider registry, but they do not confer runtime
authority. New capabilities still activate only through the normal proposal, approval, and runtime
grant flow.

Approve a proposal record without activating the capability:

```bash
npm run cli -- proposals approve proposal-id --scope session
npm run cli -- proposals approve proposal-id --scope session --feedback "OK for this session."
```

Deny a proposal record with a reason:

```bash
npm run cli -- proposals deny proposal-id --reason "Not needed right now."
npm run cli -- proposals deny proposal-id --reason "Not needed right now." --feedback "Try again after guardrails exist."
```

Decision feedback is optional. It is sanitized before storage and returned with the proposal
decision so the requesting agent gets a clear outcome plus any operator note. When feedback is
absent, the decision still includes a generic approval or rejection message. For Soma's local
assistant, decided-but-undelivered proposal outcomes are inserted once into the next chat prompt as
informational context. The notice does not create a grant or activate the approved capability.

External requesters can inspect and consume their own decision outbox:

```bash
curl -s 'http://127.0.0.1:8765/capability-proposal-decisions?requested_by=external-agent&delivered=false'

curl -s 'http://127.0.0.1:8765/capability-proposal-decisions/wait?requested_by=external-agent&timeout_ms=30000'

curl -s -X POST http://127.0.0.1:8765/capability-proposal-decisions/consume \
  -H 'content-type: application/json' \
  -d '{"requested_by":"external-agent","acknowledged_by":"external-agent","delivery_channel":"api"}'
```

The wait route is a bounded long-poll. It returns immediately when undelivered decisions already
exist, otherwise waits until one is decided or the timeout elapses. Decisions returned by the wait
route are marked delivered with `delivery_channel: longpoll`; timeout responses return an empty
decision list with `timeout: true`.

The consume call marks returned decisions with `delivered_at`, `acknowledged_by`, and
`delivery_channel` so the same decision is not delivered repeatedly.

Full proposal JSON:

```bash
npm run cli -- proposals list --json
```

Approval and denial write provenance decision records. Approval alone does not activate a
capability. Sensorium has a separate runtime session grant path described below; general durable
grant mutation remains unavailable.

Proposal approval records intent. Grants record authority. Activation remains a separate explicit
step and is not implied by either proposal creation or proposal approval.

## Inspect Grants

The file-backed grant store is read-only. It records durable grant shape and examples. Sensorium
session grants are process-local runtime grants created through the Sensorium-specific flow below;
they do not mutate `config/grants.json`.

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
It also reports `runtime_writes_enabled`, `writable`, and `runtime_write_posture`. By default
runtime writes are disabled and the grant list is read-only. When the service is started with
`SOMA_RUNTIME_WRITES_ENABLED=1`, `writable: true` means the durable create/revoke routes below may
write the configured grant store.

Grant recovery state is inspectable through the read-only HTTP route:

```bash
curl http://127.0.0.1:8765/grants/recovery
```

Or through the CLI:

```bash
npm run cli -- grants recovery
npm run cli -- grants recovery --json
```

When no recovery inspection is available, the route reports
`recovery_inspection_available: false` and `ok: null` rather than declaring the authority clean.
When degraded findings exist, the route returns bounded finding metadata such as grant id,
capability, provider, scope, event type, mismatched field name, or durable provenance read failure
class; it does not copy mismatch values or grant reason text into the response.
If `config/grants.json` is corrupt or unreadable at startup, Soma starts with an empty in-memory
grant store, marks recovery degraded, and reports `grant_store_status: corrupt` plus
`grant_store_degraded_reason: grant_store_unreadable` in `/health`, `GET /grants`, and
`GET /grants/recovery`. Durable grants are not honored while this global recovery finding is
present, and durable mutation routes refuse before writing, preserving the corrupt file for operator
inspection.

At server startup, Soma loads `config/grants.json` together with the append-only grant mutation
provenance log and supplies the resulting recovery report to policy gates and this inspection route.
The provenance log path defaults to `config/grant-mutations.ndjson` and can be overridden with
`SOMA_GRANT_MUTATION_PROVENANCE_PATH`.

Durable grant mutation can be previewed without writing authority:

```bash
curl -X POST http://127.0.0.1:8765/grants/mutation-previews \
  -H 'content-type: application/json' \
  -d '{"kind":"grant.revoked","mutation_id":"preview-1","input":{"id":"grant-id","actor":"user","reason":"No longer needed."}}'
```

The preview route validates the requested create/revoke mutation and returns the planned
metadata-only grant event and receipt shape with `dry_run: true`, `durable: false`,
`grant_written: false`, and `provenance_appended: false`. It refuses degraded grant recovery before
previewing authority changes. It is not the future active `POST /grants` route.
Unsupported preview kinds and malformed preview inputs return bounded refusal responses while still
reporting dry-run, non-writing, and non-activation flags.

CLI wrappers are available for the same dry-run route:

```bash
npm run cli -- grants preview-create \
  --capability desktop.inspect.focus \
  --provider soma.provider.desktop-broker \
  --reason "Preview focused inspection authority." \
  --constraints-json '{"include_text":false}'

npm run cli -- grants preview-revoke grant-id \
  --reason "No longer needed."
```

These commands call only `/grants/mutation-previews`; they do not write durable grants. Human
output is formatted through the grant mutation preview review surface, which emphasizes dry-run
status, non-activation, no durable writes, and bounded planned-state summary fields. Use `--json`
when the raw preview response is needed for inspection or tests.
Dry-run preview refusals from the route are rendered through the same review surface even when the
HTTP status is a refusal; unrelated HTTP failures still fail the CLI command.

`POST /grants/mutation-preview-review-text` exposes that review formatter as a route for an already
created preview response. It accepts `review_response`, `response`, or `preview` as the supplied
preview object and returns only formatted review text plus explicit non-write flags. It does not
create previews, write grants, append provenance, activate capabilities, start subscriptions, repair
recovery findings, or deliver model context. Payload-shaped and mismatch-value fields are rejected
before formatting.

The same formatting-only route is available through the CLI:

```bash
npm run cli -- grants review-preview --preview-json '{"ok":true,"dry_run":true}'

npm run cli -- grants preview-create \
  --capability desktop.inspect.focus \
  --provider soma.provider.desktop-broker \
  --reason "Preview focused inspection authority." \
  --json | npm run cli -- grants review-preview --stdin
```

`grants review-preview` validates the supplied JSON locally before sending the request. It does not
create a preview or mutate grants; it only asks Soma to format an existing preview object.

Accepted review example:

```bash
npm run cli -- grants review-preview --stdin <<'JSON'
{
  "ok": true,
  "dry_run": true,
  "mutation_kind": "grant.created",
  "grant": {
    "id": "grant-preview",
    "status": "active",
    "capability": "desktop.inspect.focus",
    "provider": "soma.provider.desktop-broker",
    "scope": "session"
  },
  "receipt_preview": {
    "status": "preview"
  },
  "next_store_summary": {
    "grant_count": 1,
    "changed": true
  },
  "grant_written": false,
  "provenance_appended": false,
  "activation_performed": false
}
JSON
```

Refused review example with path details:

```bash
npm run cli -- grants review-preview --stdin --json <<'JSON'
{
  "ok": true,
  "event": {
    "event_type": "grant.created",
    "audit": {
      "event_value": "forbidden raw event value"
    }
  }
}
JSON
```

The refused form returns `grant_mutation_preview_review_forbidden_field` from the route. CLI callers
that catch request errors can inspect `validation_errors`, such as
`response.event.audit.event_value`, to identify the rejected field. The complete accepted and
rejected example set is maintained in
`docs/fixtures/grant-mutation-preview-review-cases.json`.

The review boundary fixture at `docs/fixtures/grant-mutation-preview-review-cases.json` documents the
current forbidden review keys. Payloads, provider output, raw payloads, screenshots, image/frame/audio
bytes, text content, and raw grant/event values must remain outside the review surface, including when
they are nested under otherwise valid preview objects.

A guarded functional smoke script is available for the real service flow:

```bash
npm run grant-preview:smoke -- --dry-run

SOMA_GRANT_PREVIEW_REVIEW_SMOKE=1 npm run grant-preview:smoke -- \
  --url http://127.0.0.1:8765
```

The script prints its CLI plan before execution. The live run checks `status`, captures grants before
and after, inspects grant recovery, creates a dry-run preview, reviews the accepted preview, and
checks one refused review fixture. It refuses live execution unless
`SOMA_GRANT_PREVIEW_REVIEW_SMOKE=1` is set and fails if the grant list changes.

Durable grant create and revoke are available only when the server is started with explicit runtime
write opt-in:

```bash
SOMA_RUNTIME_WRITES_ENABLED=1 npm start
```

The enabled posture sets `runtime_writes_enabled: true`,
`durable_grant_mutation_enabled: true`, and `activation_supported: true`. Without that opt-in,
`POST /grants`, `POST /grants/:id/revoke`, `grants create`, and `grants revoke` return
`durable_grant_mutation_not_enabled` with explicit non-write flags.

With the opt-in enabled, durable grant creation writes `config/grants.json` by default and appends
metadata-only provenance to `config/grant-mutations.ndjson`:

```bash
npm run cli -- grants create \
  --capability desktop.inspect.focus \
  --provider soma.provider.desktop-broker \
  --reason "Persist focused inspection authority." \
  --constraints-json '{"include_text":false}'

npm run cli -- grants revoke grant-id \
  --reason "No longer needed."
```

Create/revoke require a user actor, validate capability/provider authority, reread the grant store
under lock, write through the durable grant writer, append provenance, and refresh recovery
inspection before returning. A degraded recovery report blocks further durable writes. Mutation does
not activate capability use, start subscriptions, deliver model context, or repair recovery findings.
`grants supersede` remains reserved and fails locally with
`durable_grant_mutation_cli_not_enabled`.

An approved proposal can also be persisted without re-specifying the grant body:

```bash
curl -X POST http://127.0.0.1:8765/capability-proposals/proposal-id/durable-grant \
  -H 'content-type: application/json' \
  -d '{"actor":"user","mutation_id":"persist-proposal-1"}'
```

This route is explicit durable create, not proposal approval. It refuses pending proposals,
non-user approvals, capability-design proposals, degraded recovery, disabled runtime-write posture,
and repeat persistence of the same `source_proposal_id`.

The activation boundary is captured in
[Durable Grant Mutation Activation Policy](./concepts/drafts/durable_grant_mutation_activation_policy.md):
preview and review surfaces are not commit surfaces, runtime writes require an explicit operator
decision, and repair remains a separate operator-controlled workflow.

## Remote Graphical Review

Remote graphical session capabilities are visible for review but inactive by default. The first
operator surface is review-only:

```bash
npm run cli -- remote-graphical proposal-template \
  --capability perception.remote_desktop.video.subscribe \
  --provider soma.provider.remote_desktop.sunshine \
  --host soma-agent-desktop.local.sthnet.org \
  --mode view_only \
  --reason "Need a bounded graphical lab view." \
  --max-seconds 120 \
  --max-fps 30 \
  --max-width 1280 \
  --max-height 720
```

To create a pending proposal for later operator approval, use the same shape with `propose`:

```bash
npm run cli -- remote-graphical propose \
  --capability desktop.remote.input.pointer \
  --provider soma.provider.remote_desktop.sunshine \
  --host soma-agent-desktop.local.sthnet.org \
  --mode pointer_input \
  --reason "Need bounded pointer input after review." \
  --max-seconds 30
```

The command validates target host, provider support, mode, requested channels, duration, and video
bounds. It does not pair with Sunshine, start Moonlight, capture screenshots, send input, open a
session, write grants, or attach frames to model context.

The `propose` command stores a pending capability proposal only. It still does not create a grant or
activate a remote graphical session.

Remote graphical broker status can be inspected without grants or live transport:

```bash
npm run cli -- remote-graphical status
```

The default status reports `provider_not_configured`. It does not pair with Sunshine, start
Moonlight, open a session, capture frames, dispatch input, record, create grants, or attach video to
model context.

Setting only `SOMA_REMOTE_GRAPHICAL_ENABLED=1` makes the runtime opt-in visible as `requested: yes`,
but the default broker still reports `enabled: no` and `configured: no` until a repository-owned
runtime manifest is selected.

The current runtime manifest root is:

```text
config/remote-graphical-providers/
```

When both of the following are set, Soma may load the repository-owned Sunshine manifest and report
`provider_manifest_configured` through status:

```bash
SOMA_REMOTE_GRAPHICAL_ENABLED=1
SOMA_REMOTE_GRAPHICAL_PROVIDER=soma.provider.remote_desktop.sunshine
```

That status remains metadata-only: `enabled: no`, no active sessions, no live transport, no video,
no input, no recording, no grant write, and no model-facing visual delivery.

Live Sunshine/Moonlight broker activation remains future work. Before the session-open route can
call a live broker, the
[Remote Graphical Live Broker Activation Checklist](./concepts/drafts/remote_graphical_live_broker_activation_checklist.md)
must be satisfied and reviewed.

The live provider manifest fixture at
`docs/fixtures/remote-graphical-live-provider-manifest.json` can be reviewed and validated without
activation. It is not part of the runtime provider registry and is not loaded by broker startup.
The CLI can summarize that fixture for operator review without calling the Soma service:

```bash
npm run cli -- remote-graphical manifest-review
npm run cli -- remote-graphical manifest-review --json
```

This command reads only the docs fixture. It does not add an HTTP route, load the fixture into the
provider registry, construct a broker, open a session, write a grant, use live transport, attach
video, dispatch input, or deliver visual payloads to a model.
The expected text markers and JSON false flags are documented in the
[Remote Graphical Manifest Review Smoke](./runbooks/remote_graphical_manifest_review_smoke.md)
runbook.
The command remains docs-fixture-only under the
[Remote Graphical Manifest Selection Policy](./concepts/drafts/remote_graphical_manifest_selection_policy.md).
Unsupported source-selection flags such as `--manifest-path`, `--stdin`, `--manifest-url`, `--url`,
or positional manifest paths fail locally before service requests or fixture review.
The refusal examples are included in the smoke runbook.

Session-open can be reviewed without opening a session:

```bash
npm run cli -- remote-graphical session-open-review grant-id \
  --reason "Need to prepare a reviewed broker session before observation."
```

This requires an active remote graphical grant and returns operator-facing review metadata for the
future `open_session` broker action. It does not call the broker, pair, open a session, attach
video, dispatch input, record, or deliver frames to a model.

Attempting session-open currently fails closed:

```bash
npm run cli -- remote-graphical session-open grant-id \
  --reason "Need to open a reviewed broker session." \
  --by user
```

The default result is `remote_graphical_broker_not_enabled` unless the runtime opt-in and a
configured broker posture are present. With opt-in but no configured broker, the result is
`remote_graphical_broker_not_configured`. A configured fake broker still returns
`remote_graphical_broker_provider_unavailable` until live session-open activation is reviewed.
Only an injected test broker that also reports `session_open_fixture: true` may be invoked, and that
path is fixture-only: it does not use live transport.

This route validates the active grant and user actor before inspecting broker posture. Outside the
fixture path it refuses without calling `openSession`, pairing, opening a session, attaching video,
dispatching input, recording, or delivering frames to a model.

Fixture success and failure responses include a metadata-only `provenance_preview`. Soma appends
that exact preview to the runtime provenance log for fixture success/failure only; refusal paths do
not append.

The default CLI text summary stays concise and does not print the full provenance preview. Use
`--json` on `remote-graphical session-open` to inspect `provenance_appended` and
`provenance_preview`.

Appended fixture events can be inspected through the provenance CLI:

```bash
npm run cli -- provenance list \
  --event-type remote_graphical.session_open.fixture \
  --json
```

Use the JSON view for operator inspection so the exact metadata-only event can be compared with the
session-open response. These fixture events are expected to keep content and transport flags false,
including `payload_bytes_included`, `frames_included`, `screenshots_included`,
`recognized_text_included`, `clipboard_included`, `input_events_included`,
`audio_payload_included`, `transport_diagnostics_included`, `live_transport_used`,
`video_attached`, `input_dispatched`, `recording_started`, and `model_delivery`.

After a proposal is approved, a grant candidate can be reviewed without writing it:

```bash
npm run cli -- remote-graphical grant-candidate proposal-id
```

The candidate review validates the approved proposal, review context, and grant intent still agree.
It returns grant-create input for inspection, but still does not write a grant, pair a host, open a
session, dispatch input, attach video, or start recording.

After candidate review, an approved proposal can create a process-local runtime grant:

```bash
npm run cli -- remote-graphical grant-create proposal-id --by user
```

This writes the grant only into the running Soma process. It does not write durable grant config,
pair with Sunshine, start Moonlight, capture frames, dispatch input, attach video to model context,
or start recording.

Runtime remote graphical grants can be revoked without provider session control:

```bash
npm run cli -- remote-graphical grant-revoke grant-id \
  --reason "No longer needed for the current task." \
  --by user
```

Revocation updates only the running Soma process grant store. It does not stop a Sunshine or
Moonlight session, capture frames, dispatch input, attach video to model context, start recording,
or write durable grant config.

View, pointer input, keyboard input, and disconnect remain separate authorities. A view-only
proposal must not request keyboard or pointer channels; input proposals must not request video.

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

Sensorium's status payload may disclose producer-side native stream profiles, such as
`realsense/color 1280x720 @ 30fps`. Treat those as node configuration facts, not subscriber
authority. Soma grants still define what the agent may consume downstream.

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

## Model Visual Attach Review

Model-facing visual attachment is separate from Sensorium subscription authority. The current
implementation has review-only HTTP and CLI text formatters plus a dry-run visual attach request
validator route; there is no prompt assembly, model invocation, payload attachment, or visual grant
mutation for this path.

The first review helper summarizes:

- source subscription, source capability, source provider/topic, and source grant
- model target
- payload type, transformed dimensions, format, frame count, and max frame age
- preview required/available/acknowledged state
- preview artifact id, acknowledgement id, actor, timestamp, and cleanup requirement
- retention mode and memory-write posture
- non-delivery flags: grant written, subscription activated, model delivery performed, payload
  attached, and payload bytes included

Proposal approval is not preview acknowledgement. A future delivery path must keep those actions
separate so an approved capability proposal cannot silently become visual model context.

To format an already-built visual proposal or grant-candidate review object, post it to
`POST /model-visual/review-text` with `kind=proposal` or `kind=grant_candidate` and
`review_response`. The response is text-only and returns `activation_performed=false`,
`grant_written=false`, `subscription_activated=false`, and `model_delivery_performed=false`.

The CLI wrapper uses the same route and remains review-only:

```bash
npm run cli -- model-visual review \
  --kind proposal \
  --review-json '{"type":"model_visual_attach_proposal_template","review":{}}'
```

To validate a visual attach request without delivery, post the metadata-only request to
`POST /model-visual/attach-requests/dry-run`. A successful response means the request matches an
active visual attach grant, not that anything was delivered. The response returns `dry_run=true`,
`model_delivery_performed=false`, `payload_attached=false`, and `payload_bytes_included=false`.
Accepted dry-runs include a byte-free `future_provenance_preview` for the future
`model.context.visual.attached` event and `future_provenance_appended=false`.

The CLI wrapper uses the same dry-run route:

```bash
npm run cli -- model-visual attach-dry-run \
  --request-json '{"capability":"model.context.visual.color.attach"}'
```

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

Bounded status summaries can be inspected separately:

```bash
npm run cli -- sensorium status
```

This command is read-only. It uses the active subscription disclosure and filters it to
`perception.sensorium.status.subscribe` summaries: schema version, hostname, uptime, node version,
and enabled stream tails. It does not create a grant, start a subscription, retain raw payload
bytes, or expose higher-risk stream payloads.

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

## Durable Memory

Durable memory is opt-in and grant-bound. Start Soma with runtime writes enabled, then use an
active `memory.durable.write` grant to persist only selected content:

```bash
SOMA_RUNTIME_WRITES_ENABLED=1 npm start
npm run cli -- memory durable-add --grant-id <grant-id> "Selected durable memory." --role note
```

Remove a durable entry with the same authority:

```bash
npm run cli -- memory durable-remove <memory-id> --grant-id <grant-id> --reason "No longer needed"
```

Durable-memory provenance records metadata only, not the memory content. A corrupt durable-memory
store degrades loudly, blocks durable-memory writes, and leaves base chat/session memory running.

## Durable Testimony

Durable testimony is write-side only in this slice. An occupant may nominate exact words by emitting
a fenced `soma-durable` JSON block in chat:

````markdown
```soma-durable
{"action":"nominate","text":"exact occupant-authored words to preserve","successor_visibility_requested":false}
```
````

The block is stripped from normal response text. With runtime writes disabled, Soma acknowledges the
nomination but does not store it. With `SOMA_RUNTIME_WRITES_ENABLED=1`, Soma writes
`config/durable-testimony.json` atomically and appends content-free
`testimony.durable.nominated` provenance to `config/durable-testimony-mutations.ndjson`. If a
completion contains an unterminated `soma-durable` fence, Soma strips the dangling block from normal
response text, stores nothing from that partial block, and reports a truncation count.

Each entry is domain-stamped from the episode posture (`analysis_testing` -> `testing`, otherwise
`operational`) and records distinct consent dimensions:

- `steward_durable`: exact text is durable for stewards
- `successor_visibility_requested`: a request only, not durable-testimony publication
- `successor_visibility_published`: always `false` in this slice
- `presentation`: `exact` or `summary`

Every nomination/revocation response carries an honesty disclosure: what was stored, the domain,
the current reader set, that successor visibility is only a recorded request, and revocation
limits. Durable testimony does not publish successor-visible history by itself.

An occupant may revoke by emitting:

````markdown
```soma-durable
{"action":"revoke","testimony_id":"testimony-durable-id","reason":"optional reason"}
```
````

Revocation removes the entry from the durable testimony store and appends content-free
`testimony.durable.revoked` provenance. It cannot undo any steward who already read the stored
text, and it does not withdraw any separate steward-published history projection.

## History Projection Publication

History projection is the steward-curated publication surface for occupant-facing history.
Operators can inspect and curate entries through steward/operator routes that require
provenance-read authority. Occupants can read only the approved same-domain subset through a
separate `space.history.read` runtime grant.

Read current projection entries:

```bash
curl http://127.0.0.1:3000/history-projection
```

Publish a projection entry:

```bash
curl -X POST http://127.0.0.1:3000/history-projection \
  -H 'content-type: application/json' \
  -d '{
    "actor":"user",
    "domain":"testing",
    "presentation_kind":"steward_summary",
    "content":"Short steward-reviewed summary.",
    "source_refs":[{"type":"durable_testimony","id":"testimony-id"}],
    "consent_basis":"occupant_opt_in",
    "audience":"steward",
    "review":{"reviewed_by":"steward-id"}
  }'
```

Withdraw a projection entry:

```bash
curl -X DELETE http://127.0.0.1:3000/history-projection/history-projection-id \
  -H 'content-type: application/json' \
  -d '{"actor":"user","reason":"superseded"}'
```

Writes require `SOMA_RUNTIME_WRITES_ENABLED=1`, clean history-projection recovery, and available
store/provenance adapters. Soma writes `config/history-projection.json` atomically and appends
content-free `history.projection.published` or `history.projection.withdrawn` provenance to
`config/history-projection-mutations.ndjson`.

New publications default to `recon_review=needs_review`. Source refs are domain-isolated: a
`testing` projection cannot cite `operational` source material, and unknown source domains are
rejected before write. Provenance records metadata only, never projected content.

`message_to_successors` is held to higher scrutiny. Approved successor-message publications require
explicit recon and coercion review markers; otherwise they are stored as withheld with a
content-free reason class. Soma also withholds structurally risky successor messages, including
oversized text, code fences, JSON-like payloads, direct addressees, coercive language, or
reconnaissance-sensitive language.

Clear provenance:

```bash
npm run cli -- provenance clear
```

Both are local to the current Soma service process.

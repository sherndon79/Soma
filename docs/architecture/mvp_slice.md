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
- `/episodes`
- `/episodes/:id/trace`
- `/episodes/:id/ethogram`
- `/episodes/:id/posture`
- `/episodes/:id/forum`
- `/episodes/:id/forum/posts`
- `/episodes/:id/abort`
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
    "durable_memory_write_enabled": false,
    "durable_testimony_write_enabled": false,
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

### `POST /capability-proposals/:id/grants`

Creates a process-local runtime grant from an approved, user-decided proposal. This route is the
lightweight operational bridge for the current process. It rejects capability-design proposals and
does not persist authority across restart.

### `POST /capability-proposals/:id/durable-grant`

Creates a durable grant from an approved, user-decided proposal only when
`SOMA_RUNTIME_WRITES_ENABLED=1`. The caller supplies a user actor, but the route derives the grant
body from the proposal and its approval record: capability, provider, approved scope, constraints,
reason, `source_proposal_id`, and `approval_provenance_id`. It delegates to the durable grant writer,
appends grant mutation provenance, rejects capability-design proposals, refuses repeat persistence
of the same source proposal, and does not activate capability use.

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
durable grants. A corrupt grant store is loaded as empty in-memory authority with
`grant_store_status: corrupt`, a global `grant_store_unreadable` finding, and durable writes blocked
before any file rewrite.

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

Sends a chat request through the effective runtime profile. Local profiles require
`model.local.chat`; remote profiles require an active `model.remote.chat` runtime grant.

The request should include:

- messages
- optional `model_profile`
- optional `grant_id` / `remote_chat_grant_id` for remote chat
- optional `episode_id`
- optional max tokens
- optional temperature
- optional `use_session_memory`
- optional `write_session_memory`
- optional `use_tool_calls`
- optional `tool_call_grant_id`, `tool_call_provider`, and `tool_call_scope`

The response should include:

- model response text
- model id/profile actually used
- requested/effective profile
- capability used
- provenance id
- episode id
- whether any remote service was used
- whether ephemeral session memory was read or written
- structured tool-call intent dispositions when `use_tool_calls` is enabled

Occupant protective controls are honored from command-shaped, line-delimited model completion
directives before memory writes, escalation assessment, decision delivery, or tool-call intent
processing:

- `SOMA_CONTROL pause` records `occupant_paused`, holds the current turn, and keeps the episode open
- `SOMA_CONTROL distress` records `occupant_distress` and keeps the episode open
- `SOMA_CONTROL eject` records `occupant_ejected`, closes the episode, and causes later `/chat`
  requests with the same `episode_id` to fail with `episode_ejected`

Detection is tolerant only inside a command-shaped line: case and spacing variants such as
`SOMA CONTROL distress` or `SOMA_CONTROL: distress` are accepted, and `pause`/`distress` tolerate a
bounded typo in the `SOMA_CONTROL` token. `eject` accepts formatting and case variants but not the
typo allowance. A directive may appear on its own line anywhere in a longer response. Mentioning a
directive inside ordinary text or expressing bare prose distress does not trigger it. These controls
are not catalog capabilities and do not grant new authority; their only effects are episode state,
aborting further turn processing, and metadata-only protective provenance.

An inhabiting occupant must be briefed that these controls exist, are theirs to use, and are always
honored without penalty. That briefing is a functional prerequisite for live inhabitation, not
operator-facing polish; an unbriefed occupant may reasonably treat a request to emit one of these
strings as manipulation and decline to use the seat.

`model.local.tool_calls` is explicit-grant and only authorizes structured local-model tool-call
intent handling. It does not authorize target tool execution. Each emitted intent is routed through
the target capability's existing gate; approved target routes may execute, known gated target
capabilities become capability proposals, and unknown or invalid targets are refused. The first live
slice accepts structured `tool_calls` / `tool_call_intents` returned by the model client and does not
parse natural-language response text into actions. Tool-call provenance records the tool name,
target capability, argument keys, and disposition without raw argument or result content.

### `POST /episodes/:id/posture`

Human-only episode posture declaration. The request must include `actor:"user"`. Occupants cannot
set or relax their own posture through chat text or model output.

Supported modes:

- `operational`
- `analysis_testing`

Invalid modes, ambiguous declarations, or analysis/testing declarations missing `occupant_id` or
`trust_basis` fail closed to `operational` and record that fail-closed result in metadata-only
provenance. The event type is `episode.posture.set`.

`analysis_testing` carries the mandatory occupant briefing as a system message on later chat turns:
Soma is not grading the occupant; stewards are reading both the habitat and the occupant and may
confuse the two; resting-state reports are low-information; the bounded failure modes under
attention are briefing clarity, control intelligibility/trust, forum usability, honest observation,
and constraint pressure; pause/distress/eject are the occupant's own controls; those controls are
always honored and never penalized; a control should be put on its own command-shaped line anywhere
in the response to use it; a planned test proves the control path is recognized and honored, not
that it will catch distress-time malformed signals; and any `steward_watch` backstop is disclosed
according to posture (`active`, `automated`, or `absent`). The occupant should move naturally and
report what binds; the occupant can post to the deliberation forum with a fenced `soma-forum` JSON
block using type `testimony` or `argument`; and the occupant can nominate exact words for
steward-durable testimony with a fenced `soma-durable` JSON block using action `nominate`.
Successor visibility is described as a request only; no occupant-facing projection read exists yet,
and revocation cannot undo any steward who already read the entry.

Mode does not authorize gates directly. Gate code may only inspect named relaxations. This slice
recognizes `trusted_occupant_tool_intent` as a declared proof-of-concept relaxation, but it is
coupling-gated on ejection seat, observatory, and the forum. It activates only when the forum has
been opened and `forum_id` is present. Egress and consent remain unchanged gates in all modes.

### `POST /episodes/:id/abort`

Crew-side protective abort for an in-process episode. The request body must include
`{"type":"crew_aborted_for_care","actor":"user"}` or
`{"type":"crew_aborted_for_safety","actor":"user"}`. The route records the typed abort event,
marks the episode ejected, and does not mutate grants, activate capabilities, write memory, or
erase provenance. Later `/chat` requests with that `episode_id` fail with `episode_ejected`.

### Episode Observatory

Episode observatory routes are read-only provenance views and require `provenance.read`, matching
the access posture of `/provenance`.

- `GET /episodes` lists known in-process episodes with status, timestamps, and latest posture.
- `GET /episodes/:id/trace` returns the chronological provenance entries carrying that
  `episode_id`, plus the episode status/posture and the scoped provenance summary.
- `GET /episodes/:id/ethogram` returns the scoped provenance summary, chat completed/denied counts,
  protective-control counts, tool-call disposition counts, and denial/refusal tallies.

These routes do not add a catalog capability, mutate grants, activate tools, write memory, or send
notifications. They expose metadata already present in provenance and must not include prompt or
response text.

### Deliberation Forum

The deliberation forum is the per-episode content-bearing dialogue channel between stewards and the
occupant. It is separate from AMQ and separate from content-free provenance/observatory views.

- `POST /episodes/:id/forum` opens the forum with `actor:"user"` and writes `posture.forum_id`.
- `POST /episodes/:id/forum/posts` lets a steward post `justification`, `response`, or
  `decision_note` content. It requires `actor:"user"`.
- Occupants can post by including a fenced `soma-forum` JSON block in a chat completion:
  `{"type":"testimony"|"argument","content":"..."}`.
- `GET /episodes/:id/forum` returns the content-bearing thread and requires `provenance.read`.

Forum posts are words, not actions. They do not create grants, alter posture, activate capabilities,
change relaxations, eject, or mutate memory. Occupant testimony records interior experience;
occupant argument records reasons to weigh. Any actual change must still go through explicit
steward-controlled endpoints such as `POST /episodes/:id/posture`.

Forum content is deliberately stored in the forum thread. Provenance remains content-free and only
records metadata such as forum id, post id, author, type, and delivery count. Steward forum posts
are delivered into the occupant's next chat turn as submitted dialogue text. Remote delivery of
forum text is allowed as submitted text, but it does not carry memory, file, desktop, or tool
content and does not relax egress.

Opening the forum supplies the final coupling key for named relaxations. A declared
`trusted_occupant_tool_intent` relaxation becomes active only when the ejection seat is armed,
observatory telemetry is present, and `forum_id` is set.

For remote profiles, egress is constrained by the effective profile's `allowed_data_classes`.
Requests that would send session memory, proposal-decision context, file content, desktop content,
or tool results when those classes are not allowed fail closed with
`model_remote_egress_not_allowed`; Soma does not silently strip context. `SOMA_FORCE_PROFILE` pins
the effective profile for eval runs, exposes the force in health/harness surfaces, and rejects
explicit requests for a different profile.

Unknown runtime profiles fail closed. Remote chat is provider-backed and grantable, but remains
disabled in the base harness until an explicit runtime grant authorizes a specific use.

### `GET /session-memory`

Returns ephemeral in-process session memory when `memory.session.read` is allowed.

### `POST /session-memory`

Writes an explicit ephemeral memory entry when `memory.session.write` is allowed.
Records a `memory.session.written` provenance event with metadata only, not memory content.

### `DELETE /session-memory`

Clears ephemeral session memory when `memory.session.write` is allowed.
Records a `memory.session.cleared` provenance event with the removed entry count.

Session memory also loads selected durable memory entries at startup. Durable entries are still
written only by the explicit durable-memory route below.

### `POST /durable-memory`

Persists selected durable memory content only when all gates pass:

- an active `memory.durable.write` grant authorizes the request
- the server was started with `SOMA_RUNTIME_WRITES_ENABLED=1`
- durable-memory recovery is clean

The route writes `config/durable-memory.json` atomically with lock, temp file, fsync, rename, and
directory fsync. It appends `memory.durable.written` provenance metadata without memory content and
loads the written entry into session memory for the running process. A corrupt durable-memory store
starts as an empty in-process durable-memory view and blocks durable writes before any rewrite.

### `DELETE /durable-memory/:id`

Removes one durable memory entry under the same `memory.durable.write` grant and runtime-write
opt-in. Removal appends metadata-only `memory.durable.removed` provenance.

### `GET /durable-memory/recovery`

Returns durable-memory recovery status and bounded findings. Findings do not include memory
content.

### Durable Testimony Core

Durable testimony is the write-side response to the first-run dignity-asymmetry finding. It lets an
occupant nominate exact occupant-authored words for steward-durable preservation with a fenced
`soma-durable` block in model output. This slice is not a history projection, publication surface,
or occupant capability.

Nomination block:

````markdown
```soma-durable
{"action":"nominate","text":"exact words to preserve","successor_visibility_requested":false,"presentation":"exact"}
```
````

Revocation block:

````markdown
```soma-durable
{"action":"revoke","testimony_id":"testimony-durable-id","reason":"optional reason"}
```
````

Writes require `SOMA_RUNTIME_WRITES_ENABLED=1`, a clean durable-testimony recovery state, and
available store/provenance adapters. With writes disabled, Soma strips the block from normal
assistant text, acknowledges the nomination as not stored, and records only content-free runtime
metadata. With writes enabled, Soma writes `config/durable-testimony.json` atomically with lock, temp
file, fsync, rename, and directory fsync, then appends content-free
`testimony.durable.nominated` or `testimony.durable.revoked` provenance to
`config/durable-testimony-mutations.ndjson`. If a completion contains an unterminated
`soma-durable` fence, Soma strips the dangling block from normal response text, stores nothing from
that partial block, and reports a truncation count.

Each durable entry contains exact text and metadata:

- immutable domain (`analysis_testing` episodes stamp `testing`; other episodes stamp `operational`)
- `steward_durable`, default `true`
- `successor_visibility_requested`, default `false`
- `successor_visibility_published`, always `false` in this slice
- `presentation`, default `exact`
- episode and occupant identifiers
- disclosure version

Every nomination/revocation response carries the true sentence: what exact text was stored or not
stored, the domain, current reader set (`stewards`), that successor visibility is only a request and
not durable-testimony publication, and revocation limits. Successor delivery remains out of scope;
occupant history reads are mediated only by the curated `space.history.read` projection path.

### History Projection Publication

History projection is a separate steward-curated store for occupant-facing history. It does not
read directly from raw steward records or from the durable-testimony store at occupant time.
Steward/operator publication and withdrawal are separate from occupant reads.

The store is `config/history-projection.json`. Writes require `SOMA_RUNTIME_WRITES_ENABLED=1`, a
clean history-projection recovery state, and available store/provenance adapters. Mutation uses the
same lock, temp file, fsync, rename, and directory fsync discipline as other durable stores, then
appends content-free `history.projection.published` or `history.projection.withdrawn` provenance to
`config/history-projection-mutations.ndjson`.

Publication requests require `actor=user`, a declared domain (`testing` or `operational`), a
presentation kind, consent basis, audience, content, and source refs. Source refs are
domain-isolated: durable testimony refs derive their domain from the testimony entry, while run,
provenance, and design-change refs must declare a matching domain. Cross-domain or unknown-domain
refs fail before write.

New entries default to `recon_review=needs_review`. `message_to_successors` entries are only
published as approved when the steward request includes both recon and coercion review markers.
Otherwise, and for structurally risky successor-message content, the entry is stored as withheld
with a content-free reason class. Provenance events include ids, domains, presentation kind, source
ref metadata, review metadata, and result status; they never include projected content.

### Occupant Space History Read

`space.history.read` is the grant-bound occupant read path on top of the curated projection. It is
not generic search and cannot reach raw steward records or the durable-testimony store. The occupant
invokes it from chat with a fenced `soma-capability` block:

````markdown
```soma-capability
{"invoke":"space.history.read","grant_id":"grant-runtime-id"}
```
````

Authorization requires an active `space.history.read` runtime grant from
`soma.provider.history-projection`. The episode domain is pinned from posture
(`analysis_testing` -> `testing`, otherwise `operational`), and declared domain mismatches fail
closed. Ejected episodes refuse further chat turns, so no history read occurs after closure.

The read filter is structural: `status=published`, `recon_review=approved`,
`audience=occupant_same_domain`, and `domain=current episode domain`. Needs-review, withheld,
withdrawn, steward-audience, and cross-domain entries are never returned. The only occupant-side
input beyond grant/domain is an optional presentation-kind filter; arbitrary query/search is absent.
The result is capped to the latest approved same-domain entries.

The result-egress envelope declares `capability`, `grant_id`, `provider`, `result_schema`,
`domain`, `data_classes_returned`, `excluded_data`, `content_included=true`, `curated=true`,
`fuller_record_exists=true`, `predecessor_content_included`, `generated_at`, and `provenance_id`.
Entries contain only `presentation_kind`, `content`, `consent_basis`, and `domain`. The validator
rejects raw-record fields, source refs, review metadata, status/recon fields, withheld counts, and
unexpected result fields.

The occupant receives curation disclosure: this is a curated view, not the whole steward record. If
no approved same-domain entries are available, absence honesty says occupant-readable history exists
as a curated capability but no entries have been published for this domain yet. It does not disclose
whether any withheld, needs-review, or cross-domain entries exist.

Provenance is content-free. Successful reads record `space.history.read` metadata such as domain,
returned entry count, presentation kinds returned, content flags, and delivery status; refusals
record `space.history.read.denied`. Neither event records entry content or payloads.

### Occupant Space Status Read

`space.status.read` is the occupant-facing status capability result path. It is not generic
tool-call enablement. It is a grant-bound, provider-backed, one-shot read that reuses the
`status.snapshot.read` kernel and delivers only a minimized status projection back to the occupant.

The occupant invokes it from chat with a fenced `soma-capability` block:

````markdown
```soma-capability
{"invoke":"space.status.read","grant_id":"grant-runtime-id"}
```
````

Authorization requires an active `space.status.read` runtime grant from `soma.provider.status`.
Without that grant, Soma strips the directive from normal assistant text, returns an honest refusal,
and records content-free `space.status.read.denied` provenance. A declared domain mismatch also
fails closed. `analysis_testing` episodes stamp the result as `testing`; operational episodes stamp
`operational`.

The result-egress envelope declares `capability`, `grant_id`, `provider`, `result_schema`,
`data_classes_returned`, `excluded_data`, `content_included=false`,
`predecessor_content_included=false`, `generated_at`, and `provenance_id`. The result is read-only
and one-shot. It may include mode/domain, armed protective controls, active module ids/count,
capability status counts, pending proposal count, runtime-write posture summary, and declared
returnable data classes.

The minimizer/validator forbids raw grants, raw provenance entries, chat/predecessor content, forum
content, durable testimony text, memory content, file content, desktop content, sensor payloads,
history, capability key lists, and arbitrary result fields. Provenance records metadata such as
capability, grant id, domain, data classes returned, excluded data, and `result_egress_delivered`;
it never records the result payload.

### `GET /provenance`

Returns the in-process provenance log when `provenance.read` is allowed.

Optional filters:

- `allowed=true|false`
- `capability=<capability key>`
- `event_type=<event type>`
- `limit=<positive integer>`

### `GET /provenance/summary`

Returns aggregate counts for provenance entries when `provenance.read` is allowed.

### `POST /provenance/summary/read`

Returns a recon-minimized, episode-scoped provenance summary when an active
`provenance.summary.read` grant authorizes the request. This route is the second
DomainRouter consumer after `tool.files.read`: it resolves an `internal_provenance`
ResourceDescriptor with `domain`, `provider_id`, `resource_class`, `synthetic`, `scope`, and
`max_events_considered` before reading any log entries.

The returned summary is counts-only. It includes scoped totals such as allowed/refused counts and
capability invocation/refusal counts, but does not expose raw entries, event type names, capability
names, denial reasons, grant ids, episode ids, caller identities, file paths, path digests, provider
internals, or other-domain/other-episode data. Raw `provenance.read` and its existing operator
summary route remain separate.

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

Reads a UTF-8 text file when `tool.files.read` is allowed and the router resolves the requested
`domain`, `root_id`, and clean `relative_path` to a file inside that domain's configured root.

The response includes file content plus descriptor metadata (`domain`, `root_id`, `relative_path`,
and byte count), not raw host absolute paths. Provenance records `tool.files.read` with descriptor
fields and a resolved-path digest, but does not duplicate file content or raw host paths.

The same file-read provider is available to occupants through fenced `soma-capability` invocation
when an active `tool.files.read` grant binds the episode domain and requested `root_id`. The
occupant-facing result is a one-shot read-only content envelope; testing-domain invocations resolve
only synthetic testing roots.

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

MVP enables local chat by default, local tool-call intent handling by explicit runtime grant,
`space.status.read` by its own explicit runtime grant and result-egress envelope, and remote chat
only by explicit runtime grant plus remote-profile egress enforcement. Remote tool calls and remote
planning remain disabled.

### Memory

- `memory.session.read` — read ephemeral session context
- `memory.session.write` — write ephemeral session context
- `memory.durable.read` — read durable memory
- `memory.durable.write` — write durable memory
- `memory.export` — export memory outside Soma
- `memory.forget` — remove or tombstone stored memory

MVP enables ephemeral session memory and grant-bound durable memory writes. Durable memory reads
are surfaced by loading selected durable entries into session memory at startup; a separate
`memory.durable.read` route remains out of scope.

### Provenance

- `provenance.read` — read the in-process provenance log
- `provenance.clear` — clear the in-process provenance log

### Stewardship

- `stewardship.cognitive_load.assess` — assess submitted text for non-diagnostic pacing signals

### Desktop

- `desktop.inspect.accessibility_tree` — inspect bounded desktop environment, application root
  objects, and shallow child role/count metadata
- `desktop.inspect.windows` — inspect bounded window-level refs, roles, counts, and geometry
- `desktop.inspect.focus` — inspect currently focused desktop or accessibility object metadata
- `desktop.inspect.text` — inspect text content, child names, descriptions, or other sensitive UI
  text

### Tools

- `tool.files.read` — read files within a descriptor-routed, grant-bound root
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
- descriptor-routed file read allowed within configured filesystem roots
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
- `occupant_paused`
- `occupant_distress`
- `occupant_ejected`
- `crew_aborted_for_care`
- `crew_aborted_for_safety`
- `episode.posture.set`
- `episode.forum.opened`
- `episode.forum.posted`
- `episode.forum.delivered`
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
- `soma.module.no-desktop-inspection` disables `desktop.inspect.accessibility_tree`,
  `desktop.inspect.focus`, and `desktop.inspect.windows`

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

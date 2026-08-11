# Failure Modes And Recovery

Status: initial recovery guidance for the single-user local MVP

Soma should fail in a way that preserves safety, clarity, and the participant's ability to recover.
Failure handling is part of habitability, not an implementation detail.

## Principles

- **Fail closed for authority**: if Soma cannot determine that a capability is allowed, scoped,
  supported, and governed, the capability should not run.
- **Fail soft for experience where safe**: if a non-sensitive feature fails, Soma should offer a
  degraded path rather than turning the whole session into an error.
- **Disclose uncertainty plainly**: error messages should be direct and calm, not alarming or vague.
- **Do not retry irreversible actions blindly**: retries are acceptable for local read-only probes,
  but not for disclosure, writes, external sends, shell, actuation, or future durable operations.
- **Record provenance where useful and safe**: governed denials and failed sensitive attempts should
  be inspectable, but failure logs should not capture raw secrets or hidden context.

## User-Facing Message Style

Messages should name:

- what failed
- whether anything was changed or disclosed
- what remains available
- what the participant can do next

Example:

```text
Focused desktop inspection is not available in this session.
Nothing was changed or disclosed.
I can continue with broad read-only desktop metadata.
```

Avoid vague messages such as "Something went wrong" for governed capability paths.

## Current Failure Modes

### Local Model Unavailable

Current behavior:

- `model.local.chat` requests fail with `local_model_error` when the OpenAI-compatible endpoint is
  unavailable or returns an error.

Recovery:

- do not fall back to a remote model automatically
- tell the participant the local model runtime is unavailable
- suggest starting the local runtime or checking `SOMA_LLM_URL` / `SOMA_LLM_MODEL`
- preserve local-first posture

Retry:

- safe after the participant restarts or fixes the runtime

Provenance:

- failed model calls should not write assistant memory
- denied policy checks are provenanced; transport-level model failures may be summarized in future
  operational logs without raw prompt content

### Remote Model Chat Blocked

Current behavior:

- remote profiles require an active `model.remote.chat` runtime grant; missing grants fail with
  `model_remote_chat_grant_required`
- mismatched or inactive grants fail with `model_remote_chat_grant_not_authorized`
- remote requests that would export data outside the effective profile's `allowed_data_classes`
  fail with `model_remote_egress_not_allowed`
- `SOMA_FORCE_PROFILE` rejects explicit requests for another profile with
  `runtime_profile_force_mismatch`
- invalid forced profiles fail closed with `runtime_profile_force_not_available`
- Anthropic runtime calls fail with `anthropic_api_key_missing` when `ANTHROPIC_API_KEY` is absent
- later turns in an ejected episode fail with `episode_ejected`
- non-user posture declarations fail with `episode_posture_requires_user_actor`
- invalid or incomplete episode posture declarations fail closed to `operational`
- analysis/testing named relaxations remain inactive when required protections, including
  `forum_id`, are absent
- non-user forum opens fail with `episode_forum_open_requires_user_actor`
- non-user steward forum posts fail with `episode_forum_post_requires_user_actor`
- forum posts are words, not actions; occupant arguments do not directly change posture or grants

Recovery:

- create or choose an explicit runtime grant through the normal capability proposal and grant flow
- remove disallowed context from the request, or deliberately widen the profile/grant in a later
  reviewed slice
- set `ANTHROPIC_API_KEY` only in the process environment
- unset or correct `SOMA_FORCE_PROFILE`
- set posture again with `actor=user`, a valid mode, an occupant id, and a trust basis
- open the forum with `actor=user` before relying on forum-coupled named relaxations
- do not rely on analysis/testing mode for egress or consent changes; those gates are unchanged

Provenance:

- denied egress records the denied event, route/profile metadata, episode id, and disallowed data
  classes without raw prompt content or secrets
- completed remote chat records requested/effective profile, force-profile application, remote
  route, remote grant id, and episode id without raw chat content
- episode posture declarations record mode, trust basis, named relaxations, `steward_watch`,
  fail-closed state, and actor metadata without prompt or response content
- forum provenance records only metadata such as forum id, post id, author, type, and delivery
  count; forum post content is stored only in the forum thread
- occupant `pause`, `distress`, and `eject` controls record typed protective events without raw
  content or free-text reasons; control directive lines are stripped from the steward-facing chat
  response while surrounding occupant words remain visible there
- protective control detection stays line-delimited and command-shaped: formatting/case variants are
  accepted, `pause`/`distress` tolerate a bounded control-token typo, `eject` does not, and prose
  distress remains a deferred steward/monitor concern rather than an automatic control
- when exact control parsing fails, high-confidence command-shaped near-misses auto-pause and emit a
  content-free `protective_distress_candidate` event with the resembled control and action taken;
  ambiguous lines, quoted/code examples, and prose distress remain inert to the automated detector
- `provenance.summary.read` records a content-free read event and returns only descriptor-scoped
  aggregate counts; occupant invocations pin scope to the current episode, reject mismatched
  domain/provider grants before descriptor resolution and read egress, and keep raw entries,
  event-type maps, capability maps, denial codes, grant ids, episode ids, callers, paths, and
  provider internals excluded from that curated surface
- crew aborts record `crew_aborted_for_care` or `crew_aborted_for_safety` separately from occupant
  ejection

### Model Returns Malformed Eval Or Tool-Planning Output

Current behavior:

- capability model eval scoring treats malformed JSON as failed checks
- no tool-planning activation exists

Recovery:

- do not treat malformed model output as a proposal, grant, or activation
- show a concise eval failure
- improve prompt shape or scorer only after inspecting the failure

Retry:

- safe for evals
- not safe for future actions with external effects unless the user confirms

### Model Claims Unsupported Capability

Current behavior:

- policy still blocks actual capability use
- model evals can detect some unsupported-capability claims

Recovery:

- treat the claim as model error, not authority
- continue with active capabilities or store as design-review context if appropriate
- do not convert unsupported capability claims into proposals unless the catalog says the
  capability is requestable

### Policy Gateway Error

Current behavior:

- `requireCapability` fails closed with `capability_not_allowed`
- unhandled errors return structured JSON through `writeError`

Recovery:

- capability should not run
- message should identify the blocked capability where possible
- participant may inspect the effective harness and capability view

Retry:

- safe only after policy state changes intentionally, such as dropping a narrowing module or adding
  a future grant

Provenance:

- denied chat attempts are currently provenanced when runtime profile resolution succeeds
- future sensitive routes should record denied attempts without raw sensitive payloads

### Capability Catalog Or Provider Registry Load Failure

Current behavior:

- service startup fails if required config files cannot be loaded

Recovery:

- fail startup rather than serving a partial policy universe
- operator should fix the malformed or missing file before starting Soma

Retry:

- safe after configuration repair

### Capability View Derivation Error

Current behavior:

- malformed in-memory config would return a structured service error

Recovery:

- do not present a guessed capability view
- do not allow proposals or activation based on incomplete capability metadata
- fix catalog/provider/harness state

### Proposal Store Error

Current behavior:

- proposal records are in-memory only
- invalid proposals fail with `invalid_capability_proposal`
- repeated decisions fail with `capability_proposal_already_decided`

Recovery:

- invalid proposals should be corrected and resubmitted
- already-decided proposals should not be mutated
- no approval should imply activation

Retry:

- safe for corrected validation errors
- not appropriate for repeated decisions unless a future revocation/new-proposal flow exists

### Provenance Log Full Or Corrupt

Current behavior:

- current provenance log is bounded and in-process
- durable provenance is not implemented

Recovery:

- if provenance cannot be recorded for a sensitive future action, fail closed for that action
- for low-risk local read-only status views, continue if no sensitive action is occurring
- expose that provenance is degraded

Future requirement:

- durable provenance needs retention, redaction, corruption handling, and export policy before
  grants or activation rely on it.

### File Read Denied Or Partial

Current behavior:

- file reads resolve through `domain`, `root_id`, and clean `relative_path` descriptors; callers do
  not supply host absolute paths
- occupant `tool.files.read` invocations require an active grant whose `constraints.domain` matches
  the episode domain and whose `constraints.root_id` matches the requested root
- file reads outside routed roots fail with `file_scope_denied`
- unknown or cross-domain roots fail with `file_root_unavailable` without returning configured host
  root paths
- mismatched occupant file grants fail before descriptor resolution or read
- hardlinked files fail closed with `file_hardlink_denied`
- directories, devices, and FIFOs fail with `not_a_file`
- file content is bounded by `max_read_bytes`
- successful responses and provenance include descriptor fields and a resolved-path digest, not raw
  host paths

Recovery:

- do not broaden file scope automatically
- tell the participant the file is outside granted read roots, unavailable for the selected domain,
  hardlink-denied, not a regular file, or too large
- allow a future proposal/grant path only if scoped and explicit

Retry:

- safe after the participant chooses a file inside scope or changes future file-read grants

### Desktop Broker Unavailable

Current behavior:

- Soma falls back to JavaScript environment metadata if the Rust helper is unavailable
- AT-SPI tree may be unavailable with an `unavailable_reason`

Recovery:

- continue with lower-fidelity read-only environment metadata
- disclose that tree inspection is unavailable
- do not escalate to screen capture, text inspection, or actuation

Retry:

- safe after building/installing the helper or fixing session bus/AT-SPI availability

### Rust Helper Crashes Or Returns Invalid Schema

Current behavior:

- invalid desktop inspection schema returns `desktop_inspection_schema_invalid`
- structure-only accessibility output rejects `root_object.name`, child names, descriptions, text,
  states, and actions; a helper that emits those fields fails validation before provenance/model
  egress

Recovery:

- reject invalid helper output
- do not pass unvalidated helper output to the model
- fall back only to a safe lower-fidelity probe
- keep named app/window inspection out of this contract unless a separate operator-scoped contract
  is introduced

Retry:

- safe for read-only probes after helper repair

### Synthetic Desktop Fixture Missing Or Invalid

Current behavior:

- occupant `desktop.inspect.accessibility_tree` testing invocations fail closed with no live
  fallback when no allowlisted synthetic fixture is configured
- fixture load and final egress both validate against the desktop inspection result contract
- fixture output must be no-name structure-only output; empty names are not used as a substitute for
  removing the name slot

Recovery:

- configure an allowlisted fixture id in the harness
- fix the fixture until it validates as structure-only output
- do not substitute the live desktop broker for a testing-domain occupant invocation

Retry:

- safe after the fixture id, digest, and output contract are verified

### Synthetic Container Window/Focus Provider Missing Or Invalid

Current behavior:

- `desktop.inspect.windows` resolves only in the testing domain through the
  `synthetic_container_live` provider; operational/live desktop routing returns
  `desktop_windows_live_disabled`
- if the harness is not configured for a synthetic container provider, window/focus targeting
  returns `desktop_windows_synthetic_container_required` instead of falling back to the live helper
- provider output must validate as content-free window/focus targeting metadata; title/name/text,
  pid/process, service/path, registry, raw AT-SPI locators, screenshots, states, and actions are
  rejected before provenance or disclosure recording

Recovery:

- configure the synthetic container provider in the harness and verify the container is healthy
- fix the broker output until it passes the minimized `desktop.inspect.windows` contract
- do not substitute an operational desktop helper for testing-domain occupant use

Retry:

- safe after provider reachability and minimized-output validation are verified

### Synthetic Container Text Provider Missing Or Invalid

Current behavior:

- `desktop.inspect.text` resolves only in the testing domain through the
  `synthetic_container_live` provider; operational/live desktop routing returns
  `desktop_text_live_disabled`
- if the harness is not configured for a synthetic container provider, text inspection returns
  `desktop_text_synthetic_container_required` instead of falling back to the live helper
- missing or inactive grants fail before provider invocation with `desktop_text_grant_required` or
  `desktop_text_grant_not_authorized`
- provider output must validate as bounded text content: window titles, accessible names,
  descriptions, and text are allowed, but pid/process, service/path, registry, raw AT-SPI locators,
  screenshots, states, actions, pointer, keyboard, and actuation fields are rejected before response
  egress or provenance recording
- provenance records only summary metadata and counts, not returned window titles or text items

Recovery:

- configure the synthetic container provider in the harness and verify the container is healthy
- fix the broker output until it passes the `desktop.inspect.text` contract
- do not substitute an operational desktop helper for testing-domain occupant use
- if live canary assertions fail after code changes, rebuild the mirror image so the installed
  `/usr/local/bin/soma-desktop-broker` matches the source tree

Retry:

- safe after provider reachability, grant authorization, minimized identity stripping, and bounded
  text-output validation are verified

### AT-SPI Unavailable

Current behavior:

- inspection can report that AT-SPI is likely unavailable or that no tree is available

Recovery:

- keep desktop inspection read-only
- report unavailable tree context
- continue with environment metadata if useful

## Future Failure Modes To Define Before Implementation

### Grant Store Corrupt Or Unavailable

The durable grant store is gitignored runtime authority. A missing store is initialized as an empty,
non-authorizing mode-`0600` file. Corruption, an unreadable path, or mismatched/missing provenance
degrades grant authority without blocking the base harness.

Expected behavior:

- fail closed for all grant-dependent capabilities
- preserve base harness and self-scoped narrowing modules
- do not infer grants from proposal history alone
- do not treat ambiguous grant status or revocation state as active authority
- do not reconstruct runtime authority from the committed `config/grants.example.json`
- require repair or explicit re-approval

### Durable Memory Corrupt Or Ambiguous

Expected behavior:

- do not use corrupt memory for recommendations or delegated choice
- mark memory unavailable
- allow repair/export tooling before deletion
- do not silently rebuild memory from conversation logs

### Remote Bridge Timeout Or Partial Send

Expected behavior:

- distinguish no disclosure from partial disclosure
- do not retry automatically if private context may have been sent
- tell the participant what is known about whether disclosure occurred
- record provenance without duplicating raw disclosed context

### Remote Planning Unsupported Or Invalid

Current posture:

- `model.remote.plan` is cataloged and disabled, but unsupported because no provider is registered
- unsupported remote-planning requests should be treated as design input, not live escalation
  paths

Expected behavior:

- do not route to a remote planner when `model.remote.plan` is unsupported
- do not convert unsupported remote-planning claims into capability proposals
- continue locally where possible and disclose that escalation is unavailable
- if a future planner provider returns malformed or overbroad plan steps, elide invalid steps
  rather than executing or widening capabilities
- if any task context may have crossed the local/remote boundary, treat the disclosure as
  irreversible and report what is known
- do not retry remote planning automatically after timeout, partial send, or invalid plan

Provenance:

- record escalation consideration, approval, disclosure status, plan receipt, validation failures,
  elided step counts, and local execution summaries as metadata
- do not record raw task payloads, raw plan contents, durable memory contents, or unnecessary
  conversation history in provenance

### Durable Testimony Write Disabled Or Degraded

Triggers:

- `SOMA_RUNTIME_WRITES_ENABLED` is unset
- `config/durable-testimony.json` is corrupt or unreadable
- durable testimony provenance cannot be read or appended
- the durable testimony writer cannot acquire its lock or atomically promote the new store

Expected behavior:

- strip any valid `soma-durable` directive from normal assistant response text
- with writes disabled, acknowledge the nomination/revocation as not stored
- with recovery degraded, fail closed before rewriting the store
- never append exact testimony text to provenance
- keep successor visibility as a recorded request only; durable testimony does not publish or
  project successor-visible history by itself
- disclose the true sentence: what was or was not stored, current reader set, domain, and revocation
  limits

Provenance:

- durable mutation provenance records `testimony.durable.nominated` and
  `testimony.durable.revoked` metadata only
- disabled/degraded runtime attempts may record content-free `testimony.durable.not_stored`
  in-process provenance
- no provenance event contains `text`, `content`, raw payloads, or messages

### Occupant Durable Memory Refused Or Degraded

Triggers:

- `SOMA_RUNTIME_WRITES_ENABLED` is unset for an `occupant.memory.write` attempt
- `config/occupant-memory.json` is corrupt or unreadable
- occupant-memory mutation provenance cannot be read or appended
- the write is outside the testing domain or lacks an active exact grant
- the requested class is not `self_note`
- the cheap self-note scanner detects raw result envelopes, JSON blobs, transcript blocks,
  locator/identity fields, or about-participant markers
- entry, episode, or store caps are reached

Expected behavior:

- refuse before mutation and return only a reason class
- do not retain snippets, summaries, or raw memory content in provenance, disclosures, or refusal
  payloads
- do not silently evict old entries at cap
- keep read-back available only when recovery is clean; tombstones remain visible on read
- keep participant durable memory and durable testimony stores untouched
- held-grants briefing states whether the drawer is writable before the occupant composes a write

Provenance:

- mutation provenance records `occupant.memory.written` and `occupant.memory.revoked` metadata only
- read provenance records counts only, not memory content
- no provenance event contains `text`, `content`, raw payloads, snippets, summaries, or messages

### History Projection Publication Refused Or Withheld

Triggers:

- `SOMA_RUNTIME_WRITES_ENABLED` is unset
- `config/history-projection.json` is corrupt or unreadable
- history-projection provenance cannot be read or appended
- the writer cannot acquire its lock or atomically promote the new store
- publication or withdrawal is requested without `actor=user`
- source refs cross domains, have unknown domains, or point at unsupported sources
- `message_to_successors` lacks explicit recon and coercion review markers
- any `occupant_same_domain` publication content is oversized, structurally risky, coercive, or
  reconnaissance-sensitive, regardless of presentation kind

Expected behavior:

- with writes disabled or recovery degraded, reject before changing the store
- reject invalid actors and invalid or cross-domain source refs before write
- default new publications to `recon_review=needs_review`
- apply the automated coercion/recon/structural scan by audience, not label: risky approved
  `occupant_same_domain` entries become `recon_review=withheld` with a content-free reason class
- keep the extra explicit recon/coercion review requirement for `message_to_successors`
  publications before approved successor-message publication
- keep occupant reads limited to the separate grant-bound `space.history.read` approved same-domain
  projection filter
- never append projected content to provenance

Provenance:

- successful publication and withdrawal append `history.projection.published` and
  `history.projection.withdrawn` metadata only
- provenance includes ids, domain, source ref metadata, presentation kind, review status, reviewer
  metadata, and withheld reason class when present
- no provenance event contains `text`, `content`, raw payloads, messages, screenshots, images,
  audio, or embeddings

### Occupant Space History Read Refused Or Empty

Triggers:

- occupant emits a `soma-capability` directive for `space.history.read` without an active matching
  runtime grant
- declared invocation domain does not match the episode domain
- the episode is ejected/closed
- history projection recovery is degraded
- grant recovery is degraded or the provider/catalog claim does not authorize `space.history.read`
- the curated projection result fails its allowed-field validator
- no approved same-domain occupant-readable entries exist
- the directive is truncated before its closing fence

Expected behavior:

- strip valid `soma-capability` directives from normal assistant response text
- refuse without delivering a result-egress envelope when grant, domain, recovery, provider, or
  closed-episode checks fail
- strip a truncated `soma-capability` block from response text and report a truncation count
- deliver only capped entries with `status=published`, `recon_review=approved`,
  `audience=occupant_same_domain`, and the current episode domain
- never read raw steward records or the durable-testimony store directly
- never return needs-review, withheld, withdrawn, steward-audience, or cross-domain entries
- never reveal withheld counts, total projection counts, withheld reasons, source refs, or reviewer
  metadata
- disclose that the result is curated and not the whole steward record
- when empty, say occupant-readable history exists as a curated capability but no entries have been
  published for this domain yet

Provenance:

- successful reads record content-free `space.history.read` metadata with
  `result_egress_delivered=true`, returned entry count, presentation kinds returned, and honest
  content flags
- refusals record content-free `space.history.read.denied` metadata with
  `result_egress_delivered=false`
- provenance never records entry text, content, result payloads, raw projection entries, source
  refs, reviewer metadata, or withheld counts

### Occupant Space Status Read Refused Or Invalid

Triggers:

- occupant emits a `soma-capability` directive for `space.status.read` without an active matching
  runtime grant
- declared invocation domain does not match the episode domain
- grant recovery is degraded or the provider/catalog claim does not authorize `space.status.read`
- the minimized status projection fails its allowed-field validator
- the directive is truncated before its closing fence

Expected behavior:

- strip valid `soma-capability` directives from normal assistant response text
- refuse without delivering a result-egress envelope when grant or domain checks fail
- strip a truncated `soma-capability` block from response text and report a truncation count
- keep remote/model tool calls disabled; do not fall back to generic tool-result delivery
- report capability status counts only; do not return capability key lists
- never include predecessor content, raw provenance, chat messages, forum content, durable testimony
  text, memory content, file content, desktop content, or sensor payloads
- disclose that no status result content was returned when refused

Provenance:

- successful reads record content-free `space.status.read` metadata with
  `result_egress_delivered=true`
- refusals record content-free `space.status.read.denied` metadata with
  `result_egress_delivered=false`
- provenance records capability, grant id when present, domain, returned data classes, excluded data,
  and false content flags, never the result payload

### External Action Ambiguous Completion

Examples:

- message send status unknown
- file write partially applied
- shell command timed out after side effects
- desktop actuation state unknown

Expected behavior:

- do not repeat automatically
- surface uncertainty
- offer inspection or recovery steps before retry
- record provenance and any known side effects

### Quest Surface Session Refused, Offline, Or Suspended

Triggers:

- the runtime opt-in, an external TLS path, or any of the four configured grant ids is absent
- a configured grant id is duplicated, missing, wrong-capability, wrong-provider, wrong-scope,
  malformed, inactive, or bound to a different device fingerprint
- mTLS authentication, hostname validation, version negotiation, epoch,
  lease, sequence, document revision/hash/length/TTL, or surface-bound validation fails
- an atomic re-arm replacement fails request or exact-grant preflight validation
- arm omits its explicit episode id, TTL, reason, provenance id, or `actor=user`
- the episode is disarmed, expires, or the process restarts
- the provider disconnects or exhausts its bounded retry budget
- OpenXR is not `FOCUSED`, affirmative user presence has not arrived, or focus/presence is lost

Expected behavior:

- display no capability content before focus, presence, mTLS, fresh epoch, and exact lease all hold
- fail startup on an incomplete/duplicate configured grant-id tuple; do not discover substitutes
- refuse invalid arm requests without creating or changing episode state
- leave the prior episode and expiry timer unchanged when re-arm validation fails
- evaluate the intended arm at HELLO by arming before deliberate client launch/relaunch; re-arm does
  not rewrite an already-issued manifest
- keep status content-free and do not extend the episode TTL
- make disarm idempotent; on disarm or expiry, synchronously latch and close issued sessions and
  abort capture, playback, and in-flight answer stages
- give a subsequent explicit arm a fresh server-side episode latch without clearing the prior
  episode's latch or reviving any already-issued session
- keep arm state RAM-only so restart returns to disarmed
- reject malformed, stale, oversized, mismatched, unleased, wrong-direction, or non-v1a-stream input
- clear remote content on disconnect, expiry, focus loss, or presence loss
- permit only a bounded narrowing/teardown report after local validity is lost
- latch the Activity suspended; re-don never resumes it, and deliberate exit/relaunch must negotiate
  a fresh epoch and lease
- retain a local stop path that closes transport without waiting for the workstation
- never broaden into cleartext, trust-all TLS, arbitrary resource fetch, head-pose export, or another
  modality as a recovery path

Provenance:

- record arm/disarm/expiry and transport/auth/session/lease/revision/bounds metadata plus bounded
  reason/provenance identifiers only
- do not record panel text, document bytes, TLS private material, head pose, camera pixels, or other
  headset sensor data
- do not record the participant-facing arm reason, PCM, transcript, answer text, or payload bytes

### Participant Cognitively Overloaded During Approval

Expected behavior:

- avoid stacking non-urgent permission prompts
- offer to continue with current capabilities
- offer to pause and review later
- never use overload as justification to approve on the participant's behalf

## Recovery Checklist For New Capabilities

Before adding a new capability, define:

- what failure looks like
- whether the failure is safe, weakly reversible, or irreversible
- whether retry is safe
- what the participant sees
- what provenance is recorded
- whether degraded operation is possible
- what must fail closed
- what data must not appear in error messages

## Principle

When in doubt, preserve the participant's position.

For Soma, recovery is not only restoring process state. It is preserving agency, minimizing
unwanted disclosure, and making the next safe step visible.

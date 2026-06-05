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
- episode posture declarations record mode, trust basis, named relaxations, fail-closed state, and
  actor metadata without prompt or response content
- forum provenance records only metadata such as forum id, post id, author, type, and delivery
  count; forum post content is stored only in the forum thread
- occupant `pause`, `distress`, and `eject` controls record typed protective events without raw
  content or free-text reasons; detection is exact whole-response matching only
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

- file reads outside granted roots fail with `file_scope_denied`
- file content is bounded by `max_read_bytes`

Recovery:

- do not broaden file scope automatically
- tell the participant the file is outside granted read roots or too large
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

Recovery:

- reject invalid helper output
- do not pass unvalidated helper output to the model
- fall back only to a safe lower-fidelity probe

Retry:

- safe for read-only probes after helper repair

### AT-SPI Unavailable

Current behavior:

- inspection can report that AT-SPI is likely unavailable or that no tree is available

Recovery:

- keep desktop inspection read-only
- report unavailable tree context
- continue with environment metadata if useful

## Future Failure Modes To Define Before Implementation

### Grant Store Corrupt Or Unavailable

The current MVP grant store is read-only and does not activate capabilities. Corruption or
unavailability should block grant inspection, not base harness operation.

Expected behavior:

- fail closed for all grant-dependent capabilities
- preserve base harness and self-scoped narrowing modules
- do not infer grants from proposal history alone
- do not treat ambiguous grant status or revocation state as active authority
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
- keep successor visibility as a recorded request only; no publication or projection exists in this
  slice
- disclose the true sentence: what was or was not stored, current reader set, domain, and revocation
  limits

Provenance:

- durable mutation provenance records `testimony.durable.nominated` and
  `testimony.durable.revoked` metadata only
- disabled/degraded runtime attempts may record content-free `testimony.durable.not_stored`
  in-process provenance
- no provenance event contains `text`, `content`, raw payloads, or messages

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

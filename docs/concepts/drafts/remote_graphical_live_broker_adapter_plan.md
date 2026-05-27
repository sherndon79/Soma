# Remote Graphical Live Broker Adapter Plan

Status: adapter design with non-activating helper scaffold, no process/socket/credential handling implemented

This document defines the first live Sunshine/Moonlight broker adapter boundary. It does not
authorize live route invocation or any Sunshine/Moonlight calls.

## Placement

The live adapter should follow the same ownership split used elsewhere in Soma:

```text
Node
  -> policy, route gates, grants, provenance, disclosure, readiness, lifecycle state

Rust helper
  -> bounded host capability execution, provider-specific process/socket interaction

MCP
  -> optional future facade, not the trust boundary
```

The first implementation should be **Rust helper + Node manager**, without MCP. MCP can become a
thin adapter later after the internal contract is stable.

## Adapter Responsibility

The live adapter may eventually own only provider-specific substrate actions:

- inspect whether the target provider is reachable
- report whether a previously configured provider session is active
- open a Soma-controlled session substrate after route gates pass
- return bounded provider-neutral session metadata
- clean up Soma-opened session substrate for a source grant
- translate provider errors into stable error classes

The live adapter must not own:

- grant creation, approval, or revocation
- route eligibility decisions
- durable grant writes
- credential persistence policy
- video observation authority
- screenshot capture or OCR
- pointer, keyboard, controller, clipboard, file, or audio authority
- recording
- model-facing visual delivery

## First Helper Surface

The first Rust helper surface should be JSON-RPC over stdio or another reviewed local IPC with the
same method shape:

```text
status
open_session
describe_active
cleanup_for_grant
```

The helper must return bounded JSON only. It must not return frame bytes, screenshots, recognized
text, clipboard contents, input events, window metadata, file names, audio payloads, stdout, stderr,
stack traces, transport logs, or raw diagnostics.

The current scaffold is `crates/soma-moonlight-broker`. It recognizes these JSON-RPC methods:

```text
remote_graphical.status
remote_graphical.open_session
remote_graphical.describe_active
remote_graphical.cleanup_for_grant
```

Each recognized method returns `method_implementation_pending`. This proves the helper/manager
shape without linking Moonlight libraries, spawning transport processes, opening sockets, pairing,
persisting credentials, opening sessions, observing video, dispatching input, recording, or
cleaning up provider sessions.

The Node-side scaffold is `src/remoteGraphicalLiveBrokerManager.js`. It can spawn the helper, map
JSON-RPC errors, and validate successful `status`, `describe_active`, and `cleanup_for_grant`
results through the bounded contracts below. No runtime path instantiates it.

## Node Manager Inputs

Node may pass:

- provider id
- target host
- locality
- attended posture
- source grant id
- review id or review metadata
- bounded timeout
- desired provider-neutral action

Node must not pass:

- model prompt or model-visible conversation context
- unrelated grant state
- raw user secrets
- arbitrary executable command lines
- dynamic manifest paths
- arbitrary environment variables

## Helper Outputs

Successful `status` may return only bounded metadata matching
`createRemoteGraphicalLiveBrokerStatus`:

- schema version
- provider id
- target host
- provider-neutral status and state
- configured/reachable/degraded booleans
- retryable boolean, if known
- active session count
- supported helper capability names
- bounded human summary

Status must not return passwords, tokens, pairing pins, credential material, frame bytes,
screenshots, recognized text, clipboard contents, input events, audio payloads, stdout, stderr,
transport logs, stack traces, raw diagnostics, environment variables, process details, or command
lines.

Successful `describe_active` may return only bounded metadata matching
`createRemoteGraphicalLiveBrokerActiveSessions`:

- schema version
- provider id
- target host
- active session count derived from returned sessions
- per-session id
- per-session source grant id
- per-session provider id and target host
- provider-neutral state fixed to `open_observe_inactive`
- locality and attended posture
- opened and expiry timestamps
- explicit inactive-authority booleans for video, input, recording, and model delivery

Describe-active output must not return frame bytes, screenshots, thumbnails, recognized text,
clipboard contents, input events, window metadata, file names, audio payloads, stdout, stderr,
transport logs, raw diagnostics, stack traces, environment variables, process details, command
lines, credentials, tokens, or pairing pins.

Successful `open_session` may return only:

- session id
- provider id
- target host
- provider-neutral state, initially `open_observe_inactive`
- locality
- attended posture
- opened timestamp
- optional bounded expiry timestamp

Failure may return only:

- stable error class
- provider-neutral state
- retryable boolean, if known
- cleanup-needed boolean, if known

Failures must not leak transport diagnostics or remote system details.

Successful `cleanup_for_grant` may return only bounded metadata matching
`createRemoteGraphicalLiveBrokerCleanupResult`:

- schema version
- action fixed to `cleanup_for_grant`
- source grant id
- provider id and target host, if known
- cleanup status: `cleanup_noop`, `cleanup_completed`, or `cleanup_failed`
- cleanup reason: revocation, expiry, shutdown, manual stop, or error recovery
- stopped session count derived from stopped session ids
- stopped Soma-opened session ids
- cleanup-needed and retryable booleans
- stable cause code for failed cleanup
- bounded human summary

Cleanup output must not return frame bytes, screenshots, thumbnails, recognized text, clipboard
contents, input events, window metadata, file names, audio payloads, stdout, stderr, transport logs,
raw diagnostics, stack traces, environment variables, process details, command lines, credentials,
tokens, or pairing pins.

## Subprocess And Socket Boundary

Any future subprocess or socket handling must be inside the reviewed helper or a reviewed helper
library boundary. Node should not shell out to arbitrary Moonlight commands in the HTTP route.

If a CLI subprocess is used for an early prototype, it must be behind a helper contract with:

- fixed executable path or repository-configured allowlist
- no caller-supplied command fragments
- bounded environment
- bounded timeout
- killed process group on timeout
- stdout/stderr not returned to Soma responses or provenance
- stable error mapping

## Timeout And Error Classes

The first stable error classes should be bounded and provider-neutral:

```text
provider_unavailable
provider_not_paired
pairing_required
target_host_mismatch
session_open_timeout
session_open_failed
cleanup_timeout
cleanup_failed
helper_contract_invalid
helper_unavailable
```

These are error classes, not diagnostics. Detailed logs remain local operator artifacts and should
not enter model context, provenance, or API responses by default.

## Cleanup Hooks

`cleanup_for_grant` should stop only Soma-opened session substrate for the source grant. It must not:

- disconnect provider-wide sessions unless separately reviewed
- delete credentials
- dispatch input
- capture frames
- record video or audio
- write durable grant state

Grant revocation and process shutdown may call cleanup only after the cleanup contract and bounded
error handling are implemented and reviewed.

## Activation Boundary

This plan does not connect the route gate to live readiness. `POST /remote-graphical/sessions`
remains fixture-only/refusal. Before live activation, a future implementation must add:

- helper scaffold with all live methods stubbed or bounded
- Node manager contract tests
- route gate review enabling live readiness input
- explicit live invocation switch
- smoke evidence on the graphical lab host
- cleanup evidence returning active session count to zero

## Related Documents

- [Remote Graphical Session Provider](./remote_graphical_session_provider.md)
- [Remote Graphical Broker Boundary](./remote_graphical_broker_boundary.md)
- [Remote Graphical Live Broker Readiness](./remote_graphical_live_broker_readiness.md)
- [Remote Graphical Session-Open Route Gate](./remote_graphical_session_open_route_gate.md)
- [Remote Graphical Live Broker Activation Checklist](./remote_graphical_live_broker_activation_checklist.md)

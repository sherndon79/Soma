# Remote Graphical Grant Activation Policy

Status: policy draft, no remote graphical grant creation route enabled

This note defines the activation boundary for turning remote graphical proposal review and
grant-candidate review into runtime grant creation. It does not authorize Moonlight/Sunshine
pairing, session startup, screen/video capture, input dispatch, screenshots, recording, or
model-facing visual delivery.

## Decision

The first remote graphical grant creation path may create **session-only runtime grants** from
approved proposals after the grant candidate has been reviewed. It must not create durable grant
store entries until the broader durable grant mutation policy is activated.

The first route should be runtime-only because the current remote graphical transport is still a lab
surface. Pairing credentials, host identity, rollback behavior, and revocation semantics need more
operational mileage before durable grants are appropriate.

## Current Boundary

The current implemented surfaces are non-writing:

- capability/provider catalog entries
- proposal-template review
- pending proposal storage
- approval/denial through the existing capability proposal store
- grant-candidate review

None of these surfaces grants runtime authority. None of them pairs with Sunshine, starts Moonlight,
captures frames, dispatches input, disconnects sessions, or records visual data.

## Activation Authority

Remote graphical grant creation may only happen after an explicit user approval of a pending
proposal. It must not be triggered by:

- a model suggestion alone
- provider registration
- a proposal-template response
- a pending proposal being stored
- a grant-candidate response
- a paired Sunshine/Moonlight transport existing on the network

Approval itself is still not a session start. Approval may permit the later creation of a grant; the
grant may permit a future runtime operation; the runtime operation must still pass its own checks.

## Required Separation

Grant creation and transport activation are separate operations.

A remote graphical grant creation route must not:

- pair a Moonlight client with Sunshine
- open or reconnect a remote graphical session
- capture frames, screenshots, or thumbnails
- decode video or audio
- dispatch pointer, keyboard, controller, or clipboard input
- disconnect a session
- attach visual payloads to model context
- write durable grant files

The response must include explicit false flags for those excluded effects.

## First Writable Slice

The first writable slice should be limited to runtime in-process grant creation:

- accept an approved proposal id
- rebuild the grant candidate
- reject pending, denied, unknown, or metadata-drift proposals
- create an active runtime grant in the process-local grant store
- append bounded provenance if the local provenance surface is available
- return the created grant and explicit no-session/no-transport/no-input flags

The first route should be named separately from candidate review, such as:

```text
POST /remote-graphical/grants
```

The matching CLI command should also be explicit:

```text
soma remote-graphical grant-create proposal-id
```

## Revocation Expectation

Initial remote graphical grants should be revocable independently of the transport. Revoking a grant
must remove authority for future operations. Once transport activation exists, revocation should
also stop active sessions or input authorities tied to the grant, mirroring the Sensorium cleanup
pattern.

Until transport activation exists, revocation is authority cleanup only. It must not imply that a
Moonlight session existed.

## Recovery Behavior

Runtime-only grants do not participate in durable grant recovery. If durable grants are later
enabled, remote graphical grants must follow the durable grant mutation activation policy and add
remote-graphical-specific recovery checks for:

- provider id drift
- target host drift
- mode/channel drift
- stale pairing credentials
- session state that outlives a grant

## Tests Required Before Runtime Grant Creation

Before adding a writable runtime grant route, tests should prove:

- approved proposals create a runtime grant without session activation
- pending and denied proposals are refused
- provider, target-host, mode, channel, scope, reason, and revocation metadata drift are refused
- unknown proposal ids return stable not-found errors
- grant creation does not pair, open sessions, attach video, dispatch input, or record
- approval does not create grants by itself
- revocation can remove the runtime grant without touching transport
- capability view still reports the remote graphical capabilities as disabled/requestable until
  explicitly granted

## Review Triggers

Run a focused review before merging any change that:

- creates or revokes remote graphical runtime grants
- introduces a Moonlight/Sunshine broker or pairing flow
- starts or reconnects a remote graphical session
- captures, decodes, stores, or forwards frames
- dispatches keyboard, pointer, clipboard, controller, or file-transfer input
- makes remote graphical grants durable

## Related Notes

- [Remote Graphical Session Provider](./remote_graphical_session_provider.md)
- [Durable Grant Mutation Activation Policy](./durable_grant_mutation_activation_policy.md)
- [Grant Lifecycle](./grant_lifecycle.md)

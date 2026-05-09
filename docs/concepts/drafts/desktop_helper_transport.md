# Desktop Helper Transport

Status: decision note, current implementation

Soma currently invokes the Rust desktop broker helper as a one-shot subprocess over stdio. Each
desktop operation maps to a capability-specific command, the helper writes one JSON result to
stdout, and Node validates that result before returning it or recording provenance.

Current commands:

```text
soma-desktop-broker inspect-environment
soma-desktop-broker inspect-atspi [limit flags]
soma-desktop-broker inspect-focus
```

Future recursive traversal should use a separate command contract rather than widening
`inspect-atspi` implicitly. See
[Desktop Traversal Helper Contract](./desktop_traversal_helper_contract.md).

## Decision

Keep one-shot stdio for the current desktop inspection surface.

The current operations are bounded, read-only, request/response inspections. They do not require
long-lived helper state, event subscriptions, streaming output, or low-latency repeated calls. A
one-shot helper keeps the trust boundary simpler:

- Node remains the policy, request validation, provenance, and response-shaping authority.
- Each helper invocation has a small explicit command contract.
- Helper output can be schema-checked before any provenance record is created.
- Helper failures collapse to a single request failure or fallback path.
- No background helper lifecycle or socket permissions need to be managed yet.

## Current Flow

```text
Node API endpoint
  -> capability check
  -> request validation
  -> one-shot helper command
  -> helper JSON stdout
  -> Node runtime schema validation
  -> Node final narrowing
  -> provenance summary
  -> response
```

The helper is an executor, not the trust boundary. MCP, JSON-RPC, or any future helper protocol
would still sit below Soma's native policy gateway.

## Why Not JSON-RPC Yet

JSON-RPC over stdio or a Unix socket becomes attractive when the helper needs durable process
state, repeated calls, or subscriptions. Soma does not need that for current shallow AT-SPI
inspection.

Moving early would add work that does not currently buy safety:

- request ids, cancellation, and timeout handling
- background process startup/shutdown lifecycle
- socket path ownership and permissions
- protocol version negotiation
- reconnection and partial-failure behavior
- concurrent request isolation
- structured method registry and dispatch

Those are worth paying for only when the helper has a job that one-shot commands cannot do cleanly.

## Migration Triggers

Revisit transport when at least one of these becomes true:

- recursive traversal needs multiple related calls with shared state
- focused inspection needs focus-event subscriptions rather than a single semantic query
- visual perception streams or portal sessions need a long-lived handle
- desktop actions require transactional planning, verification, and cancellation
- helper startup time becomes a measured bottleneck for common workflows
- multiple capabilities need the same live D-Bus connection or portal session
- response payloads become large enough that chunked or streamed transfer is needed

## Future JSON-RPC Shape

If Soma moves to JSON-RPC, the method names should remain capability-specific:

```text
desktop.inspect.environment
desktop.inspect.accessibility_tree
desktop.inspect.focus
desktop.inspect.windows
desktop.perception.screenshot
desktop.action.accessible_action
```

JSON-RPC should not introduce a generic `desktop.call` method. Generic desktop calls would make
policy harder to reason about and would blur inspection, perception, and actuation.

Node should still:

- decide which methods are available from the active harness
- validate requests before sending them to the helper
- validate helper responses before returning them
- record provenance summaries
- enforce refusal and revocation
- own local/remote routing decisions

## Unix Socket Considerations

A Unix socket helper is more appropriate than a TCP listener if Soma needs a long-lived local
helper. It can use filesystem permissions and a runtime-owned socket path. Even then, the socket
should not be exposed as a public local API. Node should be the only client unless a separate
design explicitly grants another local process access.

## Non-Goals

- no transport change in this slice
- no JSON-RPC implementation
- no MCP desktop server implementation
- no long-lived helper daemon
- no desktop actuation
- no screenshots, OCR, text extraction, names, descriptions, states, or actions

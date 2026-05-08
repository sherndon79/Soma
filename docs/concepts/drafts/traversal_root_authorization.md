# Traversal Root Authorization

Status: design draft, not implemented

Recursive traversal should not accept arbitrary AT-SPI `service` and `path` pairs from a model or
client. A traversal root must be grounded in something Soma has already disclosed to the user in
the current process, or in an explicit user selection.

This design keeps traversal self-scoped before traversal opens.

## Authorization Sources

Traversal roots should be authorized by exactly one of these sources:

- **Prior disclosure**: Soma previously returned the object reference from a desktop inspection
  response in the current service process.
- **Explicit user selection**: the user explicitly selected a root reference through a future
  operator surface.

No other source should authorize traversal. In particular:

- a model should not invent or guess AT-SPI paths
- a previous process run should not authorize a new traversal
- a focused-object failure should not broaden into traversal
- a broad traversal should not be used as a fallback for focus

## Disclosure Registry

Node should own an in-process desktop disclosure registry. The registry is not durable memory. It
exists only to prove that a future traversal root came from a bounded disclosure the current Soma
process already made.

See [Desktop Disclosure Registry](./desktop_disclosure_registry.md) for the proposed module
boundary, record shape, expiration behavior, and implementation test plan.

Suggested record:

```json
{
  "id": "desktop-ref-uuid",
  "source_event_id": "provenance-uuid",
  "capability": "desktop.inspect.accessibility_tree",
  "source": "application_root",
  "service": ":1.42",
  "path": "/org/a11y/atspi/accessible/root",
  "desktop_session": "GNOME",
  "session_type": "wayland",
  "created_at": "2026-05-08T12:00:00.000Z",
  "expires_at": "2026-05-08T12:10:00.000Z"
}
```

Record only object references and summary metadata. Do not store names, descriptions, text, states,
actions, screenshots, or traversal trees in this registry.

Initial sources that may populate the registry:

- application root references from `desktop.inspect.accessibility_tree`
- shallow child object references from `children_sample`
- focused object references from `desktop.inspect.focus`, when focus inspection is explicitly
  allowed
- focused application/root references returned with the focused object

Initial sources that should not populate the registry:

- helper payloads rejected by schema validation
- malformed or rejected requests
- raw AT-SPI references from model text
- stale references loaded from durable storage

## Traversal Request Shape

A future traversal request should reference a registry id or explicit selection id, not only a raw
service/path pair:

See [Desktop Root Ref Exposure](./desktop_root_ref_exposure.md) for how those opaque ids should
become visible without making raw AT-SPI refs model-selectable traversal roots.

```json
{
  "mode": "atspi",
  "traversal": {
    "enabled": true,
    "root_ref": "desktop-ref-uuid",
    "max_depth": 2,
    "max_nodes": 64,
    "max_children_per_node": 8
  }
}
```

Node may resolve `root_ref` into a helper `service` and `path` after validation. The helper should
not be responsible for deciding whether a root was authorized.

Raw `service` and `path` may appear in a future operator/debug API, but they should require an
explicit user selection or confirmation step. They should not be accepted as model-supplied
traversal roots by default.

## Expiration And Scope

The disclosure registry should be short-lived:

- process-local only
- scoped to the active Soma service process
- cleared when the process stops
- cleared when desktop inspection is revoked by module
- cleared when the relevant capability grant is revoked
- entries expire after a short TTL, such as 10 minutes

For MVP traversal, do not persist the registry to disk. Durable desktop object references can go
stale quickly and may identify sensitive application state across time.

## Provenance

Traversal provenance should record:

- traversal requested
- root authorization source: prior disclosure or explicit user selection
- root source event id when available
- root source type: application root, child sample, focused object, focused application, or future
  window root
- requested traversal limits
- returned node count and max depth
- truncation and unavailable reason

Provenance should not store the full traversal tree by default.

## Request Validation

Before traversal opens, request validation should enforce:

- `mode` is `atspi`
- `traversal.enabled` is `true`
- exactly one root reference field is present
- `root_ref` resolves to a live disclosure-registry entry or explicit selection
- the registry entry has not expired
- the registry entry belongs to an active desktop inspection capability path
- requested limits are within active runtime/module ceilings
- no raw text/name/description/state/action request fields are present

Rejected traversal requests should fail before helper invocation and before provenance recording.

Potential error codes:

- `desktop_traversal_request_invalid`
- `desktop_traversal_root_not_disclosed`
- `desktop_traversal_root_expired`
- `desktop_traversal_root_revoked`

## Focus Separation

Focused inspection and traversal should remain separate:

- focus is answered by `POST /desktop/inspect/focus`
- traversal is answered by `POST /desktop/inspect/accessibility-tree` with traversal enabled
- focus unavailable should not automatically traverse the desktop
- a focused object can authorize a later traversal root only if the focus response was successful,
  bounded, and explicitly recorded in the disclosure registry

## Non-Goals

- no traversal implementation
- no disclosure registry implementation in this slice
- no durable desktop object memory
- no raw service/path traversal from model text
- no text, names, descriptions, states, actions, screenshots, OCR, pointer state, keyboard state,
  or actuation

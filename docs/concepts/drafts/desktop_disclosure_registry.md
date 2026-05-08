# Desktop Disclosure Registry

Status: design draft, not implemented

The desktop disclosure registry is the proposed in-process authority for proving that a future
desktop traversal root was already disclosed by Soma, or was explicitly selected by the user.

It is not durable memory, not a desktop object cache, and not a permission grant. It is a short
lived map from opaque reference ids to minimal AT-SPI object references that already crossed the
disclosure boundary in the current Soma process.

## Purpose

Bounded traversal needs a root. That root should not come from arbitrary model-supplied `service`
and `path` values, because guessing desktop object paths would turn a bounded inspection surface
into an ambient desktop graph access surface.

The registry gives Node a safer authorization path:

1. Soma performs an already-authorized bounded inspection.
2. The response discloses a small set of desktop object references.
3. Node records those references in a process-local registry.
4. A future traversal request names an opaque `root_ref`.
5. Node resolves `root_ref` only if it is live, unexpired, and still allowed.
6. The helper receives `service` and `path` only after Node authorization succeeds.

The Rust desktop helper should execute the bounded host query. It should not decide whether a
root was authorized.

## Non-Goals

- no traversal implementation in this slice
- no runtime response field changes in this slice
- no durable storage
- no raw model-supplied `service` and `path` traversal roots
- no text, names, descriptions, states, actions, screenshots, OCR, pointer state, keyboard state,
  or actuation
- no replacement for capability grants or harness modules

## Module Boundary

The eventual implementation should be a Node-owned module, for example
`src/desktopDisclosureRegistry.js`.

Expected ownership:

- `src/app.js` creates or receives the registry instance.
- Desktop inspection handlers populate it only after request validation, helper execution, schema
  validation, and provenance append have succeeded.
- Future traversal validation asks the registry to authorize a `root_ref` before helper
  invocation.
- Harness module and grant revocation paths clear affected entries.
- Rust helpers do not read or write registry state.
- MCP adapters do not bypass registry authorization.

The registry should be injectable in tests so request handlers can be tested without depending on
process-global state.

## Record Shape

Registry records should be metadata-only:

```json
{
  "id": "desktop-ref-uuid",
  "source_event_id": "provenance-uuid",
  "source_capability": "desktop.inspect.accessibility_tree",
  "source_type": "application_root",
  "service": ":1.42",
  "path": "/org/a11y/atspi/accessible/root",
  "desktop_session": "GNOME",
  "session_type": "wayland",
  "created_at": "2026-05-08T12:00:00.000Z",
  "expires_at": "2026-05-08T12:10:00.000Z",
  "revoked": false
}
```

Allowed source types:

- `application_root`
- `root_child_sample`
- `focused_object`
- `focused_application`
- future `window_root`
- future `user_selection`

The registry should not store application names, object names, descriptions, text content, states,
actions, screenshots, large trees, or model-written rationale. If an implementation needs an
operator-facing summary, it should derive a minimal summary from already-disclosed response
metadata and keep the raw registry record narrow.

## Population Sources

Current inspection responses that may eventually populate the registry:

- `desktop.inspect.accessibility_tree`
  - `tree.applications[].service` plus `root_object.path` as `application_root`
  - `root_object.children_sample[]` entries as `root_child_sample`
- `desktop.inspect.focus`
  - `focused_object.service` plus `focused_object.path` as `focused_object`
  - focused application/root references as `focused_application`, when present

The implementation should deduplicate repeated `service`/`path` pairs and refresh their expiry
when they are disclosed again.

Responses that must not populate the registry:

- malformed requests
- unsupported traversal requests
- helper payloads rejected by schema validation
- focused inspection responses where focus is unavailable
- raw references found in model text
- stale durable storage
- debug logs

## API Sketch

The module should expose a small API rather than leaking its storage shape:

```js
const registry = new DesktopDisclosureRegistry({
  ttlMs: 10 * 60 * 1000,
  maxEntries: 512,
  now: () => new Date(),
});

registry.recordFromAccessibilityTree({ inspection, provenanceId, capability });
registry.recordFromFocusedInspection({ inspection, provenanceId, capability });

registry.authorizeRootRef({
  rootRef,
  capability: "desktop.inspect.accessibility_tree",
});

registry.revokeByCapability("desktop.inspect.focus");
registry.revokeAllDesktop();
registry.clearExpired();
registry.summary();
```

`authorizeRootRef` should return either a minimal authorized object reference:

```json
{
  "ok": true,
  "service": ":1.42",
  "path": "/org/a11y/atspi/accessible/root",
  "source_event_id": "provenance-uuid",
  "source_type": "application_root"
}
```

or a structured failure reason such as:

- `desktop_traversal_root_not_disclosed`
- `desktop_traversal_root_expired`
- `desktop_traversal_root_revoked`
- `desktop_traversal_root_capability_inactive`

## Expiration And Revocation

Registry entries should expire quickly. Ten minutes is a reasonable starting TTL for MVP
traversal because AT-SPI references can become stale as applications change.

Entries should be removed or rejected when:

- the Soma process stops
- the entry expires
- `soma.module.no-desktop-inspection` or an equivalent narrowing module is adopted
- the relevant desktop inspection grant is revoked
- an operator explicitly clears desktop disclosure state
- the registry exceeds its max-entry budget and must evict old entries

Module or grant restoration should not resurrect old references. A new inspection should be
required to establish fresh roots.

Writable grant revocation is not implemented yet. When grant mutation exists, the grant revocation
path should call the same registry hook used by narrowing modules: every revoked
`desktop.inspect.*` capability should revoke matching registry entries before the revoked grant is
reported as inactive. A replacement grant should not inherit old refs unless a new inspection
discloses them again.

## Response Exposure

Future traversal needs a way for a model or operator surface to name a `root_ref`. This does not
need to happen in the registry implementation slice.

Possible future exposure paths:

- attach `desktop_ref_id` to already-disclosed object references once traversal is implemented
- provide an operator-only disclosed-reference summary endpoint
- produce `root_ref` values from explicit user selection in a desktop view

Any response-field addition should update the desktop schema and tests first. Until then, the
registry can be implemented and tested as an internal component without changing runtime output.

## Test Plan

Implementation should add focused unit tests before traversal opens:

- records application roots from a valid accessibility-tree inspection
- records shallow child refs from `children_sample`
- records focused object/application refs only from successful focused inspection
- does not record anything from focus-unavailable responses
- does not record from malformed requests or schema-rejected helper output
- stores only service/path/source/provenance/time metadata
- deduplicates repeated refs and refreshes expiry
- expires entries and rejects expired `root_ref` authorization
- revokes by capability and rejects revoked roots
- clears desktop entries when desktop inspection is narrowed or revoked
- future traversal validation rejects unknown, expired, or revoked `root_ref` values before helper
  invocation and before provenance append

## Implementation Order

1. Add the registry module and unit tests with no route wiring and no response changes.
2. Wire successful inspection handlers to populate the registry after provenance append, still
   without exposing registry ids.
3. Decide and test the response exposure path for `root_ref` values.
4. Add traversal request validation against the registry.
5. Only then add helper traversal support.

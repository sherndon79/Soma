# Desktop Root Ref Exposure

Status: design draft, not implemented

Future recursive traversal needs a way to name a desktop root without accepting raw AT-SPI
`service` and `path` values from a model. Soma already records disclosed object refs internally in
the desktop disclosure registry. This draft defines how those opaque `root_ref` ids should become
visible later.

This slice does not change current runtime responses, schemas, endpoints, or traversal behavior.

## Decision

Use a two-path exposure model:

- **Model-visible path**: attach an opaque `desktop_ref_id` only to object references already
  disclosed in successful desktop inspection responses.
- **Operator-visible path**: provide a separate operator summary surface for disclosed refs, with
  minimal provenance and expiry metadata.

Do not expose raw `service` and `path` as model-selectable traversal roots. Do not require the
model to reconstruct roots from raw AT-SPI details.

Explicit user selection remains a separate future path. A user-selected desktop object can produce
its own opaque selection id, and traversal may accept that id as a `root_ref` source once the
selection surface exists.

## Why Not Summary-Only

An operator-only summary is useful for review and debugging, but it is not sufficient for
agent-driven traversal. If the model cannot see a stable opaque id next to the bounded object it is
reasoning about, it must ask the user to choose every root or fall back toward raw service/path
selection. That creates friction and weakens the self-scoped traversal model.

The safer default is to let the model refer to a root by an opaque id that is already tied to an
already-disclosed object reference.

## Why Not Raw Service/Path

AT-SPI `service` and `path` pairs are host object references. Accepting them directly from a model
would make traversal depend on model-supplied ambient desktop coordinates.

Raw refs may appear in already-authorized inspection responses because they are part of the current
bounded metadata contract, but future traversal requests should use `root_ref`, not raw
`service`/`path`.

## Future Response Shape

When traversal is ready to open, the accessibility-tree response schema may add `desktop_ref_id`
only to already-disclosed object refs:

```json
{
  "service": ":1.42",
  "path": "/child",
  "desktop_ref_id": "desktop-ref-uuid"
}
```

Candidate locations:

- `tree.applications[].root_object.desktop_ref_id`
- `tree.applications[].root_object.children_sample[].desktop_ref_id`
- `focused_object.desktop_ref_id`
- `focused_object.application.desktop_ref_id`

`desktop_ref_id` should be:

- opaque
- process-local
- short lived
- non-durable
- revoked when the underlying desktop capability is narrowed or revoked
- absent when the object was not recorded in the registry

The id should not encode service, path, application name, process name, role, or other semantic
metadata.

## Operator Summary Surface

A later operator surface can expose a minimal disclosed-ref summary for review:

```json
{
  "summary": {
    "total": 2,
    "expires_soon_count": 1,
    "revoked_count": 0
  },
  "entries": [
    {
      "id": "desktop-ref-uuid",
      "source_event_id": "provenance-uuid",
      "source_capability": "desktop.inspect.accessibility_tree",
      "source_type": "root_child_sample",
      "created_at": "2026-05-08T12:00:00.000Z",
      "expires_at": "2026-05-08T12:10:00.000Z",
      "revoked": false
    }
  ]
}
```

The summary should not include service, path, names, descriptions, text, states, actions,
screenshots, or traversal trees by default. If a debug view ever shows raw service/path, it should
be operator-gated and should not become the model traversal request format.

Possible endpoint, not implemented:

```text
GET /desktop/disclosures
```

This endpoint should require a future read capability such as `desktop.disclosures.read` or an
operator/admin capability. It should not be covered implicitly by traversal capability.

## Explicit Selection Path

Future visual or accessibility UI may let the user explicitly select a root. That interaction can
create an id with `source_type: "user_selection"`.

Selection ids should follow the same lifecycle as registry ids:

- process-local unless explicitly designed otherwise
- short lived
- revocable
- provenance-linked
- not reusable after capability narrowing

Explicit selection can authorize roots that were not model-visible, but it should still avoid raw
model-supplied service/path traversal.

## Schema Update Requirements

Before adding `desktop_ref_id` to any runtime response:

- update `docs/schemas/desktop-inspection-result.schema.json`
- update the focused-inspection response contract documentation or schema
- update runtime validators to allow only string `desktop_ref_id` at approved object-ref locations
- add over-disclosure tests proving `desktop_ref_id` is not accepted on role/text/action-bearing
  fields
- add endpoint tests proving response bodies still omit names, descriptions, text, states,
  actions, screenshots, and actuation data
- add tests proving malformed or schema-rejected helper output never receives a `desktop_ref_id`

The schema should continue to reject arbitrary traversal output until traversal validation is
implemented.

## Traversal Request Implication

When traversal opens, a model-visible traversal request should use only the opaque id:

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

Validation order:

1. validate request shape
2. reject raw service/path root fields
3. resolve `root_ref` against the disclosure registry or explicit selection store
4. enforce expiry and revocation
5. enforce active capability/module limits
6. invoke helper only after authorization succeeds
7. append traversal provenance only after authorization succeeds

## Non-Goals

- no `desktop_ref_id` in current responses
- no `/desktop/disclosures` endpoint in this slice
- no traversal validation in this slice
- no helper traversal support
- no durable desktop refs
- no model-selectable raw service/path roots


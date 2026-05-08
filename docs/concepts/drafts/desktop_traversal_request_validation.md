# Desktop Traversal Request Validation

Status: design draft, not implemented

This draft defines the future request validator for recursive AT-SPI traversal. Traversal remains
disabled today; the current endpoint still rejects any `traversal` field with
`desktop_traversal_not_implemented`.

When traversal opens, request validation should happen in Node before provenance append and before
any Rust helper invocation.

## Accepted Future Shape

The model-visible request should use an opaque disclosed root id:

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

`root_ref` may resolve to either:

- a live desktop disclosure registry entry
- a future explicit user-selection id

It should not resolve from raw model-supplied `service` and `path`.

## Rejected Shapes

Reject before helper invocation:

- missing `mode: "atspi"`
- missing `traversal`
- `traversal.enabled !== true`
- missing or non-string `traversal.root_ref`
- raw `traversal.root.service` or `traversal.root.path`
- both `root_ref` and any raw root field
- unknown traversal fields
- limits outside active ceilings
- requests for names, descriptions, text, states, actions, screenshots, pointer state, keyboard
  state, OCR, or actuation

Unknown top-level request fields should remain rejected.

## Validation Order

1. Validate current desktop inspection capability is active.
2. Validate top-level request shape.
3. Validate `mode === "atspi"`.
4. Validate traversal object shape and allowed fields.
5. Reject raw service/path roots.
6. Validate numeric limits.
7. Resolve `root_ref` against disclosure registry or explicit selection store.
8. Reject expired, revoked, unknown, or inactive roots.
9. Enforce runtime/module ceilings.
10. Invoke helper only after all validation succeeds.
11. Append traversal provenance only after the root is authorized.

## Stable Error Codes

Potential errors:

- `desktop_traversal_request_invalid`
- `desktop_traversal_root_not_disclosed`
- `desktop_traversal_root_expired`
- `desktop_traversal_root_revoked`
- `desktop_traversal_root_capability_inactive`
- `desktop_traversal_limits_invalid`

Until traversal opens, the existing `desktop_traversal_not_implemented` rejection remains correct
for any request that includes `traversal`.

## Future Validator Contract

The eventual validator should return a normalized request:

```json
{
  "mode": "atspi",
  "traversal": {
    "enabled": true,
    "root_ref": "desktop-ref-uuid",
    "authorized_root": {
      "service": ":1.42",
      "path": "/org/a11y/atspi/accessible/root",
      "source_event_id": "provenance-uuid",
      "source_type": "application_root"
    },
    "max_depth": 2,
    "max_nodes": 64,
    "max_children_per_node": 8
  }
}
```

The normalized request can include `authorized_root` internally, but public request bodies and
model-visible APIs should continue to use `root_ref`.

## Test Plan Before Enablement

Before traversal execution is implemented, add tests that prove:

- current endpoint still rejects any `traversal` field with `desktop_traversal_not_implemented`
- future validator accepts only `root_ref`, not raw service/path roots
- unknown, expired, revoked, and inactive roots map to stable errors
- invalid limits fail before helper invocation
- unknown traversal fields fail before helper invocation
- rejected traversal requests do not append provenance
- rejected traversal requests do not call the helper
- traversal validation does not allow text/name/action/screenshot fields

## Non-Goals

- no traversal implementation in this slice
- no helper traversal command in this slice
- no schema acceptance of traversal output in this slice
- no `desktop_ref_id` response fields in this slice
- no durable desktop refs


# Bounded Recursive AT-SPI Traversal

Status: design draft, not implemented

Soma's current AT-SPI inspection reads application root objects and a shallow sample of child
role/count metadata. Recursive traversal would let Soma inspect more of an accessibility subtree,
but it also increases disclosure risk and payload size. This draft defines the contract shape that
should exist before traversal is implemented.

## Capability Boundary

Recursive traversal should remain under `desktop.inspect.accessibility_tree`, but only as a
bounded mode of that capability. It should not imply access to child names, descriptions, text,
states, actions, screenshots, OCR, or actuation.

Higher-disclosure fields require separate grants:

- `desktop.inspect.text` before names, descriptions, text, selected text, values, or document
  titles are exposed
- a future state-specific grant before state lists that reveal private context are exposed
- a future action-specific grant before available actions are listed or invoked
- visual perception grants before screenshots, screen streams, OCR, or vision inference are used

Focused inspection remains separate. Traversal should not be used as an implicit fallback for
`desktop.inspect.focus`; if focus is unavailable, focus inspection should fail closed with an
unavailable reason.

## Request Controls

The first traversal request should be explicit and bounded:

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

Recommended initial limits:

- default `traversal.enabled`: `false`
- maximum `max_depth`: `3`
- default `max_depth`: `1`
- maximum `max_nodes`: `128`
- default `max_nodes`: `64`
- maximum `max_children_per_node`: `16`
- default `max_children_per_node`: `8`

The helper should treat these as hard ceilings. Node may apply stricter runtime-profile or module
limits before invoking the helper.

Current implementation status: any `traversal` field on
`POST /desktop/inspect/accessibility-tree` is rejected with
`desktop_traversal_not_implemented`. This keeps the future request shape from being silently
ignored or mistaken for active traversal support. Tests cover valid-looking traversal,
non-AT-SPI traversal, unknown traversal fields, invalid roots, and excessive traversal limits; all
remain rejected until traversal request validation is implemented.

The current non-traversal request surface is explicitly validated. `mode` must be omitted,
`environment`, or `atspi`; `max_apps` must be an integer from 1 to 64; `max_children` must be an
integer from 0 to 8; unknown request fields fail before helper invocation or provenance recording.

Traversal roots should be self-scoped:

- an application root object returned by the existing tree inspection
- a focused object returned by `desktop.inspect.focus`, when the user has authorized focus
  inspection separately
- a future window root returned by `desktop.inspect.windows`

Soma should not accept an arbitrary service/path pair from a model without first tying it to a
previously disclosed object in the same session or to an explicit user selection.

See [Traversal Root Authorization](./traversal_root_authorization.md) and
[Desktop Traversal Request Validation](./desktop_traversal_request_validation.md) for the draft
mechanism: an in-process disclosure registry and future explicit user-selection path.

## Response Shape

The later schema should add a distinct traversal block rather than silently changing the existing
`child_metadata_sample` meaning:

```json
{
  "tree": {
    "applications": [
      {
        "service": ":1.42",
        "pid": 1234,
        "process": "example",
        "registry": false,
        "root_object": {
          "path": "/org/a11y/atspi/accessible/root",
          "name": "example",
          "role": "application",
          "child_count": 4,
          "children_sample": [],
          "child_metadata_sample": [],
          "traversal": {
            "root": {
              "service": ":1.42",
              "path": "/org/a11y/atspi/accessible/root"
            },
            "nodes": [
              {
                "id": "n0",
                "service": ":1.42",
                "path": "/org/a11y/atspi/accessible/root",
                "role": "application",
                "child_count": 4,
                "depth": 0,
                "children": [
                  "n1"
                ]
              }
            ],
            "limits": {
              "max_depth": 2,
              "max_nodes": 64,
              "max_children_per_node": 8
            },
            "truncated": false,
            "text_content_included": false,
            "withheld_fields": [
              "name",
              "description",
              "text",
              "states",
              "actions"
            ]
          }
        },
        "root_object_error": null
      }
    ],
    "windows": [],
    "bounded": true,
    "text_content_included": false
  }
}
```

Traversal nodes should initially include only:

- stable local node id
- service
- object path
- role
- child count
- depth
- child node ids included in this bounded response

Traversal nodes should not include object name by default. Root-object name is already present in
the existing contract and should not be generalized to every traversed child without a separate
text/disclosure grant.

## Truncation And Failure Modes

Traversal should be explicit when the result is incomplete:

- `truncated: true` when `max_depth`, `max_nodes`, or `max_children_per_node` stops traversal
- `unavailable_reason: "atspi_unavailable"` when the AT-SPI bus is unavailable
- `unavailable_reason: "root_not_disclosed"` when the requested root was not previously exposed or
  user-selected
- `unavailable_reason: "root_unavailable"` when the root cannot be queried
- `unavailable_reason: "node_query_failed"` when one or more descendants cannot be read
- `unavailable_reason: "output_limit_exceeded"` when helper output exceeds Node's accepted size
  before schema validation

Partial traversal can be useful, but partial results should not hide failures. If some nodes fail,
the response should include only bounded metadata for successful nodes and a summary count of
failed queries, not raw error payloads from applications.

## Provenance

Soma should not store the full traversal tree in provenance by default.

Traversal provenance should record:

- capability: `desktop.inspect.accessibility_tree`
- traversal requested: yes/no
- root scope type: application root, focused object, window root, or user selection
- requested limits
- returned node count
- maximum returned depth
- whether traversal was truncated
- unavailable reason when traversal fails
- broker source
- session metadata
- `text_content_included=false`

Full traversal output should be returned to the caller for the active request, but provenance
should keep summaries unless the user explicitly enables detailed local audit retention.

## Validation Requirements

Before runtime traversal is added, update the documented schema and runtime validator together.
Provider-overreach tests should reject:

- node names
- descriptions
- text content
- selected text
- values
- states
- actions
- screenshots or image references
- pointer or keyboard state
- traversal beyond requested limits
- roots that were not previously disclosed or selected

The validator must still fail closed before provenance is recorded.

Current validation status: traversal output is not yet a permitted result field. Helper output that
includes a future `traversal` block is rejected as provider overreach before provenance is
recorded. Tests also pin that traversal-shaped payloads carrying names, descriptions, text, states,
actions, screenshots, image references, pointer state, or keyboard state remain rejected while the
contract is closed.

## Schema And Validator Update Path

Traversal should not be introduced by changing the helper first. The safer order is:

1. Add request validation while keeping traversal disabled.
2. Extend the JSON schema with the future traversal definitions.
3. Extend the runtime validator to accept only the bounded traversal shape.
4. Add passing and failing validator fixtures.
5. Add provenance summary fields without storing traversal trees.
6. Implement the helper traversal path behind the already-tested contract.

### Request Validation

The endpoint should continue to reject `traversal` until the schema and runtime validator are
ready. When traversal opens, request validation should enforce:

- `mode` must be `atspi`
- `traversal.enabled` must be `true`
- `traversal.root_ref` must be present and must be a non-empty string
- raw `traversal.root.service` and `traversal.root.path` must be rejected
- root ref must match an object previously disclosed in the same session or selected by the user
- `max_depth`, `max_nodes`, and `max_children_per_node` must be positive integers
- each requested limit must be less than or equal to the active runtime-profile or module ceiling
- unknown traversal request fields must be rejected

Request rejection should happen before helper invocation and before provenance is recorded. Once
traversal is implemented, rejected requests should still produce a clear error such as
`desktop_traversal_request_invalid`, not a broad desktop probe.

### JSON Schema Additions

The later schema should add definitions equivalent to:

```json
{
  "$defs": {
    "traversal": {
      "type": "object",
      "required": [
        "root",
        "nodes",
        "limits",
        "truncated",
        "text_content_included",
        "withheld_fields"
      ],
      "additionalProperties": false
    },
    "traversal_node": {
      "type": "object",
      "required": [
        "id",
        "service",
        "path",
        "role",
        "child_count",
        "depth",
        "children"
      ],
      "additionalProperties": false
    },
    "traversal_limits": {
      "type": "object",
      "required": [
        "max_depth",
        "max_nodes",
        "max_children_per_node"
      ],
      "additionalProperties": false
    }
  }
}
```

The actual schema should also enforce:

- `text_content_included` is always `false`
- `withheld_fields` includes `name`, `description`, `text`, `states`, and `actions`
- `nodes.maxItems` does not exceed Soma's maximum accepted node count
- every node `depth` is a non-negative integer
- every node `child_count` is a non-negative integer
- every node `children` list contains only local node ids
- no traversal node fields for names, descriptions, text, values, states, actions, screenshots, or
  input state

Schema extension should not remove the existing root-object `children_sample` and
`child_metadata_sample` fields. Traversal is a new optional block, not a reinterpretation of the
existing samples.

### Runtime Validator Additions

The hand-rolled validator should add traversal-specific validation only after request validation
and tests are ready. It should check:

- `root_object.traversal` is optional
- traversal object has only known keys
- root object reference has only `service` and `path`
- limits object has only `max_depth`, `max_nodes`, and `max_children_per_node`
- returned limits do not exceed requested or profile ceilings
- node count does not exceed `max_nodes`
- maximum returned depth does not exceed `max_depth`
- each node has only `id`, `service`, `path`, `role`, `child_count`, `depth`, and `children`
- node ids are unique
- children reference only included node ids
- children per node does not exceed `max_children_per_node`
- `truncated` is boolean
- `text_content_included` is `false`
- `withheld_fields` is present and does not claim protected fields were included

The validator should keep the current fail-closed semantics:

- helper contract failures return `desktop_inspection_schema_invalid`
- the rejected helper payload is not returned
- no desktop inspection provenance entry is recorded for rejected helper output

### Migration Decision

Schema and runtime validator changes should land before helper traversal implementation. That
keeps the trust boundary stable: helpers can only return traversal after Node has already learned
how to reject malformed or over-broad traversal output.

Do not switch to a JSON Schema runtime dependency solely for traversal unless the hand-written
checks become harder to audit than the dependency boundary. Traversal adds complexity, but it is
still narrow enough for one more hand-rolled validator pass if tests cover the invariants above.

## Non-Goals

- no traversal implementation in this slice
- no new runtime response fields yet
- no text extraction
- no child names or descriptions
- no states or actions
- no screenshots, OCR, or screen capture
- no desktop actuation
- no model-selected arbitrary AT-SPI roots without user or prior-disclosure grounding

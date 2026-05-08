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
    "root": {
      "service": ":1.42",
      "path": "/org/a11y/atspi/accessible/root"
    },
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

Traversal roots should be self-scoped:

- an application root object returned by the existing tree inspection
- a focused object returned by `desktop.inspect.focus`, when the user has authorized focus
  inspection separately
- a future window root returned by `desktop.inspect.windows`

Soma should not accept an arbitrary service/path pair from a model without first tying it to a
previously disclosed object in the same session or to an explicit user selection.

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

## Non-Goals

- no traversal implementation in this slice
- no new runtime response fields yet
- no text extraction
- no child names or descriptions
- no states or actions
- no screenshots, OCR, or screen capture
- no desktop actuation
- no model-selected arbitrary AT-SPI roots without user or prior-disclosure grounding

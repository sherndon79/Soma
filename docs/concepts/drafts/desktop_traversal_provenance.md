# Desktop Traversal Provenance

Status: design draft, not implemented

Future recursive traversal can return a bounded subtree to the caller, but Soma should not store
the full traversal tree in provenance by default. Provenance should record only enough summary
metadata to audit the decision and understand the disclosure surface.

This slice does not enable traversal, add response fields, or change current provenance behavior.

## Decision

Traversal provenance should be summary-only by default.

Record:

- traversal was requested
- root authorization source
- root source event id, when available
- root source type
- requested traversal limits
- returned node count
- maximum returned depth
- whether traversal was truncated
- unavailable reason, when traversal fails
- broker source
- desktop session metadata
- `text_content_included=false`

Do not record:

- full traversal tree
- node service/path lists
- node roles per path
- child adjacency lists
- names, descriptions, text, values, states, actions, screenshots, OCR, pointer state, or keyboard
  state
- `desktop_ref_id` values unless a later audit design explicitly requires them

## Candidate Event Fields

Future event type can remain `desktop.inspect.accessibility_tree` with traversal-specific fields,
because traversal is an extension of the accessibility-tree inspection capability.

Candidate fields:

```json
{
  "event_type": "desktop.inspect.accessibility_tree",
  "capability": "desktop.inspect.accessibility_tree",
  "traversal_requested": true,
  "traversal_root_authorization": "prior_disclosure",
  "traversal_root_source_event_id": "provenance-uuid",
  "traversal_root_source_type": "application_root",
  "requested_traversal_max_depth": 2,
  "requested_traversal_max_nodes": 64,
  "requested_traversal_max_children_per_node": 8,
  "traversal_node_count": 12,
  "traversal_max_returned_depth": 2,
  "traversal_truncated": false,
  "traversal_unavailable_reason": "",
  "text_content_included": false
}
```

The provenance event should still include the existing desktop inspection summary fields such as
broker source, desktop session, session type, application counts, and tree availability.

## Failure Cases

Rejected traversal requests should not append provenance.

Helper contract failures should not append desktop inspection provenance, matching the current
provider-overreach behavior.

If traversal is authorized but unavailable at runtime, provenance may record:

- `traversal_requested=true`
- authorized root source summary
- requested limits
- `traversal_node_count=0`
- `traversal_max_returned_depth=0`
- `traversal_truncated=false`
- `traversal_unavailable_reason`

The unavailable reason should be a stable summary code, not raw helper stderr or application error
payloads.

## Detailed Audit Retention

Detailed local audit retention can be designed later as an explicit operator mode. It should be
off by default and should have separate disclosure because it would store the object graph beyond
the active request.

If detailed retention is ever added, it should be:

- local-only by default
- TTL-bound
- revocable
- clearly disclosed
- separate from normal provenance summary

## Test Plan Before Enablement

Before traversal opens:

- prove current traversal requests append no provenance
- prove current helper traversal output is rejected before provenance
- add a pure summary builder test for future traversal provenance fields
- prove the summary builder does not copy traversal nodes or node refs
- prove unavailable traversal stores only summary code and counts

## Non-Goals

- no traversal implementation in this slice
- no full traversal tree in provenance
- no durable object graph audit retention
- no new runtime response fields
- no desktop actuation


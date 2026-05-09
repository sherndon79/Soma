# Desktop Traversal Rust Implementation Plan

Status: design draft, not implemented

This document defines the smallest Rust helper units needed for future bounded AT-SPI traversal.
It does not enable `inspect-atspi-traversal`, change endpoint behavior, or change the active
desktop inspection schema.

Node remains the authority boundary. Rust receives only an already-authorized root service/path and
hard limits, then returns bounded host observations for Node to validate.

## Current Entry State

Already present:

- `inspect-atspi-traversal` command dispatch
- `TraversalArgs` parser for authorized root and limits
- typed traversal output structs and JSON assembly
- typed unavailable traversal output builder for the stable zero-node unavailable shape
- in-memory breadth-first traversal builder with fake-observation tests
- internal AT-SPI traversal query boundary helper for role, child count, and bounded child refs
- helper-side hard ceilings:
  - `MAX_TRAVERSAL_DEPTH = 4`
  - `MAX_TRAVERSAL_NODES = 256`
  - `MAX_TRAVERSAL_CHILDREN_PER_NODE = 32`
- parser tests for valid, missing, malformed, out-of-range, and unknown traversal arguments
- output-builder tests for required shape, escaping, protected-field omission, withheld fields, and
  deriving limits from validated args
- traversal algorithm tests for breadth-first ordering, depth limit, node limit, child limit,
  truncation, and child ids referencing only included nodes
- traversal observation tests for parsing role, child count, bounded child refs, and protected-field
  omission through the JSON path

Current required behavior:

- valid traversal args still return non-zero with `inspect-atspi-traversal is not implemented`
- malformed args fail before any AT-SPI query
- Node endpoint still rejects traversal requests before helper invocation
- active Node schema still rejects `root_object.traversal`

## Minimal Internal Units

Implement traversal in testable internal pieces before wiring the command to AT-SPI.

### Traversal Node Model

Implementation status: present as internal helper structs, not wired to command execution.

Internal struct:

```text
TraversalNode {
  id,
  service,
  path,
  role,
  child_count,
  depth,
  children
}
```

Rules:

- `id` is local to the response, stable only within that response, and never a Node
  `desktop_ref_id`
- `children` contains local node ids included in the same response
- no names, descriptions, text, states, actions, screenshots, image references, pointer state, or
  keyboard state

### Traversal Result Model

Implementation status: present as internal helper structs, not wired to command execution.

Internal result:

```text
TraversalResult {
  root,
  nodes,
  limits,
  truncated,
  text_content_included=false,
  withheld_fields=[name, description, text, states, actions]
}
```

Rules:

- `limits` echoes the effective helper limits
- `truncated` becomes true when depth, node count, child count, or query failure prevents complete
  traversal
- unavailable or partially unavailable states use stable reason strings, not raw application error
  payloads

### Queue Traversal

Implementation status: present as an internal in-memory builder, not wired to command execution or
live AT-SPI queries.

Use breadth-first traversal from the authorized root.

Reasons:

- naturally respects `max_depth`
- can stop as soon as `max_nodes` is reached
- keeps shallower context before deeper context when limits truncate

Required behavior:

- visit root at depth `0`
- never enqueue children when current depth equals `max_depth`
- query no more than `max_children_per_node` children from any node
- include child ids only for children that are included in `nodes`
- set `truncated=true` if additional children or deeper descendants are known but omitted by
  limits
- set `truncated=true` if a node query fails after traversal has started

### Output Assembly

Implementation status: present for typed traversal output and unavailable traversal output. It remains
disconnected from `inspect-atspi-traversal`.

Build JSON from typed values rather than string concatenation where practical. If the helper stays
dependency-free, keep one small JSON assembly function and test escaping on every string field that
can originate outside Soma.

Output must be accepted by the future Node traversal validator and rejected by the current default
Node validator until activation.

## AT-SPI Query Boundary

Implementation status: present as an internal helper, not wired to command execution.

Keep D-Bus interaction isolated behind a small query function:

```text
query_accessible_node(address, service, path) -> NodeObservation
```

Candidate observation fields:

- role
- child count
- bounded child object references

The query function must not read:

- `Name`
- `Description`
- text interfaces
- state sets
- action interfaces
- screenshots or visual surfaces
- input state

This makes protected-field omission a query-level invariant, not just an output-filtering step.

The live wrapper is intentionally marked unused until activation because `inspect-atspi-traversal`
must continue returning not implemented. Tests exercise the parser/assembly path with fake command
output and keep protected fields out of the traversal JSON path.

## Failure Behavior

Argument failures:

- stderr diagnostic
- exit code `2`
- no JSON output
- no AT-SPI query

Environment failures before root query:

- valid unavailable result is preferred once the active schema can represent traversal unavailable
  states
- until then, keep the command unimplemented rather than returning a shape Node cannot accept

Mid-traversal failures:

- omit the failed node details
- keep already-collected bounded nodes
- mark `truncated=true`
- use a stable summary reason if the future output shape adds one
- do not include raw D-Bus errors in public JSON

## Rust Test Matrix

Add tests before command activation:

- output builder emits required traversal fields
- output builder emits `text_content_included=false`
- output builder emits required `withheld_fields`
- output builder omits protected fields
- unavailable output builder emits zero nodes and a stable unavailable reason
- unavailable output builder omits protected fields
- breadth-first traversal respects `max_depth`
- traversal stops at `max_nodes`
- traversal limits children per node to `max_children_per_node`
- truncation is true when depth limit omits descendants
- truncation is true when node limit omits queued nodes
- truncation is true when child limit omits sibling children
- child ids reference only included node ids
- query failures after root produce truncated bounded output without raw errors
- valid args still leave command disabled until Node activation gates are ready

Use fake in-memory node observations for traversal algorithm tests. Do not require a live AT-SPI
bus for unit tests.

## Activation Rule

Do not make `inspect-atspi-traversal` execute traversal until:

- active Node schema accepts traversal output
- active Node runtime validator accepts traversal output
- endpoint request validation and `root_ref` authorization are wired
- helper output is validated before response and provenance
- summary-only traversal provenance is wired

Until those gates are complete, implementation work should stay in internal functions or test-only
paths that cannot be invoked through the public helper command.

## Non-Goals

- no endpoint behavior change
- no active schema change
- no model-selected arbitrary service/path roots
- no child names, descriptions, text, values, states, actions, screenshots, or actuation
- no long-lived helper process

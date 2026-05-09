# Desktop Traversal Helper Contract

Status: design draft, not implemented

This draft defines the future Rust helper command shape for recursive AT-SPI traversal. It does
not implement traversal, change runtime responses, or enable traversal requests.

Node remains the trust boundary. The helper receives only an already-authorized root object
reference and bounded limits. The helper does not decide whether traversal is allowed.

## Command Shape

Future one-shot command:

```text
soma-desktop-broker inspect-atspi-traversal \
  --root-service :1.42 \
  --root-path /org/a11y/atspi/accessible/root \
  --max-depth 2 \
  --max-nodes 64 \
  --max-children-per-node 8
```

Node should derive `--root-service` and `--root-path` only after `root_ref` has resolved through
the disclosure registry or explicit user-selection store.

The helper should not accept `root_ref`; that is a Node-local authorization id. The helper should
only receive the concrete AT-SPI object reference after Node authorization succeeds.

## Helper Argument Validation

The helper should reject malformed traversal arguments before AT-SPI queries:

- missing `--root-service`
- missing `--root-path`
- missing, malformed, or out-of-range `--max-depth`
- missing, malformed, or out-of-range `--max-nodes`
- missing, malformed, or out-of-range `--max-children-per-node`
- unknown flags

Initial helper hard ranges should match or be narrower than Node:

- `--max-depth`: `1..4`
- `--max-nodes`: `1..256`
- `--max-children-per-node`: `1..32`

Node should still validate helper output after execution. Helper-side limits are cost controls,
not authority.

## Output Shape

The helper should return one JSON object to stdout. A future traversal response should be embedded
under the existing AT-SPI inspection result shape only after Node's schema accepts traversal.

Candidate traversal block:

```json
{
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
      "child_count": 2,
      "depth": 0,
      "children": ["n1", "n2"]
    }
  ],
  "limits": {
    "max_depth": 2,
    "max_nodes": 64,
    "max_children_per_node": 8
  },
  "truncated": false,
  "text_content_included": false,
  "withheld_fields": ["name", "description", "text", "states", "actions"]
}
```

Node should be responsible for deciding where this block appears in the public response. The
helper should not add `desktop_ref_id` fields; those are Node-owned registry ids.

## Omission Rules

Traversal helper output must omit:

- names
- descriptions
- text content
- values
- states
- actions
- screenshots
- OCR
- pointer state
- keyboard state
- focus state unless a separate focused-inspection capability already authorized it
- desktop actuation data

Traversal nodes should include only:

- local node id
- AT-SPI service
- AT-SPI path
- role
- child count
- depth
- child node ids included in the bounded traversal result

## Error Behavior

For malformed command-line arguments, the helper should:

- write a concise diagnostic to stderr
- exit non-zero before AT-SPI queries
- avoid writing partial JSON traversal output

For AT-SPI failures after argument validation, the helper should prefer a valid unavailable result
or a valid partial traversal result with `truncated: true` and an unavailable reason, depending on
the failure scope. Node should still reject any payload that violates the runtime schema.

If some child nodes fail during traversal, the helper may omit those child nodes and mark the
result truncated. It should not silently include unbounded fallback data.

## Validation Order

Intended future flow:

```text
API request
  -> capability check
  -> traversal request validation
  -> root_ref authorization in Node
  -> derive helper root and limit args
  -> invoke inspect-atspi-traversal
  -> runtime schema validation of helper output
  -> Node-side final narrowing
  -> provenance summary
  -> response
```

Do not invoke the traversal helper before `root_ref` authorization succeeds.

## Transport

Keep one-shot stdio for the first traversal helper. Recursive traversal alone does not require a
long-lived helper if the traversal can complete inside one bounded request.

Revisit JSON-RPC or a Unix socket only if traversal needs shared state, streaming, cancellation, or
multiple related calls with one live D-Bus connection.

## Test Plan Before Implementation

Before helper traversal is implemented:

- add Node argument derivation tests for authorized traversal helper args - covered by
  `test/desktopBroker.test.js`
- add Rust argument parser tests for valid traversal flags - covered by
  `crates/soma-desktop-broker/src/main.rs`
- add Rust parser rejection tests for missing, unknown, malformed, and out-of-range flags - covered
  by `crates/soma-desktop-broker/src/main.rs`
- add schema tests for accepted traversal output only after Node schema expands
- add provider-overreach tests for traversal nodes containing names, text, states, actions,
  screenshots, pointer state, or keyboard state
- keep endpoint tests proving traversal requests do not invoke helpers until traversal is enabled

## Non-Goals

- no traversal helper implementation in this slice
- no public traversal endpoint behavior change
- no `desktop_ref_id` helper output
- no text/name/action/screenshot exposure
- no desktop actuation

# Desktop Request Contract Baseline

Status: current pre-traversal baseline

This document summarizes the current desktop inspection request and validation contract before
recursive traversal is implemented. It is meant to be a checklist for future desktop work: new
request shapes should extend this contract deliberately rather than widening it accidentally.

## Accessibility Tree Request

Endpoint:

```text
POST /desktop/inspect/accessibility-tree
```

Accepted request fields:

- `mode`: optional; must be `environment` or `atspi`
- `max_apps`: optional; integer from 1 to 64
- `max_children`: optional; integer from 0 to 8
- `traversal`: currently recognized only to reject with `desktop_traversal_not_implemented`

Rejected request fields:

- any unknown field other than the currently closed `traversal` placeholder
- `mode` values other than `environment` or `atspi`
- non-integer or out-of-range `max_apps`
- non-integer or out-of-range `max_children`

Invalid tree-inspection requests fail before helper invocation and before desktop inspection
provenance is recorded. Generic request-shape failures return
`desktop_inspection_request_invalid`. Traversal requests return
`desktop_traversal_not_implemented` until a traversal validator and schema are in place.

Current output remains bounded:

- environment metadata by default
- bounded AT-SPI participant, application-root, and shallow child role/count metadata when
  `mode=atspi`
- no recursive traversal
- no child names or descriptions
- no text content
- no state lists
- no action lists
- no screenshots, OCR, pointer state, keyboard state, or actuation

## Focus Request

Endpoint:

```text
POST /desktop/inspect/focus
```

Accepted request fields:

- `include_text`: optional; currently only `false` is accepted

Rejected request fields:

- unknown fields
- non-boolean `include_text`
- `include_text=true`

Malformed focus requests fail with `focused_desktop_inspection_request_invalid` before helper
invocation and before focused inspection provenance is recorded. `include_text=true` fails with
`focused_desktop_text_not_allowed` until a separate text-capable focus contract exists.

Current focus output remains bounded:

- focus availability
- focused object service/path
- focused object role
- focused object child count
- focused application/root reference when available
- withheld-field markers
- no names, descriptions, text, states, actions, screenshots, OCR, pointer state, keyboard state,
  or actuation

## CLI Boundary

The CLI performs local validation for desktop inspect flags so malformed values are not silently
omitted before reaching the service:

- `soma desktop inspect --mode` must be `environment` or `atspi`
- `--max-apps` must be an integer from 1 to 64
- `--max-children` must be an integer from 0 to 8

The service remains the authoritative boundary. CLI validation is ergonomic protection, not a
substitute for API validation.

`soma desktop focus --include-text` is intentionally sent to the service so the text-capable focus
refusal remains explicit.

## Test Coverage Map

Server request validation:

- `test/app.test.js`: invalid tree-inspection request fields fail with
  `desktop_inspection_request_invalid`
- `test/app.test.js`: traversal request shapes fail with `desktop_traversal_not_implemented`
- `test/app.test.js`: invalid focused-inspection request fields fail with
  `focused_desktop_inspection_request_invalid`
- `test/app.test.js`: `include_text=true` fails with `focused_desktop_text_not_allowed`
- `test/app.test.js`: invalid tree and focus requests do not create desktop provenance

Provider output validation:

- `test/schema.test.js`: current AT-SPI shape is accepted
- `test/schema.test.js`: child metadata over-disclosure is rejected
- `test/schema.test.js`: window output is rejected until `desktop.inspect.windows` exists
- `test/schema.test.js`: traversal output is rejected until traversal exists
- `test/schema.test.js`: traversal-shaped over-disclosure remains rejected while traversal is
  closed
- `test/app.test.js`: rejected helper output is not returned and does not create desktop
  provenance
- `test/app.test.js`: focused helper over-disclosure is rejected

CLI validation:

- `test/cli.test.js`: valid desktop inspect flags produce the expected request body
- `test/cli.test.js`: invalid desktop inspect flags fail before any request is sent
- `test/cli.test.js`: `desktop focus --include-text` is routed to the service

## Remaining Ambiguity

The main unresolved request-shape question is root authorization for recursive traversal. The
future traversal request must define how a traversal root is proven to be previously disclosed in
the same session or explicitly selected by the user. Until that exists, traversal should remain
closed at both request and output validation boundaries.

The current `max_apps` and `max_children` fields narrow returned output after helper output has
passed validation. Future helper-side limit passing is documented separately as an optimization
hint; it must not replace provider-output validation or Node-side final narrowing.

## Non-Goals

- no traversal implementation
- no focused text implementation
- no new runtime response fields
- no change to provider-output schemas
- no screenshots, OCR, input state, or actuation

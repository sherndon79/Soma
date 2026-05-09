# Desktop Traversal Enablement Sequence

Status: design draft, not implemented

This document orders the remaining work required before recursive AT-SPI traversal can replace
the current `desktop_traversal_not_implemented` guard.

The current runtime must remain closed until these gates land in order.

## Current Disabled Scaffolds

Existing pieces that are present but not active:

- `src/desktopTraversalRequest.js`: future request-shape and `root_ref` authorization validator
- `src/desktopTraversalOutput.js`: future traversal output validator
- `src/desktopTraversalProvenance.js`: future summary-only provenance builder
- `desktopTraversalHelperArgs` in `src/desktopBroker.js`: future helper argument derivation
- `inspect-atspi-traversal` Rust parser: future helper command parser that currently fails closed
- future fixtures in `docs/fixtures/`

Current active guards that must remain until the activation sequence reaches them:

- `rejectUnsupportedDesktopTraversal` rejects any `traversal` request before helper invocation
- `ROOT_OBJECT_KEYS` excludes `traversal`
- current schema excludes traversal output
- current provenance does not include traversal fields

## Activation Order

### 1. Schema And Runtime Output Gate

Activate traversal output validation before any helper can return traversal successfully.

Changes:

- extend `docs/schemas/desktop-inspection-result.schema.json`
- extend `ROOT_OBJECT_KEYS` to allow `traversal`
- wire `validateFutureDesktopTraversalOutput` into `validateRootObject`
- keep protected fields rejected

Required tests:

- valid future traversal fixture passes the traversal validator and full desktop inspection
  validator
- duplicate node ids are rejected
- child refs to missing nodes are rejected
- returned depth beyond limit is rejected
- node count beyond limit is rejected
- children per node beyond limit is rejected
- protected fields are rejected
- `text_content_included=true` is rejected
- helper overreach still returns `desktop_inspection_schema_invalid`
- rejected helper traversal output still writes no provenance

Do not remove endpoint traversal refusal in this step.

### 2. Helper Implementation Gate

Implement bounded Rust helper traversal behind the already-parsed `inspect-atspi-traversal`
command.

Changes:

- traverse only from the authorized root service/path supplied by Node
- enforce max depth, max nodes, and max children per node
- emit only the accepted traversal output shape
- omit names, descriptions, text, states, actions, screenshots, pointer state, and keyboard state
- return stable unavailable/truncated summaries instead of raw application errors

Required tests:

- Rust parser tests continue to pass
- Rust traversal output omits protected fields
- Rust traversal respects depth, node, and child limits
- Rust traversal marks truncation when limits stop traversal
- malformed helper args fail before AT-SPI queries

Do not wire Node endpoint to call it yet.

### 3. Node Helper Invocation Gate

Wire authorized traversal requests to helper args without exposing new request behavior yet.

Changes:

- use `desktopTraversalHelperArgs` with authorized root service/path
- keep helper output flowing through schema/runtime validation
- keep endpoint refusal in place or place invocation behind an internal test-only path

Required tests:

- Node derives traversal helper args from authorized root and limits
- no raw `root_ref` is passed to Rust
- no helper invocation happens for unauthorized roots
- helper output is validated before response/provenance

### 4. Provenance Gate

Wire summary-only traversal provenance after output validation succeeds.

Changes:

- use `createFutureTraversalProvenanceSummary`
- append only summary fields
- do not store traversal nodes, service/path lists, roles, or child edges

Required tests:

- successful traversal provenance includes root source, limits, counts, depth, truncation, and
  `text_content_included=false`
- provenance omits traversal tree, node ids, service/path lists, roles, child edges, and protected
  fields
- unavailable traversal stores only a stable unavailable reason and zero counts
- rejected traversal request writes no provenance
- schema-rejected traversal helper output writes no provenance

### 5. Request Enablement Gate

Only after the previous gates pass should the endpoint hard refusal be replaced.

Changes:

- replace `rejectUnsupportedDesktopTraversal` with `validateFutureDesktopTraversalRequest`
- accept `root_ref` only
- resolve root through disclosure registry or explicit user-selection store
- reject raw service/path traversal roots
- invoke helper only after authorization succeeds
- return traversal output only after schema validation succeeds

Required tests:

- `root_ref` traversal succeeds only when the root was previously disclosed
- unknown roots fail with `desktop_traversal_root_not_disclosed`
- expired roots fail with `desktop_traversal_root_expired`
- revoked roots fail with `desktop_traversal_root_revoked`
- inactive capability roots fail with `desktop_traversal_root_capability_inactive`
- raw service/path roots fail with `desktop_traversal_request_invalid`
- invalid limits fail before helper invocation
- focus failure does not broaden into traversal
- module narrowing revokes roots and blocks traversal

## Non-Goals

- no traversal implementation in this slice
- no response schema change in this slice
- no endpoint behavior change in this slice
- no helper traversal execution in this slice
- no text/name/action/screenshot exposure
- no desktop actuation


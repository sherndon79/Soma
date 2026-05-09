# Desktop Traversal Enablement Sequence

Status: design draft, partially scaffolded

This document orders the remaining work required before recursive AT-SPI traversal can replace
the current `desktop_traversal_not_implemented` guard.

The current runtime must remain closed until these gates land in order.

## Current Disabled Scaffolds

Existing pieces that are present but not active:

- `src/desktopTraversalRequest.js`: future request-shape and `root_ref` authorization validator
- `src/desktopTraversalOutput.js`: future traversal output validator
- `validateFutureDesktopInspectionResultWithTraversal` in `src/desktopInspectionSchema.js`:
  disabled traversal-aware full inspection validator gate
- `docs/schemas/future-desktop-inspection-result-with-traversal.schema.json`: future full
  inspection schema draft
- `src/desktopTraversalProvenance.js`: future summary-only provenance builder
  and validated summary adapter
- `desktopTraversalHelperArgs` in `src/desktopBroker.js`: future helper argument derivation
- `inspectDesktopTraversalWithRustHelper` in `src/desktopBroker.js`: internal helper invocation and
  future traversal-output validation path, not called by the public endpoint
- `inspect-atspi-traversal` Rust parser: future helper command parser that currently fails closed
- `docs/concepts/drafts/desktop_traversal_schema_activation_decision.md`: traversal-specific
  schema/runtime activation decision
- `docs/reviews/2026-05-09_traversal_activation_gates_review.md`: activation-gate review before
  replacing `desktop_traversal_not_implemented`
- `docs/concepts/drafts/desktop_traversal_rust_implementation_plan.md`: Rust internal unit and
  test-matrix plan
- internal Rust traversal output structs and JSON builder tests
- internal Rust in-memory traversal builder and fake-observation limit tests
- internal Rust traversal query boundary helper for role, child count, and bounded child refs
- private Rust traversal bridge from validated args to bounded traversal assembly and the live
  AT-SPI query boundary
- command-level Rust integration test proving `inspect-atspi-traversal` still returns not implemented
  with valid-looking traversal args and emits no traversal JSON
- future fixtures in `docs/fixtures/`

Current active guards that must remain until the activation sequence reaches them:

- `rejectUnsupportedDesktopTraversal` rejects any `traversal` request before helper invocation
- `ROOT_OBJECT_KEYS` excludes `traversal`
- current schema excludes traversal output
- `validateDesktopInspectionResult` still rejects traversal output by default
- current provenance does not include traversal fields

## Activation Order

### 1. Schema And Runtime Output Gate

Activate traversal output validation before any helper can return traversal successfully.

Runtime scaffold status:

- opt-in full inspection validation is available through
  `validateFutureDesktopInspectionResultWithTraversal`
- a separate future full inspection schema draft documents the bounded traversal response shape
- endpoint/provider-overreach tests reject traversal-shaped helper output before disclosure registry
  writes or provenance append
- default runtime validation remains unchanged and still rejects `root_object.traversal`
- the active JSON schema remains unchanged and still excludes traversal
- focused future-validator tests pin node count, depth, child refs, children-per-node limits,
  protected fields, withheld fields, and `text_content_included=false`
- schema activation decision keeps traversal on a traversal-authorized validation path rather than
  making the default desktop inspection validator accept traversal output

Remaining changes before activation:

- promote the future traversal schema to an active traversal-specific schema when request
  authorization, helper execution, output validation, and provenance are ready
- keep `validateDesktopInspectionResult` closed by default; allow traversal output only on the
  traversal-authorized runtime path
- keep protected fields rejected

Required tests:

- valid future traversal fixture passes the traversal validator and full desktop inspection
  validator
- duplicate node ids are rejected
- child refs to missing nodes are rejected
- returned depth beyond limit is rejected
- node count beyond limit is rejected - covered by `test/desktopTraversalOutput.test.js`
- children per node beyond limit is rejected - covered by `test/desktopTraversalOutput.test.js`
- protected fields are rejected
- `text_content_included=true` is rejected - covered by `test/desktopTraversalOutput.test.js`
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

Implementation should first land pure Rust traversal/output units with fake in-memory observations.
The public `inspect-atspi-traversal` command should keep returning not implemented until Node is
ready to authorize requests and validate output on the active path.

Current scaffold status: the private Rust bridge can build traversal from validated args and the
live AT-SPI query boundary, but the public command still returns not implemented.

Required tests:

- Rust parser tests continue to pass
- Rust traversal output omits protected fields
- Rust traversal respects depth, node, and child limits
- Rust traversal marks truncation when limits stop traversal
- malformed helper args fail before AT-SPI queries
- public `inspect-atspi-traversal` still returns not implemented and emits no traversal JSON

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
- helper output is validated before response/provenance - covered by `test/desktopBroker.test.js`

### 4. Provenance Gate

Wire summary-only traversal provenance after output validation succeeds.

Changes:

- use `createFutureTraversalProvenanceSummary`
- use `createValidatedFutureTraversalProvenanceSummary` or equivalent after helper output validation
- append only summary fields
- do not store traversal nodes, service/path lists, roles, or child edges

Required tests:

- successful traversal provenance includes root source, limits, counts, depth, truncation, and
  `text_content_included=false`
- provenance omits traversal tree, node ids, service/path lists, roles, child edges, and protected
  fields
- unavailable traversal stores only a stable unavailable reason and zero counts
- rejected traversal request writes no provenance
- schema-rejected traversal helper output writes no provenance - covered by current endpoint
  no-provenance tests and future adapter validation tests

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

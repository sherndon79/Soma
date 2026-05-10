# Desktop Traversal Enablement Sequence

Status: design draft, endpoint activated

This document records the ordered gates used to activate recursive AT-SPI traversal at the public
Node endpoint.

The default runtime remains traversal-closed; traversal output is accepted only on the explicit
traversal-authorized endpoint path.

## Current Traversal Components

Existing pieces that are active or retained as historical migration context:

- `src/desktopTraversalRequest.js`: request-shape and `root_ref` authorization validator
- `src/desktopTraversalOutput.js`: traversal output validator
- `validateFutureDesktopInspectionResultWithTraversal` in `src/desktopInspectionSchema.js`:
  compatibility delegate to the traversal-authorized validator
- `validateTraversalAuthorizedDesktopInspectionResult` and
  `assertTraversalAuthorizedDesktopInspectionResult` in `src/desktopInspectionSchema.js`: stable
  traversal-authorized runtime validation path
- `docs/schemas/desktop-inspection-result-with-traversal.schema.json`: traversal-specific schema
  artifact for authorized traversal output; not the default broker output contract
- `docs/schemas/future-desktop-inspection-result-with-traversal.schema.json`: future full
  inspection schema draft retained as historical migration context
- `src/desktopTraversalProvenance.js`: summary-only provenance builder
  and validated summary adapter
- `desktopTraversalHelperArgs` in `src/desktopBroker.js`: helper argument derivation
- `inspectDesktopTraversalWithRustHelper` in `src/desktopBroker.js`: internal helper invocation and
  traversal-output validation path
- `attachTraversalToDesktopInspectionResult` in `src/desktopBroker.js`: internal adapter that attaches
  validated traversal output to a matching root object through the traversal-authorized runtime
  assertion
- `runInternalDesktopTraversalRequest` in `src/desktopTraversalPipeline.js`: internal orchestration
  seam that composes root-ref validation, disclosure-registry authorization, helper invocation,
  traversal attachment, and validated summary provenance for the public endpoint traversal path
- `inspect-atspi-traversal` Rust parser and bounded helper command
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
- internal Rust unavailable traversal output builder for the stable zero-node unavailable shape
- command-level Rust integration tests proving `inspect-atspi-traversal` emits bounded success and
  unavailable output while malformed args still emit no stdout
- endpoint activation fixtures in `docs/fixtures/`
- Rust-shaped traversal helper output contract fixtures in `docs/fixtures/`

Current active guards:

- `ROOT_OBJECT_KEYS` excludes `traversal`
- current schema excludes traversal output
- `validateDesktopInspectionResult` still rejects traversal output by default
- traversal responses use the traversal-authorized schema path
- traversal provenance stores summary fields only

## Activation Order

### 1. Schema And Runtime Output Gate

Activate traversal output validation before any helper can return traversal successfully.

Runtime scaffold status:

- opt-in full inspection validation is available through
  `validateFutureDesktopInspectionResultWithTraversal` as a compatibility delegate
- stable traversal-authorized validation is available through
  `validateTraversalAuthorizedDesktopInspectionResult` and
  `assertTraversalAuthorizedDesktopInspectionResult`
- a separate future full inspection schema draft documents the bounded traversal response shape
- a traversal-specific schema artifact exists under a non-future name while the default schema still
  excludes traversal output
- endpoint/provider-overreach tests reject traversal-shaped helper output before disclosure registry
  writes or provenance append
- default runtime validation remains unchanged and still rejects `root_object.traversal`
- the active JSON schema remains unchanged and still excludes traversal
- focused future-validator tests pin node count, depth, child refs, children-per-node limits,
  protected fields, withheld fields, and `text_content_included=false`
- unavailable traversal output has a stable zero-node shape with `unavailable_reason` and summary-only
  provenance coverage
- schema activation decision keeps traversal on a traversal-authorized validation path rather than
  making the default desktop inspection validator accept traversal output

Remaining changes before activation:

- keep the traversal-specific schema aligned with the traversal-authorized runtime validator
- keep `validateDesktopInspectionResult` closed by default; allow traversal output only on the
  traversal-authorized runtime path
- keep protected fields rejected

Required tests:

- historical future traversal fixture passes the traversal validator and full desktop inspection
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
The public `inspect-atspi-traversal` command is active and emits bounded traversal output from
validated concrete root arguments. Node still owns authorization and must only pass concrete
service/path values after resolving a disclosed `root_ref`.

Current scaffold status: the private Rust bridge can build traversal from validated args and the
live AT-SPI query boundary. The public command has deterministic fake-`busctl` coverage for success
and unavailable stdout shapes.
The planned public command-dispatch integration harness uses a fake `busctl` executable earlier in
`PATH` so the real helper binary can be tested without a live AT-SPI session.

See [Desktop Traversal Command Activation Harness](./desktop_traversal_command_activation_harness.md)
for the fake-`busctl` contract and activation test sequence.

Current integration status: the fake-`busctl` helper exists in
`crates/soma-desktop-broker/tests/traversal_command.rs`, and public command tests prove success,
unavailable, and malformed-argument behavior without a live AT-SPI session.

Required tests:

- Rust parser tests continue to pass
- Rust traversal output omits protected fields
- Rust traversal respects depth, node, and child limits
- Rust traversal marks truncation when limits stop traversal
- Rust unavailable traversal output emits zero nodes, a stable unavailable reason, and no protected
  fields
- future command-output seam emits successful traversal stdout from injected providers
- future command-output seam emits unavailable traversal stdout when AT-SPI bus address lookup is
  unavailable
- malformed helper args fail before AT-SPI queries
- public `inspect-atspi-traversal` emits bounded success/unavailable traversal JSON for valid args
  and emits no stdout for malformed args

Do not wire Node endpoint to call it yet.

### 3. Node Helper Invocation Gate

Wire authorized traversal requests to helper args without exposing new request behavior yet.

Changes:

- use `desktopTraversalHelperArgs` with authorized root service/path
- keep helper output flowing through schema/runtime validation
- route public endpoint traversal through the internal pipeline only after request validation and
  disclosure-registry authorization

Required tests:

- Node derives traversal helper args from authorized root and limits
- no raw `root_ref` is passed to Rust
- no helper invocation happens for unauthorized roots
- helper output is validated before response/provenance - covered by `test/desktopBroker.test.js`
- Rust-shaped successful and unavailable helper output fixtures validate through Node traversal output
  validation - covered by `test/desktopTraversalOutput.test.js`
- traversal-bearing desktop inspection output uses the traversal-authorized runtime assertion while
  the default assertion remains closed - covered by `test/desktopBroker.test.js`
- internal traversal request pipeline composes authorization and helper invocation - covered by
  `test/desktopTraversalPipeline.test.js`

### 4. Provenance Gate

Wire summary-only traversal provenance after output validation succeeds.

Changes:

- use `createTraversalProvenanceSummary`
- use `createValidatedTraversalProvenanceSummary` or equivalent after helper output validation
- append only summary fields
- do not store traversal nodes, service/path lists, roles, or child edges

Required tests:

- successful traversal provenance includes root source, limits, counts, depth, truncation, and
  `text_content_included=false` - covered by `test/desktopTraversalPipeline.test.js` and
  `test/desktopTraversalProvenance.test.js`
- provenance omits traversal tree, node ids, service/path lists, roles, child edges, and protected
  fields
- unavailable traversal stores only a stable unavailable reason and zero counts - covered by
  `test/desktopTraversalPipeline.test.js` and `test/desktopTraversalProvenance.test.js`
- rejected traversal request writes no provenance
- schema-rejected traversal helper output writes no provenance - covered by current endpoint
  no-provenance tests and future adapter validation tests
- helper-output validation failure writes no internal traversal provenance - covered by
  `test/desktopTraversalPipeline.test.js`

## Activation Checklist

The endpoint activation keeps all of these true:

- active traversal-specific schema exists and is tested
- default schema and default runtime validator still reject traversal
- traversal-authorized runtime validator is named and tested
- request validation rejects raw service/path roots
- root authorization resolves through the disclosure registry before helper invocation
- Node helper invocation receives only authorized service/path plus bounded limits
- Rust command activation keeps protected fields omitted at query and output boundaries
- helper output validation runs before response and provenance
- traversal provenance stores summary fields only
- rejected traversal requests and rejected helper output append no provenance
- module narrowing still revokes roots and blocks traversal

See [Desktop Traversal Endpoint Enablement Readiness](./desktop_traversal_endpoint_enablement_readiness.md)
for the endpoint-level coverage map.

### 5. Request Enablement Gate

The endpoint hard refusal has been replaced after the previous gates landed.

Changes:

- replace `rejectUnsupportedDesktopTraversal` with `validateDesktopTraversalRequest`
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

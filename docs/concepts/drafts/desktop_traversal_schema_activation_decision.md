# Desktop Traversal Schema Activation Decision

Status: design decision, not implemented

This records how bounded recursive AT-SPI traversal output should become active when traversal is
ready. This slice does not change runtime behavior, active schemas, helper execution, endpoint
behavior, or provenance.

## Decision

Traversal output should enter through a traversal-authorized schema and runtime validation path,
not by making `validateDesktopInspectionResult` accept traversal by default.

The current default desktop inspection result remains the non-traversal contract:

- `docs/schemas/desktop-inspection-result.schema.json`
- `validateDesktopInspectionResult`
- `assertDesktopInspectionResult`

The traversal-aware contract remains separate until activation:

- `docs/schemas/future-desktop-inspection-result-with-traversal.schema.json`
- `validateFutureDesktopInspectionResultWithTraversal`
- `validateFutureDesktopTraversalOutput`

When traversal activates, promote the future schema to an active traversal-specific schema name
rather than replacing the baseline schema outright. The likely active name is:

```text
docs/schemas/desktop-inspection-result-with-traversal.schema.json
```

The future-prefixed draft can then be retired or left as historical migration context.

## Rationale

Traversal is an extension of desktop accessibility-tree inspection, but it is not safe as a
default result shape. A helper that returns `root_object.traversal` during an ordinary shallow
inspection is over-returning data. Even if the traversal shape is bounded and protected fields are
omitted, accepting it by default would weaken the current provider-overreach guard.

The runtime switch should therefore be request-aware:

```text
ordinary inspection request
  -> validateDesktopInspectionResult
  -> traversal output rejected

authorized traversal request
  -> validate traversal request and root_ref authorization
  -> invoke bounded traversal helper
  -> validateDesktopInspectionResult with allowTraversalOutput=true
  -> append summary-only traversal provenance
```

The default validator should keep rejecting traversal unless the caller has already proven that the
request was traversal-shaped, capability-authorized, root-authorized, and routed through the
traversal execution path.

## Runtime Switch Point

The switch point is not schema publication by itself. The runtime switch happens only when all of
these are true in the same activation sequence:

1. The active traversal-specific schema exists and matches the runtime traversal validator.
2. The endpoint has replaced `rejectUnsupportedDesktopTraversal` with request validation.
3. The request validator accepts only `root_ref` traversal roots and rejects raw service/path roots.
4. The disclosure registry authorizes the root before helper invocation.
5. Node derives helper args from the authorized root and bounded request limits.
6. Helper output is validated with traversal output explicitly allowed.
7. Summary-only traversal provenance is appended only after output validation succeeds.

Until those conditions are met, `validateDesktopInspectionResult` remains closed and
`assertDesktopInspectionResult` continues to reject `root_object.traversal`.

## Non-Goals

- no traversal activation in this slice
- no replacement of the active baseline schema in this slice
- no change to `validateDesktopInspectionResult` default behavior
- no helper traversal execution
- no endpoint behavior change
- no traversal provenance activation
- no text, names, descriptions, states, actions, screenshots, pointer state, keyboard state, or
  desktop actuation


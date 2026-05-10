# Desktop Traversal Endpoint Enablement Readiness

Status: design draft, endpoint still refused

This checklist defines what must be true before `/desktop/inspect/accessibility-tree` replaces
`desktop_traversal_not_implemented` with the active traversal path. The Rust
`inspect-atspi-traversal` helper command is active, but the public Node endpoint must remain refused
until endpoint-level authorization, validation, provenance, and narrowing behavior are tested.

## Current State

Implemented and tested internally:

- traversal request validator accepts `root_ref` only
- traversal request validator rejects raw service/path roots
- traversal request validator maps root authorization failures to stable errors
- internal traversal pipeline authorizes the root before helper invocation
- internal traversal pipeline validates helper output before response attachment
- internal traversal pipeline writes no provenance for unauthorized roots
- internal traversal pipeline writes no provenance for invalid helper output
- internal traversal pipeline appends summary-only provenance for successful traversal
- internal traversal pipeline appends summary-only provenance for unavailable traversal
- default desktop inspection validator remains closed to traversal-bearing output
- traversal-authorized validator path exists for the explicit traversal response path
- Rust helper command emits bounded success/unavailable traversal output
- endpoint activation case fixture exists for future success, unavailable, authorization failure,
  request-validation failure, helper-output failure, and narrowing/revocation paths

Still active at the public endpoint:

- any request with `body.traversal` returns `desktop_traversal_not_implemented`
- traversal requests fail before helper invocation
- traversal requests fail before root authorization
- traversal requests fail before disclosure registry mutation
- traversal requests append no provenance
- endpoint activation case fixture currently verifies hard refusal for every future activation case

## Endpoint Tests Required Before Enablement

### Success path

Add endpoint coverage proving:

- `root_ref` traversal succeeds only when `desktopDisclosureRegistry.authorizeRootRef` returns an
  active disclosed root
- the endpoint invokes traversal only after an ordinary AT-SPI inspection succeeds
- the helper receives only authorized `service`, `path`, and bounded limits
- no raw `root_ref` is passed to Rust
- the response uses the traversal-authorized runtime assertion
- the default desktop inspection validator still rejects traversal-bearing output outside this path
- response provenance is appended only after helper output validation and traversal attachment
- success provenance stores summary fields only

### Unavailable path

Add endpoint coverage proving:

- valid authorized traversal can return the stable unavailable traversal object
- response includes unavailable traversal only after validation succeeds
- provenance records zero traversal nodes and the stable unavailable reason
- provenance does not copy service/path, node ids, roles, or child edges

### Authorization failure path

Add endpoint coverage for each registry failure:

- `desktop_traversal_root_not_disclosed`
- `desktop_traversal_root_expired`
- `desktop_traversal_root_revoked`
- `desktop_traversal_root_capability_inactive`

Each failure must prove:

- helper is not invoked
- disclosure registry writes do not happen
- traversal provenance is not appended
- response status remains `403`

### Helper-output failure path

Add endpoint coverage proving:

- schema-invalid helper output fails before response attachment
- schema-invalid helper output appends no traversal provenance
- protected helper output fields fail closed before provenance append

### Narrowing and revocation path

Add endpoint or integration coverage proving:

- module narrowing revokes disclosed traversal roots
- traversal with a revoked root fails before helper invocation
- traversal with a capability-inactive root fails before helper invocation
- no provenance is appended for these denied traversal attempts

## Existing Coverage Map

Already covered internally:

- `test/desktopTraversalRequest.test.js`
  - root-ref-only request validation
  - raw root rejection
  - stable root authorization errors
- `test/desktopTraversalPipeline.test.js`
  - authorization before helper invocation
  - helper output validation before provenance append
  - success summary-only provenance
  - unavailable summary-only provenance
- `test/desktopBroker.test.js`
  - helper argument derivation
  - helper output validation
  - traversal-authorized assertion path
- `test/app.test.js`
  - current endpoint hard refusal
  - no helper invocation while refused
  - no authorization or registry writes while refused
  - no provenance while refused
- `docs/fixtures/desktop-traversal-endpoint-activation-cases.json`
  - future endpoint success/unavailable/authorization-failure/request-validation/helper-output-failure/
    narrowing-revocation cases
  - currently asserted as hard-refused by `test/app.test.js`

Still needs public endpoint coverage:

- successful traversal response from the endpoint - case scaffold exists, active assertion pending
- unavailable traversal response from the endpoint - case scaffold exists, active assertion pending
- endpoint authorization failure matrix - case scaffold exists, active assertion pending
- endpoint helper-output validation failure - case scaffold exists, active assertion pending
- endpoint summary-only provenance on success/unavailable
- endpoint no-provenance behavior on denied/invalid traversal
- endpoint behavior after module narrowing/revocation - case scaffold exists, active assertion pending

## Enablement Order

1. Add endpoint-level tests behind the current hard refusal, or as focused helpers that can become
   active in the enablement commit.
2. Replace `rejectUnsupportedDesktopTraversal` with the traversal validator and internal traversal
   pipeline only after the endpoint tests are ready.
3. Keep default desktop inspection validation closed.
4. Keep traversal response validation on the explicit traversal-authorized path only.
5. Run a final review immediately before removing `desktop_traversal_not_implemented`.

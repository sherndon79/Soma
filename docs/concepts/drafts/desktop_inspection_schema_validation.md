# Desktop Inspection Schema Validation

Status: decision note

Soma currently has two representations of the desktop inspection contract:

- `docs/schemas/desktop-inspection-result.schema.json` documents the bounded broker output shape.
- `src/desktopInspectionSchema.js` enforces the output shape at runtime before Soma returns a
  helper result or records provenance.

## Decision

Keep the hand-rolled runtime validator for the current desktop inspection shape. Do not add a
JSON Schema runtime dependency yet.

The JSON schema remains the documented contract and should continue to be tested for the critical
privacy and bounds invariants. The runtime validator remains the enforcement point until the
desktop output surface becomes broad enough that maintaining the validator by hand creates more
risk than adding a dependency.

## Why Defer

The current schema is narrow and intentionally conservative. The hand-rolled validator already
enforces the important contract boundaries:

- only known top-level broker fields are accepted
- AT-SPI tree output must be bounded
- root object path is fixed to `/org/a11y/atspi/accessible/root`
- application samples are capped
- root child references are capped
- shallow child metadata is capped
- child metadata excludes names, descriptions, text, states, and actions
- window output remains empty until `desktop.inspect.windows` is implemented
- malformed helper output fails closed with `desktop_inspection_schema_invalid`

Adding a JSON Schema validator now would add dependency and supply-chain surface without changing
Soma's effective behavior. The stronger immediate risk is schema drift, so the current tests should
continue to pin the shared invariants between the documentation schema and runtime validator.

## Drift Risks

The documented JSON schema and runtime validator can diverge. This is acceptable only while the
contract is small and covered by tests.

Any future validator migration must preserve these details exactly:

- `additionalProperties: false` behavior at every object level
- fixed root-object path
- empty `windows` array until a separate window contract exists
- `bounded: true`
- `text_content_included: false`
- child metadata field exclusions
- sample size caps
- fail-closed HTTP 502 behavior for provider overreach
- no provenance entry for rejected helper output

If a JSON Schema dependency replaces the current validator, tests should exercise both accepted
and rejected broker payloads before the old validator is removed.

For bounded recursive traversal, the schema and runtime validator should be extended before the
Rust helper emits traversal output. This keeps Node as the trust boundary and prevents helper
capability from outrunning validation.

## Migration Triggers

Move to JSON Schema-backed runtime validation when at least one of these becomes true:

- recursive AT-SPI traversal expands the result shape beyond the current root-and-child sample
- multiple desktop schemas need the same validator path
- third-party providers, plugins, or MCP adapters submit desktop broker output
- schemas become a public integration contract outside the local repo
- hand-written validation begins duplicating substantial JSON Schema structure

## Non-Goals

This decision does not broaden desktop inspection. It does not add traversal, window metadata,
text extraction, names, descriptions, states, actions, screenshots, or actuation.

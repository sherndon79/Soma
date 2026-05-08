# Desktop Helper Limit Contract

Status: design draft, not implemented

Soma currently applies `max_apps` and `max_children` after helper output has passed Node-side
schema validation. This preserves a simple trust boundary: the Rust helper can only return the
documented desktop inspection result shape, and Node remains responsible for policy, validation,
provenance, and final response shaping.

Helper-side limits can still be useful as an optimization. They can reduce host work, subprocess
output size, and AT-SPI queries, especially before recursive traversal exists. They must not
replace Node-side validation or final narrowing.

## Decision

Helper-side limit passing should be introduced as a performance hint, not as an authority boundary.

The service should continue to:

- validate request fields before helper invocation
- validate helper output against the runtime schema before returning it
- reject provider overreach before provenance is recorded
- apply Node-side narrowing after validation so the public response matches the request
- record requested limits separately from returned counts

If the helper ignores limit flags, the service should still behave correctly because Node keeps the
existing post-validation narrowing path.

## Proposed Helper Arguments

Future `inspect-atspi` invocation:

```text
soma-desktop-broker inspect-atspi \
  --max-applications 8 \
  --max-root-child-refs 2 \
  --max-root-child-metadata 2
```

Argument meanings:

- `--max-applications`: maximum AT-SPI bus participants to inspect; range `1..64`
- `--max-root-child-refs`: maximum root child object references to include; range `0..8`
- `--max-root-child-metadata`: maximum shallow child metadata records to include; range `0..4`

The public API exposes one `max_children` value. Node should derive helper arguments from it:

```text
--max-root-child-refs      = max_children
--max-root-child-metadata  = min(max_children, 4)
```

If `max_children` is omitted, Node should omit both child-related helper flags and let the helper
use its hard defaults. If `max_apps` is omitted, Node should omit `--max-applications`.

## Why Split Child Limits

The current schema allows up to:

- 8 root child references
- 4 shallow child metadata records

Those are different disclosure and cost surfaces. Child references expose service/path pairs only.
Child metadata adds role and child count, which is still bounded but more informative. Splitting
the helper arguments keeps the helper aligned to the schema rather than treating one public
`max_children` value as permission to widen child metadata.

## Backward Compatibility

The Rust helper command shape is one-shot stdio:

```text
soma-desktop-broker inspect-environment
soma-desktop-broker inspect-atspi
soma-desktop-broker inspect-focus
```

Node now derives and passes optional limit hints for `inspect-atspi` when request limits are
provided. Until the helper parses those hints, Node must remain compatible with a helper that
ignores extra flags. That means the post-validation narrowing path stays in place permanently
unless a later design explicitly replaces it.

## Validation Order

The intended flow is:

```text
API request
  -> request validation
  -> derive helper limit hints
  -> invoke helper
  -> runtime schema validation of helper output
  -> Node-side final narrowing
  -> provenance summary
  -> response
```

Do not move final narrowing before schema validation. If the helper returns over-broad child
metadata, window data, traversal data, text, actions, screenshots, or input state, Node should
reject the entire helper payload rather than trim it into compliance.

## Fallback Behavior

The JavaScript fallback should not grow a separate helper-limit path. It should continue producing
the current bounded environment or unavailable AT-SPI output, then flow through the same
post-validation narrowing path.

## Test Requirements Before Rust Enforcement

Node-side argument derivation and invocation tests should cover:

- `max_apps` produces `--max-applications` - covered by `test/desktopBroker.test.js`
- `max_children` produces both child-ref and child-metadata helper flags - covered by
  `test/desktopBroker.test.js`
- `max_children > 4` caps helper metadata at `4` while preserving Node-side child-reference
  narrowing - covered by `test/desktopBroker.test.js` and `test/app.test.js`
- omitted limits produce the current helper invocation - covered by `test/desktopBroker.test.js`
- helper output is still schema-validated before narrowing - covered by `test/app.test.js`
- helper contract failures still produce no desktop inspection provenance - covered by
  `test/app.test.js`

Current implementation status: `desktopBrokerHelperArgs` derives the helper argument shape and has
tests. Runtime Node helper invocation now uses those derived arguments for `inspect-atspi`, while
still schema-validating helper output before applying final Node-side narrowing. The Rust helper
currently accepts the command shape but does not yet parse or enforce the limit flags.

Before Rust starts enforcing helper flags, tests or fixture-level checks should cover:

- unknown helper flags fail with usage error, once flag parsing exists
- invalid helper limit values fail before AT-SPI queries
- helper limits never exceed schema hard caps
- public output schema remains unchanged

## Non-Goals

- no traversal implementation
- no response schema change
- no change to public API request fields
- no reliance on helper-side limits for safety
- no text, names, descriptions, states, actions, screenshots, OCR, input state, or actuation

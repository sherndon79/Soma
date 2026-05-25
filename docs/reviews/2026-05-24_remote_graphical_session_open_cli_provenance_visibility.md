# Remote Graphical Session-Open CLI Provenance Visibility

Review after covering CLI visibility for fixture session-open provenance fields.

## Scope

- `test/cli.test.js`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

CLI tests now cover the operator visibility boundary for fixture session-open provenance:

- default text output stays concise and does not print `provenance_preview`,
  `provenance_appended`, or the full event type
- `--json` output preserves the full server response, including `provenance_appended` and
  `provenance_preview`

The CLI implementation already emitted full JSON responses through the existing `writeOutput`
path, so no source behavior change was required.

## Boundary

This change does not alter route behavior, append behavior, durable writes, live transport, video,
input, recording, model delivery, or grant mutation.

## Residual Risk

The next slice should document provenance query examples for operators who want to inspect appended
`remote_graphical.session_open.fixture` events through the existing provenance CLI.

## Verification

- `npm test`
- `git diff --check`

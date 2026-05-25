# Remote Graphical Session-Open Provenance Query Examples

Review after documenting operator queries for appended fixture session-open provenance events.

## Scope

- `docs/operators.md`
- `ROADMAP.md`

## Summary

Operator docs now show how to inspect appended fixture session-open events with:

```bash
npm run cli -- provenance list --event-type remote_graphical.session_open.fixture --json
```

The guidance keeps JSON as the inspection surface for exact metadata comparison and names the
expected false posture for content, transport, input, recording, and model-delivery flags.

## Boundary

This change is documentation-only. It does not alter route behavior, CLI behavior, provenance
append behavior, durable writes, live transport, visual payload delivery, input events, recording,
or grant mutation.

## Residual Risk

Live broker activation still needs a separate reviewed checklist before any Sunshine/Moonlight
session control, frame handling, input channel, recording, or model-facing visual delivery is
introduced.

## Verification

- `npm test`
- `git diff --check`

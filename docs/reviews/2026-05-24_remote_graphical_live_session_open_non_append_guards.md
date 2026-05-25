# Remote Graphical Live Session-Open Non-Append Guards

Review after adding route assertions that current remote graphical session-open paths do not emit
or append live session-open provenance.

## Scope

- `test/app.test.js`
- `ROADMAP.md`

## Summary

Route tests now explicitly guard the live provenance boundary:

- fixture success still returns and appends `remote_graphical.session_open.fixture`
- fixture broker failure still returns and appends `remote_graphical.session_open.fixture`
- append failure still carries a fixture preview only
- broker posture refusal still has no provenance preview, no provenance append flag, and no append
  call
- no current session-open route assertion accepts `remote_graphical.session_open.live`

## Boundary

This change is test-only plus roadmap/review documentation. It does not wire the live provenance
constructor into routes, append live provenance, construct a live broker, call Sunshine/Moonlight,
write grants, attach frames, dispatch input, record, or deliver visual payloads to a model.

## Residual Risk

The live provenance constructor now exists and is intentionally unused by app routes. Future route
changes should keep these guard tests or replace them with stricter activation tests only after a
focused live activation review.

## Verification

- `node test/app.test.js`
- `npm test`
- `git diff --check`

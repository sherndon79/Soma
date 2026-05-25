# Remote Graphical Session-Open Provenance Append Fixture

Review after enabling fixture-only remote graphical session-open provenance append.

## Scope

- `src/app.js`
- `test/app.test.js`
- `docs/concepts/drafts/remote_graphical_session_open_provenance_append_policy.md`
- `docs/concepts/drafts/remote_graphical_session_open_activation_policy.md`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

Fixture-only remote graphical session-open success/failure now appends the exact
`provenance_preview` returned in the response. The route builds the broker result, constructs the
preview from that result, appends that preview once, and then writes the response.

Tests cover:

- fixture success appends once and appended event equals `provenance_preview`
- fixture broker failure appends once and appended event equals `provenance_preview`
- broker-posture refusal does not append
- append failure returns a bounded `remote_graphical_session_open_append_failure` response without a
  second broker call

## Boundary

This change does not enable durable writes, live Sunshine/Moonlight transport, pairing, credential
storage, video observation, screenshots, input dispatch, recording, model-facing visual payload
delivery, or grant mutation.

## Residual Risk

CLI/operator display should remain concise. The next slice should keep default text output stable
while preserving JSON visibility for `provenance_preview` and `provenance_appended`.

## Verification

- `node --test test/app.test.js`
- `node --test test/remoteGraphicalSessionOpenProvenance.test.js`
- `node --test test/remoteGraphicalSessionOpenReview.test.js`
- `npm test`
- `git diff --check`

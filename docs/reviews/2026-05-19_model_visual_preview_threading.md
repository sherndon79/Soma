# Model Visual Preview Threading

Date: 2026-05-19

## Scope

Review after threading preview artifact and acknowledgement metadata through the visual grant
candidate and request validators.

Touched:

- `src/modelVisualAttachGrantCandidate.js`
- `src/modelVisualAttachRequest.js`
- `test/modelVisualAttachGrantCandidate.test.js`
- `test/modelVisualAttachRequest.test.js`
- `docs/concepts/drafts/model_facing_visual_delivery_boundary.md`

## Findings

Preview metadata is now carried as constraints, not as payload. The grant candidate requires a
preview artifact id, acknowledgement id, user actor, ISO acknowledgement timestamp, and cleanup
requirement. The request validator requires the same fields and checks that they match the active
visual attach grant.

The route surface remains closed. This does not render a preview, allocate or clean up preview
bytes, write a grant, assemble a prompt, invoke a model, or attach a visual payload.

The tests preserve the key boundary: a request can only pass when it names an active
`model.context.visual.*.attach` grant and the preview acknowledgement metadata matches that grant's
constraints. Sensorium subscription grants remain insufficient authority.

## Non-Activation Notes

This does not add:

- HTTP routes
- CLI commands
- preview rendering
- cleanup implementation
- prompt assembly
- model invocation
- visual payload delivery

## Follow-Up

The next safe step is to update the operator review formatting to show preview artifact and
acknowledgement ids, then decide whether the first real surface should be a review-only CLI command
or an HTTP endpoint.

# Model Visual Dry-Run Provenance Preview

Date: 2026-05-19

## Scope

Review after adding a future provenance preview to accepted model visual attach dry-runs.

Touched:

- `src/app.js`
- `test/app.test.js`
- `docs/concepts/drafts/model_facing_visual_delivery_boundary.md`
- `docs/operators.md`

## Findings

Accepted `POST /model-visual/attach-requests/dry-run` responses now include
`future_provenance_preview`, built from the validated metadata-only request, plus
`future_provenance_appended=false`. The preview uses the future `model.context.visual.attached`
shape without appending provenance or delivering visual payloads.

Refusals still happen in the existing request validator before the future provenance preview is
created. Payload-shaped fields therefore continue to fail closed before summary creation.

This is still a dry-run surface. It does not assemble prompts, invoke models, attach payloads,
retain payloads, write grants, append live visual provenance, write visual memory, or authorize
training use.

## Non-Activation Notes

This does not add:

- live visual attach request handling
- prompt assembly
- model invocation
- visual payload delivery
- preview rendering
- cleanup implementation
- durable retention
- visual memory writes

## Follow-Up

The next safe step is to surface the provenance preview in the CLI dry-run summary or JSON examples,
while keeping live delivery unwired.

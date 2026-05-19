# Model Visual Grant Candidate Scaffold

Date: 2026-05-19

## Scope

Review after adding the non-writing grant-candidate step for model-facing visual attachment.

Touched:

- `src/modelVisualAttachGrantCandidate.js`
- `test/modelVisualAttachGrantCandidate.test.js`
- `docs/fixtures/model-visual-attach-provenance-summary.json`
- `test/modelVisualAttachProvenanceFixture.test.js`
- `docs/concepts/drafts/model_facing_visual_delivery_boundary.md`

## Findings

No visual delivery path is activated. The new builder consumes an approved
`model.context.visual.*.attach` proposal and returns validated grant-create input plus a byte-free
candidate provenance summary. It does not write a grant, start a subscription, attach a payload, or
invoke a model.

The candidate step now represents a second fail-closed gate after proposal creation. It rejects
unacknowledged preview, retention modes other than `none`, memory-write authorization, source
identity drift, model-target drift, and payload-shaped fields in review or intent metadata.

The provenance fixture records only identifiers and bounded shape metadata: source subscription id,
source capability, source provider/topic/grant, model target, payload type, transformed dimensions,
format, preview acknowledgement, and retention posture. It explicitly excludes image/depth bytes,
screenshots, derived scene descriptions, prompts, model responses, and training records.

## Non-Activation Notes

This does not add:

- runtime visual grant creation
- model-facing payload delivery
- prompt assembly
- live preview rendering
- camera subscription activation
- durable visual memory
- runtime provenance append for an actual attachment event

## Follow-Up

The next safe step is an operator-facing review surface for visual attach proposals/candidates, or a
runtime validator that can refuse visual attachment requests before payload handling. Live delivery
should still wait until preview rendering, cleanup, and explicit operator acknowledgement are wired.

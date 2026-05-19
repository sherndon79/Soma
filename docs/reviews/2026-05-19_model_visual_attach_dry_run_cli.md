# Model Visual Attach Dry-Run CLI

Date: 2026-05-19

## Scope

Review after adding a CLI wrapper for the model visual attach dry-run route.

Touched:

- `src/cli.js`
- `test/cli.test.js`
- `docs/concepts/drafts/model_facing_visual_delivery_boundary.md`
- `docs/operators.md`

## Findings

`soma model-visual attach-dry-run --request-json json` now posts a metadata-only request object to
`POST /model-visual/attach-requests/dry-run` and prints an operator summary by default. `--json`
preserves the full route response.

The CLI validates that `--request-json` is valid JSON and decodes to an object before making the
request. It does not inspect, decode, or route visual payload bytes. Payload-shaped fields still
fail at the shared dry-run route validator.

This remains non-delivering. A successful dry-run proves request/grant metadata compatibility only;
it does not assemble prompts, invoke models, attach payloads, retain payloads, write grants,
acknowledge previews, or clean up preview bytes.

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

The next safe step is to document or scaffold byte-free provenance for a future live visual
attachment event, still without creating the live delivery path.

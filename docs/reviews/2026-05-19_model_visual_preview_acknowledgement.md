# Model Visual Preview Acknowledgement

Date: 2026-05-19

## Scope

Review after adding byte-free preview artifact and acknowledgement metadata validation.

Touched:

- `src/modelVisualPreviewArtifact.js`
- `test/modelVisualPreviewArtifact.test.js`
- `docs/concepts/drafts/model_visual_preview_acknowledgement.md`

## Findings

The new validator covers only metadata. It does not render previews, allocate preview payloads,
store images, assemble prompts, invoke models, or attach visual context.

The preview lifecycle is now explicit: proposal approval, transformed preview rendering, operator
acknowledgement, request validation, and eventual model attachment are separate gates.

The metadata shape requires `retention_mode=ephemeral_preview`, `cleanup_required=true`,
`payload_bytes_included=false`, and `payload_retained_after_acknowledgement=false`. It rejects image
bytes, depth bytes, screenshots, raw depth, point clouds, meshes, scene descriptions, prompts, model
responses, and training records.

## Non-Activation Notes

This does not add:

- HTTP routes
- CLI commands
- preview rendering
- payload allocation
- cleanup implementation
- prompt assembly
- model invocation
- visual payload delivery

## Follow-Up

The next safe step is to thread preview artifact and acknowledgement ids into the visual grant
candidate and request validator constraints while still keeping delivery disabled.

# Model Visual Attach Dry-Run Route

Date: 2026-05-19

## Scope

Review after exposing the model visual attach request validator through a dry-run HTTP route.

Touched:

- `src/app.js`
- `test/app.test.js`
- `docs/concepts/drafts/model_facing_visual_delivery_boundary.md`
- `docs/operators.md`

## Findings

`POST /model-visual/attach-requests/dry-run` now validates a metadata-only visual attach request
against the active in-memory grant store. Accepted responses return the normalized request plus
`dry_run=true`, `accepted=true`, `activation_performed=false`, `grant_written=false`,
`subscription_activated=false`, `model_delivery_performed=false`, `payload_attached=false`, and
`payload_bytes_included=false`.

The route delegates to the existing validator, so missing grants, Sensorium subscription grants,
preview acknowledgement drift, retention drift, and payload-shaped fields still fail before any
delivery path exists.

This is not a delivery route. It does not assemble prompts, invoke models, attach payloads, retain
payloads, create grants, acknowledge previews, or clean up preview bytes.

## Non-Activation Notes

This does not add:

- CLI commands for visual attach dry-runs
- prompt assembly
- model invocation
- visual payload delivery
- preview rendering
- cleanup implementation
- durable retention
- visual memory writes

## Follow-Up

The next safe step is a CLI wrapper for the dry-run route, or an explicit provenance shape for a
future live attachment event that remains byte-free.

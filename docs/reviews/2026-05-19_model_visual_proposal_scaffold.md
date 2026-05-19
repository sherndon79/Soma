# Model Visual Proposal Scaffold

Date: 2026-05-19

## Scope

Review after adding disabled/requestable model-facing visual attach capability metadata and a pure
proposal-template scaffold.

Touched:

- `config/capability-catalog.json`
- `config/provider-registry.json`
- `src/modelVisualAttachProposalTemplate.js`
- `test/modelVisualAttachProposalTemplate.test.js`
- `test/capabilityCatalog.test.js`
- `docs/concepts/drafts/model_facing_visual_delivery_boundary.md`

## Findings

No delivery path is activated by this slice. The new catalog entries are requestable because the
local model provider advertises proposal support, but their harness status remains `disabled` and
their only allowed scope is `once`.

The template builder rejects use of `perception.sensorium.*.subscribe` as the attachment capability,
which preserves the two-step boundary: subscription grants may authorize bounded Sensorium access,
but model context attachment requires a separate `model.context.visual.*.attach` grant.

The scaffold requires explicit preview posture, `retention.mode=none`, a source subscription, source
provider/topic/grant identity, and a concrete model target. It also rejects payload-shaped fields in
proposal metadata so fixtures and provenance stay byte-free.

## Non-Activation Notes

This does not add:

- prompt assembly
- model invocation with visual payloads
- visual payload storage
- subscription start or camera activation
- runtime validator behavior changes
- desktop/screen inspection expansion

## Follow-Up

The next safe step is a non-delivering visual attach grant-candidate validator and provenance schema
fixture. Live payload delivery should wait until preview refusal, retention cleanup, and byte-free
provenance tests exist.

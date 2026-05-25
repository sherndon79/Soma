# Remote Graphical Live Broker Activation Checklist

Review after adding the checklist that gates future live Sunshine/Moonlight-backed session-open
activation.

## Scope

- `docs/concepts/drafts/remote_graphical_live_broker_activation_checklist.md`
- `docs/concepts/drafts/remote_graphical_session_open_activation_policy.md`
- `docs/concepts/drafts/remote_graphical_broker_boundary.md`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

The new checklist consolidates the evidence required before Soma may move from the current
fixture/refusal session-open behavior to a live broker-backed `open_session` substrate action. It
keeps authority separation explicit: pairing, video observation, screenshots/OCR, input, recording,
disconnect, durable grant writes, and model-facing delivery each remain separate activations.

Operator docs now link to the checklist without implying live support.

## Boundary

This change is documentation-only. It does not add live Sunshine/Moonlight calls, alter broker
injection, change route behavior, attach frames, dispatch input, record, pair, persist credentials,
write grants, or deliver visual payloads to a model.

## Residual Risk

The next implementation slice should remain non-live unless it is explicitly scoped to satisfying
one checklist artifact, such as a provider manifest or metadata-only live provenance constructor.

## Verification

- `npm test`
- `git diff --check`

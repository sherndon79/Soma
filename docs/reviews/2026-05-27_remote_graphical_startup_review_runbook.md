# Remote Graphical Startup Review Runbook

Date: 2026-05-27

## Scope

- `docs/runbooks/remote_graphical_startup_review.md`
- `docs/concepts/drafts/remote_graphical_live_provider_manifest.md`
- `docs/concepts/drafts/remote_graphical_live_broker_activation_checklist.md`
- `ROADMAP.md`

## Summary

This slice documents operator usage for:

```text
soma remote-graphical startup-review [--json]
```

The runbook records expected text markers, JSON false flags, source-selection refusals, and the
non-activation boundary. It makes the key distinction explicit: an eligible startup posture is
review evidence only, not manager construction, helper startup, broker invocation, or live
activation.

## Boundary

Implemented:

- startup-review operator examples
- text and JSON marker expectations
- source guard refusal examples for manifest/helper source overrides
- cross-links from the live provider manifest and activation checklist

Not implemented:

- runtime construction of `RemoteGraphicalLiveBrokerManager`
- helper startup or method implementation
- route invocation, session-open, pairing, video observation, input dispatch, recording, model
  delivery, durable grant writes, cleanup invocation, or live provenance append

## Verification

- documentation-only change
- `npm test`

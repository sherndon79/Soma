# Remote Graphical Startup Review Activation Checklist Guard

Date: 2026-05-28

## Scope

- `docs/runbooks/remote_graphical_startup_review.md`
- `docs/concepts/drafts/remote_graphical_live_broker_activation_checklist.md`
- `test/remoteGraphicalStartupReviewRunbook.test.js`
- `test/remoteGraphicalStartupReviewActivationChecklist.test.js`
- `ROADMAP.md`

## Summary

This slice ties the startup-review runbook directly to the live broker activation checklist. The
runbook now links to the checklist before any route or runtime activation use, and the checklist
names `soma remote-graphical startup-review` plus its JSON fixture as review-only evidence rather
than route authority, runtime authority, grant authority, or permission to construct a live broker.

The new guard test checks that checklist language remains present, while the existing runbook guard
now checks the checklist cross-reference.

## Boundary

Implemented:

- runbook activation-checklist link and activation warning
- checklist language constraining startup-review to review-only evidence
- doc guard coverage for both directions

Not implemented:

- `/remote-graphical/startup-review` route
- runtime construction of `RemoteGraphicalLiveBrokerManager`
- helper startup, live transport, session-open, pairing, video observation, input dispatch,
  recording, model delivery, durable grant writes, cleanup invocation, or live provenance append

## Verification

- `node --test test/remoteGraphicalStartupReviewRunbook.test.js test/remoteGraphicalStartupReviewActivationChecklist.test.js`
- `npm test`

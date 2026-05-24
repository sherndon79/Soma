# Remote Graphical Proposal Template

Review after adding the internal remote graphical session proposal template builder.

## Scope

- `src/remoteGraphicalProposalTemplate.js`
- `test/remoteGraphicalProposalTemplate.test.js`
- `docs/concepts/drafts/remote_graphical_session_provider.md`
- `ROADMAP.md`

## Summary

The new builder produces non-activating review templates for:

- `perception.remote_desktop.video.subscribe`
- `desktop.remote.input.pointer`
- `desktop.remote.input.keyboard`
- `desktop.remote.session.disconnect`

It validates capability, provider support, target host identity, mode, requested scope, duration
bounds, view-only video bounds, and requested channel separation.

## Boundary

The builder is pure validation and formatting. It does not store proposals, create grants, pair
with Sunshine, open a Moonlight session, decode video, capture screenshots, send keyboard or pointer
input, disconnect sessions, retain frames, or deliver visual payloads to a model.

## Review Notes

The cross-channel rejection is load-bearing: a video proposal cannot smuggle keyboard or pointer
authority, and input proposals cannot smuggle video authority. The returned `grant_intent` carries
`activation_performed: false` and metadata-only constraints for future operator review.

## Residual Risk

This is not yet reachable through the service or CLI. The next slice should expose it as a
non-activating review endpoint/command before any broker, pairing, or runtime session work lands.

Verification: `node --test test/remoteGraphicalProposalTemplate.test.js` passes.

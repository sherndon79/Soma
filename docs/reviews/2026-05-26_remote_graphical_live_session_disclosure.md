# Remote Graphical Live Session Disclosure Review

Review after adding the pure active disclosure contract for a future opened live remote graphical
session substrate.

## Scope

- `src/remoteGraphicalLiveSessionDisclosure.js`
- `test/remoteGraphicalLiveSessionDisclosure.test.js`
- `docs/concepts/drafts/remote_graphical_live_session_disclosure.md`
- `docs/concepts/drafts/remote_graphical_broker_boundary.md`
- `docs/concepts/drafts/remote_graphical_live_broker_activation_checklist.md`
- `docs/README.md`
- `ROADMAP.md`

## Summary

Soma now has a metadata-only disclosure constructor for the future state where a live provider
session substrate is open but not observing:

```text
open_observe_inactive
```

The disclosure shape includes bounded session identity, provider, target host, locality, attended
posture, opened/expires timestamps, empty active authorities, empty input channels, explicit
non-observation video flags, and revocation text pointing at bounded `cleanup_for_grant`.

## Boundary

This slice does not call a live broker, change `POST /remote-graphical/sessions`, append live
provenance, pair with Sunshine, start Moonlight, observe video, capture screenshots, run OCR,
dispatch input, record, stop provider sessions, write grants, or deliver visual payloads to a
model.

The constructor and validator reject frame/image/screenshot content, recognized text, clipboard
contents, input events, window metadata, file names or paths, audio payloads, and transport
diagnostics.

## Verification

- `node --test test/remoteGraphicalLiveSessionDisclosure.test.js test/remoteGraphicalSessionOpenProvenance.test.js test/remoteGraphicalBroker.test.js`

# Remote Graphical Grant Candidate Builder

Review after adding a pure grant-candidate builder for approved remote graphical proposals.

## Scope

- `src/remoteGraphicalGrantCreateCandidate.js`
- `test/remoteGraphicalGrantCreateCandidate.test.js`
- `ROADMAP.md`

## Summary

`buildRemoteGraphicalGrantCreateCandidateFromProposal` derives validated grant-create input from an
approved remote graphical proposal. It requires:

- approved proposal status and approved decision
- user decision provenance
- remote graphical capability key
- review context and grant intent
- matching provider, target host, mode, scope, requested channels, reason, and revocation posture

The builder returns `grant_create_input` plus non-activation flags.

## Boundary

The builder does not write grants, pair with Sunshine, open a Moonlight session, capture video,
attach frames, send pointer or keyboard input, disconnect sessions, or record anything.

It reports:

- `activation_performed: false`
- `grant_written: false`
- `session_opened: false`
- `pairing_performed: false`
- `video_attached: false`
- `input_dispatched: false`
- `recording_started: false`

## Review Notes

Tests cover approved proposals, pending proposals, denied proposals, missing approval provenance,
provider drift, target-host drift, and mode drift. Drift rejection is important because the stored
review text is the operator-facing authority record; the grant intent must not silently diverge from
that record.

## Residual Risk

The builder is not yet exposed through HTTP or CLI. The next slice should expose a non-writing
candidate review endpoint/command, mirroring the Sensorium sequence, before any actual grant
creation route is added.

Verification: `node --test test/remoteGraphicalGrantCreateCandidate.test.js` passes.

# Remote Graphical Session-Open Provenance Append Policy

Status: fixture append active, live append disabled

This note defines the prerequisites for appending remote graphical fixture session-open provenance to
the runtime provenance log. The fixture-only append path is active. This does not enable durable
writes, live Sunshine/Moonlight transport, pairing, video observation, input dispatch, recording, or
model-facing visual delivery.

## Current Boundary

The current fixture session-open route returns a metadata-only `provenance_preview` for
`remote_graphical.session_open.fixture` and appends that exact preview for fixture success/failure.

Refusal paths still do not append. Live transport session-open append remains disabled.
Future live session-open provenance must use the distinct
`remote_graphical.session_open.live` event type described in the
[Remote Graphical Live Session-Open Provenance](./remote_graphical_live_session_open_provenance.md)
draft.

## Append Decision

Appending fixture session-open provenance is enabled only when route behavior satisfies all of these
gates:

1. **Preview-first construction**
   - The response result is built first.
   - `provenance_preview` is constructed from that exact result.
   - Append must use the same object shape as the preview, not a separately reconstructed summary.

2. **Validation before append**
   - The pure provenance constructor must reject content-bearing or diagnostic-shaped fields before
     append.
   - Forbidden fields include frames, screenshots, thumbnails, recognized text, clipboard content,
     keystrokes, pointer paths, input events, window metadata, file metadata, audio payloads, and
     transport logs or diagnostics.

3. **Append after broker result, before response write**
   - Broker fixture success/failure result creation comes first.
   - Provenance preview creation comes second.
   - Append, when enabled, comes third.
   - Response write comes last.

4. **Append failure is bounded**
   - Append failure must not cause a second broker call.
   - Append failure must not retry transport or change provider state.
   - Append failure response must not leak filesystem paths, stack traces, provider diagnostics, or
     payload-shaped content.

5. **No durable grant mutation**
   - Appending session-open provenance must not create, revoke, supersede, expire, or persist grants.
   - `durable=false` and `grant_written=false` remain response and provenance facts for this path.

6. **Fixture-only scope**
   - The first appendable event is fixture-only and must carry `fixture_only=true`.
   - Live transport session-open provenance requires a separate activation review.

## Required Tests Before Append

Before route-level append is enabled, tests must prove:

- fixture success appends exactly one `remote_graphical.session_open.fixture` event
- fixture failure appends exactly one `remote_graphical.session_open.fixture` event
- appended event equals `provenance_preview`
- no append occurs on missing grant, non-user actor, invalid grant, missing opt-in, unconfigured
  broker, or configured broker without `session_open_fixture`
- append happens after broker result construction and before response write
- append failure returns a bounded refusal without a second broker call
- forbidden content or diagnostic fields prevent append
- no durable grant files or grant mutation events are written
- CLI text output remains unchanged unless JSON is requested

## Out Of Scope

This policy does not authorize:

- live Sunshine/Moonlight session-open provenance
- pairing or credential provenance
- video, screenshot, OCR, window, clipboard, file, audio, or input-event provenance
- provider disconnect provenance
- model-facing visual delivery provenance
- durable grant mutation or repair

## Related Documents

- [Remote Graphical Live Session-Open Provenance](./remote_graphical_live_session_open_provenance.md)
- [Remote Graphical Session-Open Activation Policy](./remote_graphical_session_open_activation_policy.md)
- [Remote Graphical Broker Boundary](./remote_graphical_broker_boundary.md)
- [Remote Graphical Session Provider](./remote_graphical_session_provider.md)
- [Reversibility and Disclosure](./reversibility_and_disclosure.md)

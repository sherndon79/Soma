# Remote Graphical Session-Open Activation Policy

Status: policy draft, session-open remains default-off

This note defines the prerequisites for replacing the current `provider_not_configured`
session-open refusal with a real broker-backed `open_session` path. It does not enable
Sunshine/Moonlight calls, pairing, video observation, input dispatch, recording, durable grant
writes, or model-facing visual delivery.

## Decision

Remote graphical session-open may become an activated runtime operation only after an explicit
operator-reviewed path exists for the action and a broker is configured through an opt-in runtime
setting.

Session-open means only:

```text
prepare or open a provider session substrate for a target host
```

It must not mean:

- observe video frames
- capture screenshots or thumbnails
- dispatch pointer or keyboard input
- disconnect a session
- record video or audio
- deliver visual payloads to a model
- persist pairing credentials
- create or mutate durable grants

## Current Boundary

The current implemented surfaces are:

- no-op broker status: `GET /remote-graphical/status`, including `requested`, `enabled`, and
  `configured` runtime posture
- session-open review: `POST /remote-graphical/session-open-review`
- default-off session-open refusal: `POST /remote-graphical/sessions`

The refusal route validates active grant, explicit user actor, and reason, then returns
`provider_not_configured`. It must remain the default behavior until the activation gates below are
met.

## Activation Gates

A real broker-backed `open_session` route must not be enabled unless all gates are true:

1. **Explicit runtime opt-in**
   - A setting such as `SOMA_REMOTE_GRAPHICAL_ENABLED=1` is required.
   - Absence of the setting must preserve `provider_not_configured`.
   - Opt-in must be startup-visible in status output.
   - Opt-in alone may only set `requested=true`; it must not imply `enabled=true` or
     `configured=true`.

2. **Configured injected broker**
   - The default broker remains no-op.
   - A configured broker must be explicitly constructed and injected.
   - Tests must prove no live transport calls occur without that injection.

3. **Active remote graphical grant**
   - The route requires an active runtime remote graphical grant.
   - Revoked, expired, unknown, non-remote, or malformed grants are refused.
   - The grant target host and provider must match the requested session target.

4. **Explicit user actor**
   - A user actor is required for the session-open operation.
   - Model request, assistant request, or stored proposal state is insufficient.

5. **Reviewed session-open intent**
   - The session-open review shape must be produced or reproduced at activation time.
   - Review metadata must identify target host, provider, source grant, action, locality, attended
     posture, and separated authorities.

6. **Active disclosure**
   - The operator must have a visible disclosure that a remote graphical session substrate is being
     opened or is open.
   - Disclosure must name target host, provider, state, active authorities, and revocation path.

7. **Metadata-only provenance**
   - A session-open event must record only bounded metadata.
   - No frames, screenshots, recognized text, clipboard contents, keystrokes, pointer paths, window
     titles, file names, or audio payloads may be recorded.

8. **Stable refusal modes**
   - Unconfigured broker, missing opt-in, grant mismatch, unavailable provider, pairing required,
     and broker errors must have stable machine-readable codes.

9. **Cleanup path**
   - Grant revocation or process shutdown must have a broker cleanup path before live session-open
     is enabled.
   - Cleanup may close Soma broker state, but provider-wide disconnect still needs separate review
     unless the session was opened only by Soma and no broader operator session is affected.

## Required Response Contract

A successful future session-open response must still report explicit boundaries:

```json
{
  "activation_performed": true,
  "broker_called": true,
  "session_opened": true,
  "pairing_performed": false,
  "video_attached": false,
  "input_dispatched": false,
  "recording_started": false,
  "model_delivery": false,
  "live_transport_used": true,
  "durable": false,
  "grant_written": false
}
```

If pairing occurs in a later slice, `pairing_performed` must not silently flip inside session-open.
Pairing requires its own reviewed credential policy and response contract.

## Required Refusal Codes

The first live-capable route should preserve or add stable refusal codes:

- `remote_graphical_session_open_requires_grant_id`
- `remote_graphical_session_open_requires_user_actor`
- `invalid_remote_graphical_session_open_review`
- `remote_graphical_broker_not_enabled`
- `remote_graphical_broker_not_configured`
- `remote_graphical_broker_provider_unavailable`
- `remote_graphical_broker_pairing_required`
- `remote_graphical_broker_target_mismatch`
- `remote_graphical_broker_session_open_failed`

Refusals must keep:

```text
broker_called=false unless the configured broker was actually invoked
session_opened=false
video_attached=false
input_dispatched=false
recording_started=false
model_delivery=false
```

## Test Requirements

Before live session-open activation, tests must prove:

- default path remains `provider_not_configured`
- missing opt-in refuses before broker invocation
- missing injected broker refuses before broker invocation
- non-user actor refuses before broker invocation
- missing, revoked, expired, malformed, non-remote, and provider-mismatched grants refuse
- successful configured-broker fixture opens a session without video attachment or input dispatch
- broker failures return stable bounded errors
- active disclosure is emitted for an open session
- provenance records session metadata only
- revocation/cleanup does not dispatch input or attach frames
- no durable grant files are written

## Out Of Scope

Session-open activation must not include:

- Sunshine/Moonlight pairing or credential persistence
- frame delivery to Soma
- screenshots, thumbnails, OCR, or application/window metadata
- model-facing visual payload delivery
- pointer, keyboard, controller, clipboard, audio, or file-transfer channels
- recording
- durable grant mutation

Each item above requires a separate review and activation policy.

## Review Triggers

Run a focused review before merging any change that:

- changes `POST /remote-graphical/sessions` from refusal to live broker invocation
- introduces a real Sunshine/Moonlight broker
- adds pairing or credential storage
- exposes frame bytes, screenshots, OCR, or visual summaries
- enables input dispatch
- changes grant revocation cleanup to affect provider sessions

## Related Documents

- [Remote Graphical Broker Boundary](./remote_graphical_broker_boundary.md)
- [Remote Graphical Session Provider](./remote_graphical_session_provider.md)
- [Remote Graphical Grant Activation Policy](./remote_graphical_grant_activation_policy.md)
- [Model-Facing Visual Delivery Boundary](./model_facing_visual_delivery_boundary.md)
- [Reversibility and Disclosure](./reversibility_and_disclosure.md)

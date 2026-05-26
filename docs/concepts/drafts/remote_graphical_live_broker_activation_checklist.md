# Remote Graphical Live Broker Activation Checklist

Status: checklist draft, no live Sunshine/Moonlight calls enabled

This checklist defines the evidence required before Soma may replace the current fixture/refusal
remote graphical session-open path with a live Sunshine/Moonlight-backed broker path. It
consolidates the broker boundary, session-open activation policy, graphical lab baseline, and
model-facing visual delivery boundary into one operator-review gate.

Passing this checklist must not be treated as permission to activate video observation, input,
recording, pairing, credential persistence, durable grant writes, or model-facing visual delivery.
It only gates the first live `open_session` substrate action.

## Required Artifacts

Before implementation, the activation branch must include:

- a provider manifest for the live remote graphical broker
- an explicit runtime-manifest-loader decision showing that dynamic/operator-supplied manifests
  remain disallowed and only a future default-off repository-owned manifest root may influence
  provider selection
- a runtime configuration document naming the opt-in variables and default-off behavior
- a bounded broker interface contract for `status`, `open_session`, `describe_active`, and
  `cleanup_for_grant`; the current readiness contract is implemented in
  `src/remoteGraphicalLiveBrokerReadiness.js` and remains activation-disabled
- a reviewed active-disclosure shape for an opened but not-observing session; the current
  metadata-only constructor is implemented in `src/remoteGraphicalLiveSessionDisclosure.js`
- metadata-only provenance constructors for live session-open success and failure
- pure live session-open result constructors that compose review, broker result, active disclosure,
  and provenance preview without route activation
- stable refusal codes for disabled runtime, missing broker, target mismatch, pairing required,
  provider unavailable, broker failure, and cleanup failure
- an operator rollback plan for the target node or host

## Authority Separation

Live `open_session` may only prepare or open a provider session substrate. It must preserve these
separations:

| Authority | Separate activation required |
| --- | --- |
| Pairing or credential persistence | yes |
| Video/frame observation | yes |
| Screenshot or OCR capture | yes |
| Pointer input | yes |
| Keyboard input | yes |
| Clipboard, file transfer, controller, or audio channels | yes |
| Recording | yes |
| Disconnecting provider sessions beyond Soma cleanup | yes |
| Model-facing visual payload delivery | yes |
| Durable grant mutation | yes |

An existing Sunshine/Moonlight pairing, reachable stream host, or attended Moonlight session is
substrate evidence only. It is not authorization.

## Pre-Activation Checks

All checks must be true before live `open_session` can be reachable:

1. **Default-off posture**
   - Without explicit runtime opt-in, `remote-graphical status` reports no configured live broker.
   - Without explicit runtime opt-in, `remote-graphical session-open` refuses before broker
     invocation.

2. **Explicit live broker configuration**
   - The no-op broker remains the default.
   - The live broker is injected only when the runtime opt-in, provider id, and validated
     repository-owned runtime manifest are present.
   - Tests prove fixture brokers and live brokers cannot be confused.
   - Tests prove the docs fixture, external paths, stdin, URLs, and environment-selected manifest
     directories cannot influence broker construction.

3. **Grant and actor gates**
   - Session-open requires an active remote graphical runtime grant.
   - Grant provider, capability, and target host match the requested session.
   - Revoked, expired, malformed, unknown, non-remote, and provider-mismatched grants refuse before
     broker invocation.
   - `requested_by=user` is required for live session-open.

4. **Review metadata**
   - The live route produces or verifies the same review shape as
     `remote-graphical session-open-review`.
   - Review metadata names target host, provider, locality, attended posture, source grant, broker
     action, and inactive authorities.

5. **Active disclosure**
   - Opening a live substrate creates visible disclosure before or with the successful response.
   - Disclosure states that the session is open but not observing unless video authority is later
     activated.
   - Disclosure names revocation and cleanup behavior.
   - Disclosure rejects frame bytes, screenshots, recognized text, input events, window metadata,
     file names, audio payloads, and transport diagnostics.

6. **Metadata-only provenance**
   - Live success/failure provenance records target, provider, grant, action, bounded state, stable
     error class, and explicit false flags.
   - Provenance does not include frame bytes, screenshots, recognized text, clipboard contents,
     input events, window titles, file names, audio payloads, or transport diagnostics.

7. **Cleanup and rollback**
   - Grant revocation and process shutdown call a bounded Soma cleanup path for sessions opened by
     Soma.
   - Cleanup must not dispatch input, attach frames, record, or perform provider-wide disconnect
     unless separately reviewed.
   - The operator has a rollback path for the target node, such as reverting the graphical lab base
     snapshot when testing on `soma-agent-desktop`.

## Required Smoke Evidence

Before merging live activation, smoke evidence must show:

- default configuration still refuses without broker invocation
- opt-in without broker configuration refuses without broker invocation
- invalid grants and non-user actors refuse before broker invocation
- configured live broker can report status without opening a session
- live `open_session` opens only the substrate and returns `video_attached=false`,
  `input_dispatched=false`, `recording_started=false`, `model_delivery=false`,
  `durable=false`, and `grant_written=false`
- active disclosure appears for the opened substrate
- revocation or shutdown cleanup returns the active session count to zero
- provenance can be queried without content-bearing fields
- rollback instructions were exercised or explicitly waived by the operator for the test host

## Forbidden In The Activation Slice

The first live broker activation slice must not:

- add video frames, screenshots, thumbnails, OCR, or visual summaries to Soma responses
- attach any visual payload to model context
- dispatch pointer, keyboard, clipboard, controller, file, or audio events
- start or persist recordings
- persist pairing credentials
- write durable grant config
- broaden local desktop AT-SPI, D-Bus, or compositor authority
- treat network reachability as permission

## Review Triggers

Run a focused review before any change that:

- changes `POST /remote-graphical/sessions` to call a live broker
- introduces Sunshine/Moonlight process, socket, or credential handling
- changes cleanup semantics for active remote graphical grants
- exposes visual, input, audio, clipboard, file, or transport-diagnostic payloads
- changes model-facing visual delivery posture

## Related Documents

- [Remote Graphical Live Session-Open Provenance](./remote_graphical_live_session_open_provenance.md)
- [Remote Graphical Live Provider Manifest](./remote_graphical_live_provider_manifest.md)
- [Remote Graphical Runtime Manifest Loader Decision](./remote_graphical_runtime_manifest_loader_decision.md)
- [Remote Graphical Session-Open Activation Policy](./remote_graphical_session_open_activation_policy.md)
- [Remote Graphical Broker Boundary](./remote_graphical_broker_boundary.md)
- [Remote Graphical Session Provider](./remote_graphical_session_provider.md)
- [Remote Graphical Grant Activation Policy](./remote_graphical_grant_activation_policy.md)
- [Model-Facing Visual Delivery Boundary](./model_facing_visual_delivery_boundary.md)
- [Reversibility and Disclosure](./reversibility_and_disclosure.md)

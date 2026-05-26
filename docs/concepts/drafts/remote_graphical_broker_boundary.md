# Remote Graphical Broker Boundary

Status: design draft, no live Sunshine/Moonlight calls enabled

This note defines the runtime seam between Soma's grant system and a future remote graphical
transport broker. It assumes the existing disabled-first remote graphical capabilities and
process-local runtime grants already exist, but it does not activate pairing, session startup,
frame delivery, input dispatch, disconnect, recording, or model-facing visual payload delivery.

## Purpose

The broker should be the narrow adapter between reviewed Soma authority and provider-specific
transport details. A grant says what may be requested; the broker decides whether a concrete runtime
action can be attempted and returns bounded metadata about what happened.

The broker is not the trust boundary. The trust boundary remains:

- capability catalog entries
- provider registry claims
- operator-reviewed proposals
- active runtime grants
- active disclosure
- provenance
- harness modules and revocation

Sunshine/Moonlight pairing or network reachability must never become implicit authority.

## Responsibilities

A remote graphical broker may eventually:

- report provider-neutral session status
- validate that an active grant authorizes a requested broker action
- open a session after explicit session-open review
- subscribe to a bounded video stream after explicit video authority
- dispatch pointer input after explicit pointer authority
- dispatch keyboard input after explicit keyboard authority
- disconnect a session after explicit disconnect authority
- stop local broker activity when grants expire or are revoked
- emit metadata-only provenance summaries
- expose active disclosure state for the operator

Each responsibility must remain independently reviewable. A grant that authorizes video observation
does not authorize input. A grant that authorizes input does not authorize video observation. A
grant that authorizes disconnect does not authorize pairing or recording.

## Non-Responsibilities

The broker must not:

- create or approve grants
- write durable grant configuration
- persist pairing credentials without a separate reviewed credential policy
- treat an existing Moonlight/Sunshine pairing as authorization
- attach frames or screenshots to model context
- record video or audio by default
- expose clipboard contents, file transfer, controller input, or audio as incidental channels
- broaden local desktop inspection fields
- use AT-SPI, D-Bus, or compositor APIs on the remote host unless a separate semantic remote agent
  exists and is reviewed as its own provider

Model-facing visual delivery remains governed by the model visual boundary, not by this broker.

## Provider-Neutral Session Lifecycle

The broker should expose a provider-neutral session lifecycle before any provider-specific details:

```text
unconfigured
  -> provider is not configured or unavailable

pairing_required
  -> a target exists, but credentials/pairing are absent or not authorized

paired_inactive
  -> a target is paired, but no Soma-controlled session is open

opening
  -> Soma requested a session open and is awaiting provider response

open_observe_inactive
  -> session exists, but no video frames are being delivered to Soma

observing
  -> video authority is active and bounded observation is underway

input_enabled
  -> one or more reviewed input channels are active

disconnecting
  -> Soma requested disconnect or cleanup

closed
  -> session is no longer active

error
  -> provider reported a bounded failure
```

The lifecycle is descriptive, not permissive. Moving into `paired_inactive` does not authorize
opening. Moving into `open_observe_inactive` does not authorize frame delivery. Moving into
`observing` does not authorize input.

## Action Boundaries

The first broker interface should separate actions as follows:

| Action | Required authority | Must not imply |
| --- | --- | --- |
| `status` | provider support only | grant, pairing, session open |
| `open_session` | reviewed session-open authority | video delivery, input, recording |
| `start_video` | `perception.remote_desktop.video.subscribe` grant | input, screenshots, recording, model delivery |
| `stop_video` | active video broker state or grant cleanup | disconnect, input revocation |
| `pointer_input` | `desktop.remote.input.pointer` grant | keyboard, video, recording |
| `keyboard_input` | `desktop.remote.input.keyboard` grant | pointer, video, recording |
| `disconnect` | `desktop.remote.session.disconnect` grant | credential deletion, durable mutation |
| `cleanup_for_grant` | grant revocation/expiry cleanup | provider-wide disconnect unless reviewed |

Pairing is intentionally absent from the first action set. Pairing involves credential material and
operator involvement, so it needs its own policy before implementation.

## Disclosure Shape

Active disclosure should be metadata-only and bounded:

```json
{
  "session_id": "runtime-session-id",
  "target_host": "soma-agent-desktop.local.sthnet.org",
  "provider": "soma.provider.remote_desktop.sunshine",
  "state": "observing",
  "locality": "lan",
  "attended": true,
  "active_authorities": ["video"],
  "input_channels": [],
  "video": {
    "max_fps": 30,
    "max_width": 1280,
    "max_height": 720
  },
  "recording": false,
  "model_delivery": false,
  "expires_at": "2026-05-24T12:02:00.000Z",
  "revocation": "grant revocation stops Soma broker activity"
}
```

Disclosure must not include frame bytes, screenshots, recognized text, clipboard contents,
keystrokes, pointer paths, remote window titles, or remote application metadata unless those fields
are separately reviewed and implemented.

The first live opened-substrate disclosure uses `open_observe_inactive`, empty active authorities,
empty input channels, and explicit `video.observing=false`. See
[Remote Graphical Live Session Disclosure](./remote_graphical_live_session_disclosure.md).

## First Interface Sketch

The current live-readiness contract is narrower than the full future broker surface. A live broker
candidate must first satisfy:

```js
remoteGraphicalBroker.status()
remoteGraphicalBroker.describeActive()
remoteGraphicalBroker.openSession({ grant, review, requested_by, actor })
remoteGraphicalBroker.cleanupForGrant({ grant_id, reason })
```

The broader future surface still includes separately reviewed actions:

```js
remoteGraphicalBroker.startVideo({ grant, constraints })
remoteGraphicalBroker.stopVideo({ sessionId, reason })
remoteGraphicalBroker.dispatchPointer({ grant, event })
remoteGraphicalBroker.dispatchKeyboard({ grant, event })
remoteGraphicalBroker.disconnect({ grant, reason })
```

In the first no-op slice, methods that would activate transport should return explicit
`not_implemented` or `provider_not_configured` results while preserving stable response shapes.
Tests should prove no Sunshine/Moonlight command, subprocess, socket, frame capture, input dispatch,
or recording is invoked.

## Provenance

Broker provenance should record only bounded metadata:

- event type
- grant id
- session id
- target host
- provider
- requested action
- active authority family
- state before and after
- fixture-only posture, where applicable
- duration and aggregate counters, where relevant
- termination reason or error class

It must not record frames, screenshots, audio, clipboard contents, keystrokes, pointer paths, remote
file names, remote window titles, or recognized text by default.

The fixture-only session-open provenance constructor records
`remote_graphical.session_open.fixture` summaries for test broker success/failure. It is pure and
is not appended by the HTTP route in the current slice.

Route-level append is governed by the
[Remote Graphical Session-Open Provenance Append Policy](./remote_graphical_session_open_provenance_append_policy.md)
and remains disabled until that policy is implemented and tested.

## Activation Order

Recommended sequence:

1. No-op/injected broker interface and status/disclosure shape.
2. Runtime status route that reports `provider_not_configured` without transport calls.
3. Session-open proposal and grant-candidate review surfaces.
4. No-op session-open route that refuses without an injected broker.
5. Live broker behind explicit opt-in, with status first.
6. Video observation start/stop, still without model-facing delivery.
7. Pointer input and keyboard input as separate later actions.
8. Disconnect as a separate reviewed action.
9. Pairing and credential persistence policy, if needed.

This sequence keeps the transport substrate behind review and keeps frame delivery, input, and
recording out of scope until their own boundaries are documented and tested.

## Related Documents

- [Remote Graphical Live Broker Activation Checklist](./remote_graphical_live_broker_activation_checklist.md)
- [Remote Graphical Session Provider](./remote_graphical_session_provider.md)
- [Remote Graphical Grant Activation Policy](./remote_graphical_grant_activation_policy.md)
- [Remote Graphical Session-Open Activation Policy](./remote_graphical_session_open_activation_policy.md)
- [Remote Graphical Session-Open Provenance Append Policy](./remote_graphical_session_open_provenance_append_policy.md)
- [Model-Facing Visual Delivery Boundary](./model_facing_visual_delivery_boundary.md)
- [Reversibility and Disclosure](./reversibility_and_disclosure.md)

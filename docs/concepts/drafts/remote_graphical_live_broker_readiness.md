# Remote Graphical Live Broker Readiness

Status: readiness contract implemented, live transport still disabled

This document records the readiness contract between the repository-owned runtime manifest loader
and any future live Sunshine/Moonlight broker. It does not authorize session-open activation.

## Contract

The first live broker candidate must implement:

```text
status()
describeActive()
openSession({ grant, review, requested_by, actor })
cleanupForGrant({ grant_id, reason })
```

The contract maps to the manifest actions:

| Action | Method | Live transport |
| --- | --- | --- |
| `status` | `status` | no |
| `describe_active` | `describeActive` | no |
| `open_session` | `openSession` | only after separate activation |
| `cleanup_for_grant` | `cleanupForGrant` | no by default |

`openSession` must not enable video observation, input, recording, or model delivery. Those remain
separate authorities even after a provider session substrate exists.

## Readiness Checks

`evaluateRemoteGraphicalLiveBrokerReadiness` is a pure guard. It may classify a broker as a live
candidate, but it does not call the broker and does not permit route activation.

The readiness check refuses when:

- runtime opt-in is absent or broker status is not enabled
- provider status is not configured
- a fixture session-open broker is present
- validated repository runtime manifest metadata is missing
- provider or target host drift between status and manifest
- the broker does not implement the required method surface
- the live activation guard remains disabled

The current successful shape is therefore:

```text
candidate=true
ready=false
readiness=activation_guard_disabled
```

That state means the shape is eligible for review. It does not mean `POST /remote-graphical/sessions`
may call a live broker.

## Non-Activation Guarantees

The readiness result always reports these fields as false in the current implementation:

- `activation_performed`
- `broker_called`
- `session_opened`
- `pairing_performed`
- `video_attached`
- `input_dispatched`
- `recording_started`
- `provider_session_stopped`
- `model_delivery`
- `live_transport_used`

## Relationship To Routes

The session-open route still refuses configured non-fixture brokers with
`remote_graphical_broker_provider_unavailable`. This readiness contract is review evidence for a
future route change, not a route change by itself.

## Related Documents

- [Remote Graphical Live Broker Activation Checklist](./remote_graphical_live_broker_activation_checklist.md)
- [Remote Graphical Runtime Manifest Loader Decision](./remote_graphical_runtime_manifest_loader_decision.md)
- [Remote Graphical Broker Boundary](./remote_graphical_broker_boundary.md)
- [Remote Graphical Live Provider Manifest](./remote_graphical_live_provider_manifest.md)
